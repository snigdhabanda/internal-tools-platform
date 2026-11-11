import { prisma, type Db } from "@/lib/db";

/**
 * Append-only audit trail.
 *
 * This module deliberately exposes NO update or delete functions, and the database has
 * triggers rejecting UPDATE/DELETE on AuditLog. tests/audit.test.ts proves both.
 * Every write route must call audit() (enforced by tests/guardrails.test.ts).
 */

export type AuditEvent = {
  actorId: string;
  /** dot-namespaced verb, e.g. "refund.requested" */
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
};

const serialize = (value: unknown) => (value === undefined || value === null ? null : JSON.stringify(value));

/** Record an audit event. Pass a transaction client to make it atomic with the write it describes. */
export async function audit(event: AuditEvent, db: Db = prisma) {
  return db.auditLog.create({
    data: {
      actorId: event.actorId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      before: serialize(event.before),
      after: serialize(event.after),
    },
  });
}

export type AuditFilters = {
  actorId?: string;
  action?: string;
  entityType?: string;
  /** Any of these entity types (e.g. all types belonging to one app). */
  entityTypes?: string[];
  entityId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
};

export async function listAuditLogs(filters: AuditFilters = {}) {
  return prisma.auditLog.findMany({
    where: {
      actorId: filters.actorId || undefined,
      action: filters.action ? { contains: filters.action } : undefined,
      entityType: filters.entityType || (filters.entityTypes ? { in: filters.entityTypes } : undefined),
      entityId: filters.entityId || undefined,
      timestamp: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
    },
    orderBy: { timestamp: "desc" },
    take: Math.min(filters.limit ?? 200, 1000),
  });
}

export async function listAuditFacets() {
  const [entityTypes, actions] = await Promise.all([
    prisma.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  return { entityTypes: entityTypes.map((e) => e.entityType), actions: actions.map((a) => a.action) };
}

/** History of one or more entities (e.g. a refund and its approval request), oldest first. */
export async function listEntityHistory(entities: { entityType: string; entityId: string }[]) {
  if (entities.length === 0) return [];
  return prisma.auditLog.findMany({
    where: { OR: entities.map((e) => ({ entityType: e.entityType, entityId: e.entityId })) },
    orderBy: { timestamp: "asc" },
  });
}

/** Most recent entries, for activity feeds. */
export async function listRecentAudit(take = 8, excludeActions: string[] = ["session.switched"]) {
  return prisma.auditLog.findMany({ where: { action: { notIn: excludeActions } }, orderBy: { timestamp: "desc" }, take });
}
