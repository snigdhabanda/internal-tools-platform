import { formatCents } from "@/lib/format";

/**
 * Refund approval controls. A refund needs maker-checker approval if ANY rule triggers.
 * Pure and dependency-free so the request form can preview the same decision the server makes.
 */
export const REFUND_CONTROLS = {
  /** A single refund at or above this amount. */
  singleRefundCents: 500_00,
  /** Executed + pending refunds on one charge, including this one (catches split refunds). */
  chargeCumulativeCents: 500_00,
  /** One requester's refunds within the rolling window, including this one. */
  requesterWindowCents: 2_000_00,
  requesterWindowHours: 24,
} as const;

export type RefundControls = typeof REFUND_CONTROLS;
export type ApprovalRule = "single_amount" | "charge_cumulative" | "requester_daily";
export type ApprovalTrigger = { rule: ApprovalRule; message: string };

export type ApprovalCheckInput = {
  amountCents: number;
  /** Charge balances before this refund. */
  chargeRefundedCents: number;
  chargePendingCents: number;
  /** The requester's executed, in-flight and pending refunds within the window, before this one. */
  requesterWindowCents: number;
};

/** Refund statuses that count toward cumulative totals (money moved or held). */
export const COUNTED_REFUND_STATUSES = ["processing", "pending_approval", "executed"];

export function approvalTriggers(input: ApprovalCheckInput, controls: RefundControls = REFUND_CONTROLS): ApprovalTrigger[] {
  const triggers: ApprovalTrigger[] = [];
  if (input.amountCents >= controls.singleRefundCents) {
    triggers.push({ rule: "single_amount", message: `refund amount is ${formatCents(controls.singleRefundCents)} or more` });
  }
  const priorOnCharge = input.chargeRefundedCents + input.chargePendingCents;
  const chargeTotal = priorOnCharge + input.amountCents;
  // With nothing refunded yet, a refund the single-amount rule already caught adds no new reason.
  if (chargeTotal >= controls.chargeCumulativeCents && !(priorOnCharge === 0 && triggers.length)) {
    triggers.push({
      rule: "charge_cumulative",
      message: `cumulative refunds on this charge exceed ${formatCents(controls.chargeCumulativeCents)} (${formatCents(chargeTotal)} incl. this one)`,
    });
  }
  const requesterTotal = input.requesterWindowCents + input.amountCents;
  if (requesterTotal >= controls.requesterWindowCents) {
    triggers.push({
      rule: "requester_daily",
      message: `requester's refunds in the last ${controls.requesterWindowHours}h exceed ${formatCents(controls.requesterWindowCents)} (${formatCents(requesterTotal)} incl. this one)`,
    });
  }
  return triggers;
}

/** "Needs approval: a; b" */
export const approvalSentence = (triggers: ApprovalTrigger[]) =>
  triggers.length ? `Needs approval: ${triggers.map((t) => t.message).join("; ")}` : null;
