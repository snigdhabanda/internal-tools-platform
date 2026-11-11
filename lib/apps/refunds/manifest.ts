import type { AppManifest } from "@/lib/platform/apps";
import { REFUND_ENTITY, refundApprovalHandler } from "./service";

export const refundsApp: AppManifest = {
  id: "refunds",
  name: "Refunds",
  description: "Request and approve customer refunds. $500+ requires a second approver.",
  roles: ["reviewer", "approver", "admin"],
  approvalHandlers: { [REFUND_ENTITY]: refundApprovalHandler },
};
