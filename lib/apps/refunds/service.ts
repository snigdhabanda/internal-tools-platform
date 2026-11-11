import { Prisma, type ApprovalRequest, type Refund } from "@prisma/client";
import { z } from "zod";
import { parseDay } from "@/lib/dates";
import type { Db } from "@/lib/db";
import { payments } from "@/lib/integrations/payments";
import { createApprovalRequest, type ApprovalHandler } from "@/lib/platform/approvals";
import { audit } from "@/lib/platform/audit";
import type { CurrentUser } from "@/lib/platform/auth";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/platform/errors";

export const REFUND_ENTITY = "Refund";
/** Refunds at or above this amount need maker-checker approval. */
export const APPROVAL_THRESHOLD_CENTS = 500_00;

export const REFUND_REASONS = ["duplicate", "fraudulent", "requested_by_customer", "service_not_delivered", "goodwill"] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];
export const REFUND_REASON_LABELS: Record<RefundReason, string> = {
  duplicate: "Duplicate charge",
  fraudulent: "Fraudulent",
  requested_by_customer: "Requested by customer",
  service_not_delivered: "Service not delivered",
  goodwill: "Goodwill",
};
export const reasonLabel = (code: string) => REFUND_REASON_LABELS[code as RefundReason] ?? code;

/** The customer comes from the charge, never from the request: refunds can only go back to the original payer. */
export const requestRefundSchema = z.object({
  chargeId: z.string().trim().regex(/^ch_[A-Za-z0-9]+$/, "Must be a charge id like ch_123"),
  amount: z.number().positive().max(100_000).multipleOf(0.01),
  reason: z.enum(REFUND_REASONS),
  note: z.string().trim().max(500).optional().transform((v) => v || null),
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

type RefundApprovalPayload = { refundId: string; chargeId: string; amountCents: number; currency: string; customerName?: string };

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

export type ChargeBalance = { amountCents: number; amountRefundedCents: number; amountPendingCents: number };

/** What can still be refunded: original amount minus executed refunds minus refunds on hold. */
export const remainingCents = (c: ChargeBalance) => c.amountCents - c.amountRefundedCents - c.amountPendingCents;

/** Look up charges by charge id or customer email (exact or partial). */
export async function searchCharges(db: Db, q: string) {
  const term = q.trim();
  if (term.length < 3) return [];
  return db.charge.findMany({
    where: { OR: [{ id: term }, { customerEmail: { contains: term } }, ...(term.startsWith("ch_") ? [{ id: { startsWith: term } }] : [])] },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
}

/**
 * Holds `amountCents` of the charge's balance for a new refund. A single conditional UPDATE, so
 * two concurrent requests can never both pass the balance check and over-refund the charge.
 */
async function reserveBalance(tx: Db, chargeId: string, amountCents: number) {
  const charge = await tx.charge.findUnique({ where: { id: chargeId } });
  if (!charge) throw new NotFoundError(`Charge ${chargeId} not found`);
  const updated = await tx.$executeRaw`
    UPDATE "Charge" SET "amountPendingCents" = "amountPendingCents" + ${amountCents}
    WHERE "id" = ${chargeId} AND "amountCents" - "amountRefundedCents" - "amountPendingCents" >= ${amountCents}`;
  if (updated !== 1) {
    const latest = await tx.charge.findUniqueOrThrow({ where: { id: chargeId } });
    throw new BadRequestError(
      `Refund of ${dollars(amountCents)} exceeds the remaining refundable balance of ${dollars(Math.max(0, remainingCents(latest)))} on ${chargeId}`,
    );
  }
  return charge;
}

/** Moves a refund's hold into amountRefunded (executed) or releases it (rejected/failed). */
async function settleBalance(tx: Db, refund: Refund, outcome: "executed" | "released") {
  await tx.charge.update({
    where: { id: refund.chargeId },
    data: {
      amountPendingCents: { decrement: refund.amountCents },
      ...(outcome === "executed" ? { amountRefundedCents: { increment: refund.amountCents } } : {}),
    },
  });
}

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  await settleBalance(tx, after, after.status === "executed" ? "executed" : "released");
  await audit(
    { actorId, action: `refund.${after.status}`, entityType: REFUND_ENTITY, entityId: refund.id, before: refundAuditSnapshot(before), after: refundAuditSnapshot(after) },
    tx,
  );
  return after;
}

/**
 * Step 1: hold the amount against the charge's remaining balance and persist the refund request.
 * The route audits "refund.requested" right after this.
 */
export async function createRefund(tx: Db, user: CurrentUser, input: RequestRefundInput, idempotencyKey: string) {
  const amountCents = Math.round(input.amount * 100);
  const charge = await reserveBalance(tx, input.chargeId, amountCents);
  return tx.refund.create({
    data: {
      idempotencyKey,
      customerName: charge.customerName,
      customerEmail: charge.customerEmail,
      chargeId: charge.id,
      currency: charge.currency,
      amountCents,
      reason: input.reason,
      note: input.note,
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
    customerName: created.customerName,
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
    existing.reason !== input.reason ||
    (existing.note ?? null) !== input.note
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
    return p.customerName ? `Refund ${dollars(p.amountCents)} to ${p.customerName}` : `Refund ${dollars(p.amountCents)} on ${p.chargeId}`;
  },
  href: (refundId) => `/apps/refunds?refund=${refundId}`,
  async onApproved({ tx, request, payload, decider }) {
    const { before, after } = await claimPendingRefund(tx, request.entityId, "processing", payload as RefundApprovalPayload);
    await executeRefund(tx, after, decider.id, before);
  },
  async onRejected({ tx, request, decider }) {
    const { before, after } = await claimPendingRefund(tx, request.entityId, "rejected");
    await settleBalance(tx, after, "released");
    await audit(
      { actorId: decider.id, action: "refund.rejected", entityType: REFUND_ENTITY, entityId: after.id, before: refundAuditSnapshot(before), after: refundAuditSnapshot(after) },
      tx,
    );
  },
};

// ---------- Read models for the UI ----------

export const REFUND_STATUSES = ["pending_approval", "processing", "executed", "rejected", "failed"] as const;
/** List tabs. "mine" = pending refunds the current user is allowed to decide. */
export const REFUND_TABS = ["mine", "pending_approval", "executed", "rejected", "all"] as const;
export type RefundTab = (typeof REFUND_TABS)[number];
export const REFUND_SORTS = ["newest", "oldest", "amount_desc", "amount_asc"] as const;
export type RefundSort = (typeof REFUND_SORTS)[number];

export type RefundQuery = {
  tab?: string;
  q?: string;
  min?: string;
  max?: string;
  from?: string;
  to?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
};

const ORDER: Record<RefundSort, Prisma.RefundOrderByWithRelationInput> = {
  newest: { createdAt: "desc" },
  oldest: { createdAt: "asc" },
  amount_desc: { amountCents: "desc" },
  amount_asc: { amountCents: "asc" },
};

const toCents = (v?: string) => {
  const n = Number(v);
  return v && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};

/** Search + amount + date filters (everything except the tab). */
function filterWhere(query: RefundQuery): Prisma.RefundWhereInput {
  const q = query.q?.trim();
  const min = toCents(query.min);
  const max = toCents(query.max);
  const from = parseDay(query.from);
  const to = parseDay(query.to, true);
  return {
    // SQLite LIKE is case-insensitive for ASCII, so `contains` matches regardless of case.
    OR: q ? [{ customerName: { contains: q } }, { customerEmail: { contains: q } }, { chargeId: { contains: q } }, { id: q }] : undefined,
    amountCents: min !== undefined || max !== undefined ? { gte: min, lte: max } : undefined,
    createdAt: from || to ? { gte: from, lte: to } : undefined,
  };
}

function tabWhere(tab: RefundTab, user: CurrentUser): Prisma.RefundWhereInput {
  switch (tab) {
    case "mine":
      // Maker-checker: you can never decide your own request, and only approvers decide.
      return user.roles.includes("approver") ? { status: "pending_approval", requestedById: { not: user.id } } : { id: "__none__" };
    case "all":
      return {};
    default:
      return { status: tab };
  }
}

export function resolveTab(tab: string | undefined, user: CurrentUser): RefundTab {
  if ((REFUND_TABS as readonly string[]).includes(tab ?? "")) return tab as RefundTab;
  return user.roles.includes("approver") ? "mine" : "all";
}

/** Filtered, sorted, paginated refunds plus per-tab counts for the current filters. */
export async function queryRefunds(db: Db, user: CurrentUser, query: RefundQuery) {
  const pageSize = query.pageSize ?? 15;
  const page = Math.max(1, query.page ?? 1);
  const sort = (REFUND_SORTS as readonly string[]).includes(query.sort ?? "") ? (query.sort as RefundSort) : "newest";
  const tab = resolveTab(query.tab, user);
  const filters = filterWhere(query);
  const where = { AND: [filters, tabWhere(tab, user)] };
  const [rows, total, ...tabCounts] = await Promise.all([
    db.refund.findMany({ where, include: { requestedBy: true }, orderBy: ORDER[sort], skip: (page - 1) * pageSize, take: pageSize }),
    db.refund.count({ where }),
    ...REFUND_TABS.map((t) => db.refund.count({ where: { AND: [filters, tabWhere(t, user)] } })),
  ]);
  const counts = Object.fromEntries(REFUND_TABS.map((t, i) => [t, tabCounts[i]])) as Record<RefundTab, number>;
  return { rows, total, counts, tab, page, pageSize, sort };
}

/** All refunds matching the list filters (no pagination), for CSV export. */
export async function exportRefunds(db: Db, user: CurrentUser, query: RefundQuery) {
  const tab = resolveTab(query.tab, user);
  return db.refund.findMany({ where: { AND: [filterWhere(query), tabWhere(tab, user)] }, include: { requestedBy: true }, orderBy: { createdAt: "desc" } });
}

export async function getRefund(db: Db, id: string) {
  const refund = await db.refund.findUnique({ where: { id }, include: { requestedBy: true, charge: true } });
  if (!refund) return null;
  const approval = refund.approvalRequestId
    ? await db.approvalRequest.findUnique({ where: { id: refund.approvalRequestId }, include: { requestedBy: true, approvedBy: true, rejectedBy: true } })
    : null;
  return { refund, approval };
}

export async function refundStats(db: Db, now = new Date()) {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const [today, pending] = await Promise.all([
    db.refund.aggregate({ where: { status: "executed", updatedAt: { gte: startOfDay } }, _sum: { amountCents: true }, _count: { _all: true } }),
    db.refund.aggregate({ where: { status: "pending_approval" }, _sum: { amountCents: true }, _count: { _all: true } }),
  ]);
  return {
    executedToday: { count: today._count._all, cents: today._sum.amountCents ?? 0 },
    pending: { count: pending._count._all, cents: pending._sum.amountCents ?? 0 },
  };
}
