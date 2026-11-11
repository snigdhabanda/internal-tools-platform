import type { KycCase } from "@prisma/client";
import type { CurrentUser } from "@/lib/platform/auth";
import { hasRole } from "@/lib/platform/rbac";

/**
 * Server-side PII masking. Every KYC read path must go through presentCase(); raw KycCase
 * rows must never be sent to the client or written to the audit log.
 */

export function maskSsn(ssn: string) {
  const last4 = ssn.replace(/\D/g, "").slice(-4);
  return `•••-••-${last4}`;
}

export function maskIdNumber(id: string) {
  const last4 = id.slice(-4);
  return `${"•".repeat(Math.max(id.length - 4, 4))}${last4}`;
}

export function canViewPii(user: CurrentUser | null) {
  return hasRole(user, "approver");
}

export type KycCaseView = Omit<KycCase, "ssn" | "idNumber"> & {
  ssn: string;
  idNumber: string;
  piiMasked: boolean;
  assignedToName: string | null;
};

export function presentCase(
  kycCase: KycCase & { assignedTo?: { name: string } | null },
  user: CurrentUser | null,
): KycCaseView {
  const { assignedTo, ...rest } = kycCase;
  const reveal = canViewPii(user);
  return {
    ...rest,
    ssn: reveal ? kycCase.ssn : maskSsn(kycCase.ssn),
    idNumber: reveal ? kycCase.idNumber : maskIdNumber(kycCase.idNumber),
    piiMasked: !reveal,
    assignedToName: assignedTo?.name ?? null,
  };
}

/** Non-PII snapshot for audit before/after fields. */
export function auditSnapshot(kycCase: KycCase) {
  return {
    status: kycCase.status,
    assignedToId: kycCase.assignedToId,
    escalatedById: kycCase.escalatedById,
    vendorCheckId: kycCase.vendorCheckId,
    vendorResult: kycCase.vendorResult,
    riskScore: kycCase.riskScore,
  };
}
