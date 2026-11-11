import type { Role } from "@/lib/platform/roles";

export const KYC_STATUSES = ["submitted", "in_review", "approved", "rejected", "escalated"] as const;
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
