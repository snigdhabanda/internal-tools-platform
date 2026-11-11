import type { AppManifest } from "@/lib/platform/apps";

export const kycApp: AppManifest = {
  id: "kyc",
  name: "KYC Review",
  description: "Work the KYC case queue: claim, approve, reject, or escalate.",
  roles: ["reviewer", "approver", "admin"],
  entityTypes: ["KycCase"],
};
