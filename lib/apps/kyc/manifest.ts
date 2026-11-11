import type { AppManifest } from "@/lib/platform/apps";
import { KYC_ENTITY, kycRejectionApprovalHandler } from "./service";

export const kycApp: AppManifest = {
  id: "kyc",
  name: "KYC Review",
  description: "Work the KYC case queue: claim, approve, reject, or escalate.",
  roles: ["reviewer", "approver", "admin"],
  entityTypes: [KYC_ENTITY],
  approvalHandlers: { [KYC_ENTITY]: kycRejectionApprovalHandler },
};
