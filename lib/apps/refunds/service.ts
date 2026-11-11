import type { Refund } from "@prisma/client";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { payments } from "@/lib/integrations/payments";
import { createApprovalRequest, type ApprovalHandler } from "@/lib/platform/approvals";
import { audit } from "@/lib/platform/audit";
import type { CurrentUser } from "@/lib/platform/auth";
import { ConflictError, NotFoundError } from "@/lib/platform/errors";

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

async function executeRefund(tx: Db, refund: Refund, actorId: string) {
  const providerRefund = await payments.refunds.create({
    charge: refund.chargeId,
    amount: refund.amountCents,
    currency: refund.currency,
    idempotencyKey: `refund_${refund.id}`,
  });
  const after = await tx.refund.update({
    where: { id: refund.id },
    data: {
      status: providerRefund.status === "succeeded" ? "executed" : "failed",
      providerRefundId: providerRefund.id,
    },
  });
  await audit(
    { actorId, action: `refund.${after.status}`, entityType: REFUND_ENTITY, entityId: refund.id, before: refundAuditSnapshot(refund), after: refundAuditSnapshot(after) },
    tx,
  );
  return after;
}

/** Step 1: persist the refund request. The route audits "refund.requested" right after this. */
export async function createRefund(tx: Db, user: CurrentUser, input: RequestRefundInput) {
  const amountCents = Math.round(input.amount * 100);
  return tx.refund.create({
    data: {
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

async function loadPendingRefund(tx: Db, refundId: string) {
  const refund = await tx.refund.findUnique({ where: { id: refundId } });
  if (!refund) throw new NotFoundError("Refund not found");
  if (refund.status !== "pending_approval") throw new ConflictError(`Refund is ${refund.status}`);
  return refund;
}

export const refundApprovalHandler: ApprovalHandler = {
  summarize(payload) {
    const p = payload as RefundApprovalPayload;
    return `Refund $${(p.amountCents / 100).toFixed(2)} on ${p.chargeId}`;
  },
  async onApproved({ tx, request, payload, decider }) {
    const refund = await loadPendingRefund(tx, request.entityId);
    const p = payload as RefundApprovalPayload;
    // The checker approved this exact payload; refuse if the refund drifted since.
    if (p.amountCents !== refund.amountCents || p.chargeId !== refund.chargeId) {
      throw new ConflictError("Refund no longer matches the approved request");
    }
    await executeRefund(tx, refund, decider.id);
  },
  async onRejected({ tx, request, decider }) {
    const refund = await loadPendingRefund(tx, request.entityId);
    const after = await tx.refund.update({ where: { id: refund.id }, data: { status: "rejected" } });
    await audit(
      { actorId: decider.id, action: "refund.rejected", entityType: REFUND_ENTITY, entityId: refund.id, before: refundAuditSnapshot(refund), after: refundAuditSnapshot(after) },
      tx,
    );
  },
};
