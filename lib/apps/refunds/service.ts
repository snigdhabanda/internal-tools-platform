import { Prisma, type ApprovalRequest, type Refund } from "@prisma/client";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { payments } from "@/lib/integrations/payments";
import { createApprovalRequest, type ApprovalHandler } from "@/lib/platform/approvals";
import { audit } from "@/lib/platform/audit";
import type { CurrentUser } from "@/lib/platform/auth";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/platform/errors";

export const REFUND_ENTITY = "Refund";
/** Refunds at or above this amount need maker-checker approval. */
export const APPROVAL_THRESHOLD_CENTS = 500_00;

export const requestRefundSchema = z.object({
  customerName: z.string().trim().min(1).max(200),
  customerEmail: z.string().trim().email(),
  chargeId: z.string().trim().regex(/^ch_[A-Za-z0-9]+$/, "Must be a charge id like ch_123"),
  amount: z.number().positive().max(100_000).multipleOf(0.01),
  reason: z.string().trim().min(3).max(500),
});
export type RequestRefundInput = z.infer<typeof requestRefundSchema>;

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
const idempotencyKeySchema = z.string().uuid();

/** Every refund request must carry a client-generated UUID so retries can't move money twice. */
export function readIdempotencyKey(headers: Headers): string {
  const key = headers.get(IDEMPOTENCY_HEADER);
  if (!key) throw new BadRequestError(`${IDEMPOTENCY_HEADER} header is required`);
  if (!idempotencyKeySchema.safeParse(key).success) throw new BadRequestError(`${IDEMPOTENCY_HEADER} must be a UUID`);
  return key;
}

export function isIdempotencyKeyConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

type RefundApprovalPayload = { refundId: string; chargeId: string; amountCents: number; currency: string };

export async function listRefunds(db: Db) {
  return db.refund.findMany({ include: { requestedBy: true }, orderBy: { createdAt: "desc" } });
}

/** Audit view of a refund: customer name and email stay out of the append-only log. */
export function refundAuditSnapshot(refund: Refund) {
  const snapshot: Partial<Refund> = { ...refund };
  delete snapshot.customerName;
  delete snapshot.customerEmail;
  return snapshot;
}

async function executeRefund(tx: Db, refund: Refund, actorId: string, before: Refund = refund) {
  const providerRefund = await payments.refunds.create({
    charge: refund.chargeId,
    amount: refund.amountCents,
    currency: refund.currency,
    idempotencyKey: refund.idempotencyKey,
  });
  const after = await tx.refund.update({
    where: { id: refund.id },
    data: {
      status: providerRefund.status === "succeeded" ? "executed" : "failed",
      providerRefundId: providerRefund.id,
    },
  });
  await audit(
    { actorId, action: `refund.${after.status}`, entityType: REFUND_ENTITY, entityId: refund.id, before: refundAuditSnapshot(before), after: refundAuditSnapshot(after) },
    tx,
  );
  return after;
}

/** Step 1: persist the refund request. The route audits "refund.requested" right after this. */
export async function createRefund(tx: Db, user: CurrentUser, input: RequestRefundInput, idempotencyKey: string) {
  const amountCents = Math.round(input.amount * 100);
  return tx.refund.create({
    data: {
      idempotencyKey,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      chargeId: input.chargeId,
      amountCents,
      reason: input.reason,
      status: amountCents >= APPROVAL_THRESHOLD_CENTS ? "pending_approval" : "processing",
      requestedById: user.id,
    },
  });
}

/**
 * Step 2: under the threshold, execute immediately; otherwise open a maker-checker
 * ApprovalRequest. Audits its own side effects.
 */
export async function processRefund(tx: Db, user: CurrentUser, created: Refund) {
  if (created.status === "processing") {
    const refund = await executeRefund(tx, created, user.id);
    return { refund, approvalRequest: null };
  }

  const payload: RefundApprovalPayload = {
    refundId: created.id,
    chargeId: created.chargeId,
    amountCents: created.amountCents,
    currency: created.currency,
  };
  const approvalRequest = await createApprovalRequest(tx, {
    entityType: REFUND_ENTITY,
    entityId: created.id,
    payload,
    requestedBy: user,
  });
  const refund = await tx.refund.update({ where: { id: created.id }, data: { approvalRequestId: approvalRequest.id } });
  return { refund, approvalRequest };
}

export async function findRefundByIdempotencyKey(db: Db, idempotencyKey: string) {
  return db.refund.findUnique({ where: { idempotencyKey } });
}

/**
 * A retried request (same Idempotency-Key) gets the original refund back and never reaches
 * the payments provider. Reusing a key for a different request is a client bug: 409.
 */
export async function replayRefund(
  db: Db,
  user: CurrentUser,
  input: RequestRefundInput,
  existing: Refund,
): Promise<{ refund: Refund; approvalRequest: ApprovalRequest | null }> {
  if (
    existing.requestedById !== user.id ||
    existing.chargeId !== input.chargeId ||
    existing.amountCents !== Math.round(input.amount * 100) ||
    existing.customerName !== input.customerName ||
    existing.customerEmail !== input.customerEmail ||
    existing.reason !== input.reason
  ) {
    throw new ConflictError(`${IDEMPOTENCY_HEADER} was already used for a different refund request`);
  }
  const approvalRequest = existing.approvalRequestId
    ? await db.approvalRequest.findUnique({ where: { id: existing.approvalRequestId } })
    : null;
  return { refund: existing, approvalRequest };
}

/**
 * Atomically moves a refund out of pending_approval. Only the caller whose conditional update
 * matched a row may continue, so concurrent decisions can never both reach the provider.
 */
async function claimPendingRefund(tx: Db, refundId: string, status: "processing" | "rejected", approved?: RefundApprovalPayload) {
  const before = await tx.refund.findUnique({ where: { id: refundId } });
  if (!before) throw new NotFoundError("Refund not found");
  // The checker approved this exact payload; refuse if the refund drifted since.
  if (approved && (approved.amountCents !== before.amountCents || approved.chargeId !== before.chargeId)) {
    throw new ConflictError("Refund no longer matches the approved request");
  }
  const { count } = await tx.refund.updateMany({ where: { id: refundId, status: "pending_approval" }, data: { status } });
  if (count !== 1) throw new ConflictError(`Refund is ${before.status === "pending_approval" ? "already being decided" : before.status}`);
  const after = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
  return { before, after };
}

export const refundApprovalHandler: ApprovalHandler = {
  summarize(payload) {
    const p = payload as RefundApprovalPayload;
    return `Refund $${(p.amountCents / 100).toFixed(2)} on ${p.chargeId}`;
  },
  async onApproved({ tx, request, payload, decider }) {
    const { before, after } = await claimPendingRefund(tx, request.entityId, "processing", payload as RefundApprovalPayload);
    await executeRefund(tx, after, decider.id, before);
  },
  async onRejected({ tx, request, decider }) {
    const { before, after } = await claimPendingRefund(tx, request.entityId, "rejected");
    await audit(
      { actorId: decider.id, action: "refund.rejected", entityType: REFUND_ENTITY, entityId: after.id, before: refundAuditSnapshot(before), after: refundAuditSnapshot(after) },
      tx,
    );
  },
};
