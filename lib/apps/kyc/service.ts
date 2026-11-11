import type { KycCase, Prisma } from "@prisma/client";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { kycVendor } from "@/lib/integrations/kyc";
import { createApprovalRequest, type ApprovalHandler } from "@/lib/platform/approvals";
import { audit } from "@/lib/platform/audit";
import type { CurrentUser } from "@/lib/platform/auth";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/platform/errors";
import { requireRole } from "@/lib/platform/rbac";
import { auditSnapshot, presentCase, type KycCaseView } from "./present";
import { KYC_ACTIONS, KYC_REASON_CODES, availableActions, findTransition, reasonLabel } from "./state-machine";

export const KYC_ENTITY = "KycCase";

/** approve/reject/escalate need a reason code for that action plus a note; claim takes neither. */
export const transitionSchema = z
  .object({
    action: z.enum(KYC_ACTIONS),
    reasonCode: z.string().optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .superRefine((b, ctx) => {
    if (b.action === "claim") return;
    const codes = KYC_REASON_CODES[b.action];
    if (!b.reasonCode || !(b.reasonCode in codes)) {
      ctx.addIssue({ code: "custom", path: ["reasonCode"], message: `A reason code is required to ${b.action}: one of ${Object.keys(codes).join(", ")}` });
    }
    if (!b.note || b.note.length < 3) ctx.addIssue({ code: "custom", path: ["note"], message: `A note is required to ${b.action}` });
  });
export type TransitionInput = z.infer<typeof transitionSchema>;

const SSN = /^\d{3}-\d{2}-\d{4}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * CIP intake (31 CFR 1020.220): name, DOB, residential address, and an identification number.
 * US persons are identified by TIN (SSN). Non-US persons by passport (+ issuing country + expiry)
 * or another government ID (+ issuing country), and must never carry an SSN.
 */
export const createCaseSchema = z
  .object({
    applicantName: z.string().trim().min(2).max(200),
    email: z.string().trim().email(),
    dateOfBirth: z.string().regex(DAY, "YYYY-MM-DD"),
    addressLine1: z.string().trim().min(3).max(200),
    addressLine2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    region: z.string().trim().min(1).max(100),
    postalCode: z.string().trim().min(2).max(20),
    country: z.string().regex(/^[A-Z]{2}$/, "ISO country code"),
    isUSPerson: z.boolean(),
    idType: z.enum(["ssn", "passport", "other_gov_id"]),
    idNumber: z.string().trim().min(4).max(40),
    idCountry: z.string().regex(/^[A-Z]{2}$/).optional(),
    idExpiry: z.string().regex(DAY, "YYYY-MM-DD").optional(),
  })
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (c.isUSPerson) {
      if (c.idType !== "ssn") issue("idType", "US persons must be identified by their TIN (SSN)");
      else if (!SSN.test(c.idNumber)) issue("idNumber", "SSN must look like 123-45-6789");
    } else {
      if (c.idType === "ssn" || SSN.test(c.idNumber)) issue("idType", "Non-US persons must not have an SSN; use a passport or other government ID");
      if (!c.idCountry) issue("idCountry", "Issuing country is required for a passport or government ID");
      if (c.idType === "passport" && !c.idExpiry) issue("idExpiry", "Passport expiry is required");
    }
  });
export type CreateCaseInput = z.infer<typeof createCaseSchema>;

export async function createCase(tx: Db, input: CreateCaseInput) {
  return tx.kycCase.create({ data: { ...input, idCountry: input.isUSPerson ? null : input.idCountry, idExpiry: input.idType === "passport" ? input.idExpiry : null } });
}

export async function listCases(db: Db, user: CurrentUser) {
  const cases = await db.kycCase.findMany({ include: { assignedTo: true }, orderBy: { createdAt: "asc" } });
  return cases.map((c) => presentCase(c, user));
}

const allChecksPass = (c: KycCase) => [c.identityCheck, c.documentCheck, c.sanctionsCheck, c.pepCheck].every((r) => r === "pass");

type RejectionPayload = { caseId: string; reasonCode: string; fromStatus: string };

/**
 * Applies a state-machine transition. Throws 409 for transitions not in KYC_TRANSITIONS and
 * 403 when the user lacks the transition's role. Rejecting a case whose vendor checks all passed
 * doesn't reject it yet: it moves to pending_rejection and needs a different approver's sign-off.
 * Returns non-PII before/after snapshots for audit.
 */
