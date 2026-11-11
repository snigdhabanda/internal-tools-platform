import type { ApprovalHandler } from "./approvals";
import type { Role } from "./roles";

/** What every internal app declares so the platform can list it in the nav and route approvals to it. */
export type AppManifest = {
  /** URL slug: the app lives at /apps/<id> and /api/apps/<id> */
  id: string;
  name: string;
  description: string;
  /** Roles that may see the app in the nav and open its pages. */
  roles: Role[];
  /** Maker-checker handlers keyed by ApprovalRequest.entityType. */
  approvalHandlers?: Record<string, ApprovalHandler>;
};
