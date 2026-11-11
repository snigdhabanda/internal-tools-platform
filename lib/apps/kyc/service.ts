import { z } from "zod";
import type { Db } from "@/lib/db";
import { kycVendor } from "@/lib/integrations/kyc";
import type { CurrentUser } from "@/lib/platform/auth";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/platform/errors";
import { requireRole } from "@/lib/platform/rbac";
import { auditSnapshot, presentCase } from "./present";
import { KYC_ACTIONS, findTransition } from "./state-machine";

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