export async function transitionCase(tx: Db, user: CurrentUser, caseId: string, input: TransitionInput) {
  const { action } = input;
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

  const needsSecondApprover = action === "reject" && allChecksPass(current);
  const to = needsSecondApprover ? "pending_rejection" : transition.to;
  const data: Prisma.KycCaseUncheckedUpdateManyInput = { status: to };
  if (action === "claim") {
    data.assignedToId = user.id;
    const check = await kycVendor.runCheck(current);
    data.vendorCheckId = check.checkId;
    data.identityCheck = check.checks.identity;
    data.documentCheck = check.checks.document;
    data.sanctionsCheck = check.checks.sanctions;
    data.pepCheck = check.checks.pep;
    data.riskScore = check.riskScore;
  } else {
    Object.assign(data, { decisionReason: input.reasonCode, decisionNote: input.note, decidedById: user.id, decidedAt: new Date() });
  }
  if (action === "escalate") data.escalatedById = user.id;

  // Conditional update: fails if someone else moved the case concurrently.
  const { count } = await tx.kycCase.updateMany({ where: { id: caseId, status: current.status }, data });
  if (count !== 1) throw new ConflictError("Case was modified concurrently; reload and retry");

  if (needsSecondApprover) {
    const payload: RejectionPayload = { caseId, reasonCode: input.reasonCode!, fromStatus: current.status };
    const request = await createApprovalRequest(tx, { entityType: KYC_ENTITY, entityId: caseId, payload, requestedBy: user });
    await tx.kycCase.update({ where: { id: caseId }, data: { approvalRequestId: request.id } });
  }
  const updated = await tx.kycCase.findUniqueOrThrow({ where: { id: caseId } });
  return { transition: { ...transition, to }, before: auditSnapshot(current), after: auditSnapshot(updated), view: presentCase(updated, user) };
}

/** Second sign-off for rejecting a case whose vendor checks all passed. */
export const kycRejectionApprovalHandler: ApprovalHandler = {
  summarize(payload) {
    const p = payload as RejectionPayload;
    return `Reject all-clear KYC case (${reasonLabel(p.reasonCode)})`;
  },
  href: (caseId) => `/apps/kyc?tab=all&case=${caseId}`,
  async describe(db, requests) {
    const cases = await db.kycCase.findMany({ where: { id: { in: requests.map((r) => r.entityId) } }, select: { id: true, applicantName: true } });
    const names = new Map(cases.map((c) => [c.id, c.applicantName]));
    return new Map(requests.map((r) => [r.id, `Reject KYC: ${names.get(r.entityId) ?? r.entityId} (${reasonLabel((JSON.parse(r.payload) as RejectionPayload).reasonCode)})`]));
  },
  async onApproved({ tx, request, decider }) {
    await settleRejection(tx, request.entityId, decider, "rejected", "kyc.reject_approved");
  },
  async onRejected({ tx, request, payload, decider }) {
    await settleRejection(tx, request.entityId, decider, (payload as RejectionPayload).fromStatus, "kyc.reject_declined");
  },
};

async function settleRejection(tx: Db, caseId: string, decider: CurrentUser, status: string, action: string) {
  const before = await tx.kycCase.findUnique({ where: { id: caseId } });
  if (!before) throw new NotFoundError("KYC case not found");
  const { count } = await tx.kycCase.updateMany({ where: { id: caseId, status: "pending_rejection" }, data: { status } });
  if (count !== 1) throw new ConflictError(`Case is ${before.status}, not pending rejection`);
  const after = await tx.kycCase.findUniqueOrThrow({ where: { id: caseId } });
  await audit({ actorId: decider.id, action, entityType: KYC_ENTITY, entityId: caseId, before: auditSnapshot(before), after: auditSnapshot(after) }, tx);
}

// ---------- Read models for the UI ----------

export const KYC_TABS = ["open", "submitted", "in_review", "escalated", "pending_rejection", "approved", "rejected", "all"] as const;
export type KycTab = (typeof KYC_TABS)[number];
const OPEN_STATUSES = ["submitted", "in_review", "escalated", "pending_rejection"];

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
    pending_rejection: byStatus.pending_rejection ?? 0,
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
