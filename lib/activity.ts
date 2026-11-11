import type { AuditLog } from "@prisma/client";
import { humanize } from "@/lib/format";

type Tone = "emerald" | "rose" | "amber" | "indigo" | "slate";

const ACTIONS: Record<string, { label: string; tone: Tone }> = {
  "seed.created": { label: "Imported", tone: "slate" },
  "refund.requested": { label: "Refund requested", tone: "indigo" },
  "refund.duplicate_request": { label: "Duplicate request ignored (same Idempotency-Key)", tone: "slate" },
  "refund.processing": { label: "Refund sent to payment processor", tone: "indigo" },
  "refund.executed": { label: "Refund executed by payment processor", tone: "emerald" },
  "refund.failed": { label: "Refund failed at payment processor", tone: "rose" },
  "refund.rejected": { label: "Refund rejected", tone: "rose" },
  "refund.exported": { label: "Refunds exported to CSV", tone: "slate" },
  "approval.requested": { label: "Sent for approval", tone: "amber" },
  "approval.approved": { label: "Approved", tone: "emerald" },
  "approval.rejected": { label: "Rejected by approver", tone: "rose" },
  "kyc.claim": { label: "Claimed for review; vendor check run", tone: "indigo" },
  "kyc.approve": { label: "Case approved", tone: "emerald" },
  "kyc.reject": { label: "Case rejected", tone: "rose" },
  "kyc.escalate": { label: "Escalated to an approver", tone: "amber" },
  "session.switched": { label: "Signed in", tone: "slate" },
};

/** Human label and color for an audit action, for timelines and activity feeds. */
export function describeAction(action: string): { label: string; tone: Tone } {
  return ACTIONS[action] ?? { label: humanize(action), tone: "slate" };
}

export function actorName(entry: Pick<AuditLog, "actorId">, names: Map<string, string>) {
  if (entry.actorId === "system:seed") return "System";
  return names.get(entry.actorId) ?? entry.actorId;
}
