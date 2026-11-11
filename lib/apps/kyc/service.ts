import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { kycVendor } from "@/lib/integrations/kyc";
import type { CurrentUser } from "@/lib/platform/auth";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/platform/errors";
import { requireRole } from "@/lib/platform/rbac";
import { auditSnapshot, presentCase, type KycCaseView } from "./present";
import { KYC_ACTIONS, availableActions, findTransition } from "./state-machine";

export const KYC_ENTITY = "KycCase";

export const transitionSchema = z.object({ action: z.enum(KYC_ACTIONS) });

export async function listCases(db: Db, user: CurrentUser) {
  const cases = await db.kycCase.findMany({ include: { assignedTo: true }, orderBy: { createdAt: "asc" } });
  return cases.map((c) => presentCase(c, user));
}

/**
 * Applies a state-machine transition. Throws 409 for transitions not in KYC_TRANSITIONS and
 * 403 when the user lacks the transition's role. Returns non-PII before/after snapshots for audit.
 */
export async function transitionCase(tx: Db, user: CurrentUser, caseId: string, action: string) {
  const current = await tx.kycCase.findUnique({ where: { id: caseId } });
  if (!current) throw new NotFoundError("KYC case not found");

  const transition = findTransition(current.status, action);
  if (!transition) throw new ConflictError(`Invalid transition: cannot ${action} a case that is ${current.status}`);
  requireRole(user, transition.roles);

  if (current.status === "in_review" && current.assignedToId !== user.id) {
    throw new ForbiddenError("Only the reviewer who claimed this case can act on it");
  }
  if (current.status === "escalated" && current.escalatedById === user.id) {
    throw new ForbiddenError("Maker-checker violation: you escalated this case, a different approver must resolve it");
  }

  const data: Parameters<typeof tx.kycCase.update>[0]["data"] = { status: transition.to };
  if (transition.action === "claim") {
    data.assignedToId = user.id;
    const check = await kycVendor.runCheck(current);
    data.vendorCheckId = check.checkId;
    data.vendorResult = check.result;
    data.riskScore = check.riskScore;
  }
  if (transition.action === "escalate") data.escalatedById = user.id;

  // Conditional update: fails if someone else moved the case concurrently.
  const { count } = await tx.kycCase.updateMany({ where: { id: caseId, status: current.status }, data });
  if (count !== 1) throw new ConflictError("Case was modified concurrently; reload and retry");
  const updated = await tx.kycCase.findUniqueOrThrow({ where: { id: caseId } });

  return { transition, before: auditSnapshot(current), after: auditSnapshot(updated), view: presentCase(updated, user) };
}

// ---------- Read models for the UI ----------

export const KYC_TABS = ["open", "submitted", "in_review", "escalated", "approved", "rejected", "all"] as const;
export type KycTab = (typeof KYC_TABS)[number];
const OPEN_STATUSES = ["submitted", "in_review", "escalated"];

export type KycQuery = { tab?: string; q?: string; mine?: boolean; page?: number; pageSize?: number };

function caseWhere(user: CurrentUser, query: Pick<KycQuery, "q" | "mine">): Prisma.KycCaseWhereInput {
  const q = query.q?.trim();
  // Search covers non-PII fields only, so a masked SSN can't be probed by searching for it.
  return {
    assignedToId: query.mine ? user.id : undefined,
    OR: q ? [{ applicantName: { contains: q } }, { email: { contains: q } }, { id: q }] : undefined,
  };
}

function tabFilter(tab: KycTab): Prisma.KycCaseWhereInput {
  if (tab === "all") return {};
  if (tab === "open") return { status: { in: OPEN_STATUSES } };
  return { status: tab };
}

/** Filtered, paginated queue (masked via presentCase) plus per-tab counts. */
export async function queryCases(db: Db, user: CurrentUser, query: KycQuery) {
  const tab: KycTab = (KYC_TABS as readonly string[]).includes(query.tab ?? "") ? (query.tab as KycTab) : "open";
  const pageSize = query.pageSize ?? 15;
  const page = Math.max(1, query.page ?? 1);
  const base = caseWhere(user, query);
  const where = { AND: [base, tabFilter(tab)] };
  const [rows, total, grouped] = await Promise.all([
    db.kycCase.findMany({
      where,
      include: { assignedTo: true },
      // Oldest first: a review queue is worked in arrival order.
      orderBy: tab === "approved" || tab === "rejected" || tab === "all" ? { updatedAt: "desc" } : { createdAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.kycCase.count({ where }),
    db.kycCase.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
  ]);
  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  const counts: Record<KycTab, number> = {
    open: OPEN_STATUSES.reduce((n, s) => n + (byStatus[s] ?? 0), 0),
    submitted: byStatus.submitted ?? 0,
    in_review: byStatus.in_review ?? 0,
    escalated: byStatus.escalated ?? 0,
    approved: byStatus.approved ?? 0,
    rejected: byStatus.rejected ?? 0,
    all: grouped.reduce((n, g) => n + g._count._all, 0),
  };
  return { rows: rows.map((c) => presentCase(c, user)), total, counts, tab, page, pageSize };
}

export async function getCase(db: Db, user: CurrentUser, id: string) {
  const kycCase = await db.kycCase.findUnique({ where: { id }, include: { assignedTo: true } });
  if (!kycCase) return null;
  const escalatedBy = kycCase.escalatedById ? await db.user.findUnique({ where: { id: kycCase.escalatedById } }) : null;
  return { view: presentCase(kycCase, user), escalatedByName: escalatedBy?.name ?? null };
}

/**
 * Transitions this user could perform on the case, mirroring transitionCase()'s checks so the UI
 * only offers buttons that will succeed. The server still enforces every rule.
 */
export function actionsFor(user: CurrentUser, c: Pick<KycCaseView, "status" | "assignedToId" | "escalatedById">) {
  return availableActions(c.status).filter(
    (t) =>
      t.roles.some((r) => user.roles.includes(r)) &&
      (c.status !== "in_review" || c.assignedToId === user.id) &&
      (c.status !== "escalated" || c.escalatedById !== user.id),
  );
}

export async function kycStats(db: Db, user: CurrentUser) {
  const [grouped, oldest, mine, highRisk] = await Promise.all([
    db.kycCase.groupBy({ by: ["status"], _count: { _all: true } }),
    db.kycCase.findFirst({ where: { status: "submitted" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.kycCase.count({ where: { status: "in_review", assignedToId: user.id } }),
    db.kycCase.count({ where: { status: { in: OPEN_STATUSES }, riskScore: { gte: 70 } } }),
  ]);
  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  return {
    submitted: byStatus.submitted ?? 0,
    inReview: byStatus.in_review ?? 0,
    escalated: byStatus.escalated ?? 0,
    open: OPEN_STATUSES.reduce((n, s) => n + (byStatus[s] ?? 0), 0),
    oldestSubmittedAt: oldest?.createdAt ?? null,
    assignedToMe: mine,
    highRisk,
  };
}
