import type { Role } from "@/lib/platform/roles";

export const KYC_STATUSES = ["submitted", "in_review", "approved", "rejected", "escalated", "pending_rejection"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const KYC_ACTIONS = ["claim", "approve", "reject", "escalate"] as const;
export type KycAction = (typeof KYC_ACTIONS)[number];

export type KycTransition = { action: KycAction; from: KycStatus; to: KycStatus; roles: Role[] };

/**
 * The complete set of legal transitions. Anything not listed is rejected by the server.
 *   submitted -> in_review -> approved | rejected | escalated
 *   escalated -> approved | rejected   (approvers only)
 */
export const KYC_TRANSITIONS: readonly KycTransition[] = [
  { action: "claim", from: "submitted", to: "in_review", roles: ["reviewer"] },
  { action: "approve", from: "in_review", to: "approved", roles: ["reviewer"] },
  { action: "reject", from: "in_review", to: "rejected", roles: ["reviewer"] },
  { action: "escalate", from: "in_review", to: "escalated", roles: ["reviewer"] },
  { action: "approve", from: "escalated", to: "approved", roles: ["approver"] },
  { action: "reject", from: "escalated", to: "rejected", roles: ["approver"] },
];

export function findTransition(from: string, action: string): KycTransition | null {
  return KYC_TRANSITIONS.find((t) => t.from === from && t.action === action) ?? null;
}

export function availableActions(from: string): KycTransition[] {
  return KYC_TRANSITIONS.filter((t) => t.from === from);
}

/** Decisions (everything but claim) need a reason code from this list plus a note. */
export const KYC_REASON_CODES = {
  approve: {
    identity_verified: "Identity verified by vendor checks",
    documents_verified_manually: "Documents verified manually",
    risk_accepted_after_review: "Risk reviewed and accepted",
  },
  reject: {
    identity_not_verified: "Identity could not be verified",
    document_invalid_or_expired: "Document invalid or expired",
    sanctions_match: "Confirmed sanctions/OFAC match",
    pep_risk_unacceptable: "PEP risk not acceptable",
    suspected_fraud: "Suspected fraud",
    incomplete_information: "Incomplete CIP information",
  },
  escalate: {
    potential_sanctions_match: "Potential sanctions/OFAC match",
    pep_match: "PEP match needs review",
    document_needs_review: "Document needs expert review",
    high_risk_score: "High risk score",
    other: "Other (see note)",
  },
} as const satisfies Record<Exclude<KycAction, "claim">, Record<string, string>>;

export const reasonLabel = (code: string | null | undefined) => {
  if (!code) return null;
  for (const group of Object.values(KYC_REASON_CODES)) if (code in group) return (group as Record<string, string>)[code];
  return code;
};
