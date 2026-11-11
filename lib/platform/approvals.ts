import type { ApprovalRequest } from "@prisma/client";
import type { Db } from "@/lib/db";
import { audit } from "./audit";
import type { CurrentUser } from "./auth";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { requireRole } from "./rbac";

/**
 * Generic maker-checker approvals. Any app can:
 *   1. call createApprovalRequest() when an action needs a second pair of eyes, and
 *   2. register an ApprovalHandler for its entityType in lib/apps/registry.ts, which is
 *      invoked (inside the same transaction) when a checker approves or rejects.
 *
 * Invariants enforced here, not in apps:
 *   - only users with the "approver" role can decide
 *   - the decider can NEVER be the requester
 *   - a request can be decided exactly once
 */

export type ApprovalDecision = "approved" | "rejected";

export type ApprovalHandlerContext = {
  tx: Db;
  request: ApprovalRequest;
  payload: unknown;
  decider: CurrentUser;
};

export type ApprovalHandler = {
  /** Short human-readable description for approval inboxes. */
  summarize(payload: unknown): string;
  /** Optional link to the entity's detail page, for approval inboxes. */
  href?(entityId: string): string;
  /**
   * Optional richer inbox labels that may read the DB, e.g. to name a customer without putting
   * PII in the payload (payloads are copied into the append-only audit log). Keyed by request id.
   */
  describe?(db: Db, requests: ApprovalRequest[]): Promise<Map<string, string>>;
  onApproved(ctx: ApprovalHandlerContext): Promise<void>;
  onRejected(ctx: ApprovalHandlerContext): Promise<void>;
};

export async function createApprovalRequest(
  tx: Db,
  input: { entityType: string; entityId: string; payload: unknown; requestedBy: CurrentUser },
) {
  const request = await tx.approvalRequest.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      payload: JSON.stringify(input.payload),
      requestedById: input.requestedBy.id,
    },
  });
  await audit(
    {
      actorId: input.requestedBy.id,
      action: "approval.requested",
      entityType: "ApprovalRequest",
      entityId: request.id,
      after: request,
    },
    tx,
  );
  return request;
}

export function assertCanDecide(request: Pick<ApprovalRequest, "requestedById" | "status">, decider: CurrentUser) {
  requireRole(decider, ["approver"]);
  if (request.requestedById === decider.id) {
    throw new ForbiddenError("Maker-checker violation: you cannot approve or reject your own request");
  }
  if (request.status !== "pending") {
    throw new ConflictError(`Approval request is already ${request.status}`);
  }
}

/**
 * Decide a pending request. Must be called inside a transaction; the caller audits the decision.
 * Returns before/after snapshots of the ApprovalRequest for the audit entry.
 */
export async function decideApproval(
  tx: Db,
  input: {
    requestId: string;
    decider: CurrentUser;
    decision: ApprovalDecision;
    note?: string;
    handlers: Record<string, ApprovalHandler>;
  },
) {
  const before = await tx.approvalRequest.findUnique({ where: { id: input.requestId } });
  if (!before) throw new NotFoundError("Approval request not found");
  assertCanDecide(before, input.decider);

  const handler = input.handlers[before.entityType];
  if (!handler) throw new Error(`No approval handler registered for ${before.entityType}`);

  // Conditional update guards against two checkers deciding concurrently.
  const { count } = await tx.approvalRequest.updateMany({
    where: { id: before.id, status: "pending" },
    data: {
      status: input.decision,
      approvedById: input.decision === "approved" ? input.decider.id : null,
      rejectedById: input.decision === "rejected" ? input.decider.id : null,
      decisionNote: input.note ?? null,
      decidedAt: new Date(),
    },
  });
  if (count !== 1) throw new ConflictError("Approval request was already decided");

  const after = await tx.approvalRequest.findUniqueOrThrow({ where: { id: before.id } });
  const ctx: ApprovalHandlerContext = {
    tx,
    request: after,
    payload: JSON.parse(after.payload),
    decider: input.decider,
  };
  if (input.decision === "approved") await handler.onApproved(ctx);
  else await handler.onRejected(ctx);

  return { before, after };
}

export async function listPendingApprovals(db: Db) {
  return db.approvalRequest.findMany({
    where: { status: "pending" },
    include: { requestedBy: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function listDecidedApprovals(db: Db, take = 50) {
  return db.approvalRequest.findMany({
    where: { status: { not: "pending" } },
    include: { requestedBy: true, approvedBy: true, rejectedBy: true },
    orderBy: { decidedAt: "desc" },
    take,
  });
}

/** Inbox labels for approval requests: handler.describe() when available, else summarize(payload). */
export async function summarizeApprovals(db: Db, requests: ApprovalRequest[], handlers: Record<string, ApprovalHandler>) {
  const labels = new Map<string, string>();
  for (const [entityType, handler] of Object.entries(handlers)) {
    const own = requests.filter((r) => r.entityType === entityType);
    if (own.length === 0) continue;
    const described = handler.describe ? await handler.describe(db, own) : new Map<string, string>();
    for (const r of own) labels.set(r.id, described.get(r.id) ?? handler.summarize(JSON.parse(r.payload)));
  }
  for (const r of requests) if (!labels.has(r.id)) labels.set(r.id, `${r.entityType} ${r.entityId}`);
  return labels;
}
