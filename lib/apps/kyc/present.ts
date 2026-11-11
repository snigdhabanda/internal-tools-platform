import type { KycCase } from "@prisma/client";
import type { CurrentUser } from "@/lib/platform/auth";
import { hasRole } from "@/lib/platform/rbac";

/**
 * Server-side PII masking. Every KYC read path must go through presentCase(); raw KycCase
 * rows must never be sent to the client or written to the audit log.
 * Masked for non-approvers: ID number (TIN/passport/other ID), date of birth, street address and postal code.
 */

export function maskSsn(ssn: string) {
  const last4 = ssn.replace(/\D/g, "").slice(-4);
  return `•••-••-${last4}`;
}

export function maskIdNumber(id: string) {
  const last4 = id.slice(-4);
  return `${"•".repeat(Math.max(id.length - 4, 4))}${last4}`;
}

export const maskDob = () => "••••-••-••";
export const maskText = (v: string | null) => (v ? "•".repeat(Math.min(Math.max(v.length, 4), 16)) : v);

export function canViewPii(user: CurrentUser | null) {
  return hasRole(user, "approver");
}

export const ID_TYPE_LABELS: Record<string, string> = { ssn: "SSN (TIN)", passport: "Passport", other_gov_id: "Government ID" };

export type KycCaseView = KycCase & { piiMasked: boolean; assignedToName: string | null };

export function presentCase(kycCase: KycCase & { assignedTo?: { name: string } | null }, user: CurrentUser | null): KycCaseView {
  const { assignedTo, ...rest } = kycCase;
  const reveal = canViewPii(user);
  if (reveal) return { ...rest, piiMasked: false, assignedToName: assignedTo?.name ?? null };
  return {
    ...rest,
    idNumber: kycCase.idType === "ssn" ? maskSsn(kycCase.idNumber) : maskIdNumber(kycCase.idNumber),
    dateOfBirth: maskDob(),
    addressLine1: maskText(kycCase.addressLine1)!,
    addressLine2: maskText(kycCase.addressLine2),
    postalCode: maskText(kycCase.postalCode)!,
    piiMasked: true,
    assignedToName: assignedTo?.name ?? null,
  };
}

/** Non-PII snapshot for audit before/after fields. */
export function auditSnapshot(kycCase: KycCase) {
  return {
    status: kycCase.status,
    isUSPerson: kycCase.isUSPerson,
    idType: kycCase.idType,
    assignedToId: kycCase.assignedToId,
    escalatedById: kycCase.escalatedById,
    vendorCheckId: kycCase.vendorCheckId,
    identityCheck: kycCase.identityCheck,
    documentCheck: kycCase.documentCheck,
    sanctionsCheck: kycCase.sanctionsCheck,
    pepCheck: kycCase.pepCheck,
    riskScore: kycCase.riskScore,
    decisionReason: kycCase.decisionReason,
    decisionNote: kycCase.decisionNote,
    decidedById: kycCase.decidedById,
    approvalRequestId: kycCase.approvalRequestId,
  };
}
