import type { AppManifest } from "./apps";
import { parseDay } from "@/lib/dates";
import type { AuditFilters } from "./audit";

/** Entity types that belong to the platform itself rather than an app. */
export const PLATFORM_ENTITY_TYPES = ["ApprovalRequest", "User", "AuditLog"];

/** Query-string filters shared by the /audit page and its CSV export. `app` is an app id or "platform". */
export function parseAuditFilters(q: Record<string, string | undefined>, apps: AppManifest[]): AuditFilters {
  const app = q.app === "platform" ? { entityTypes: PLATFORM_ENTITY_TYPES } : apps.find((a) => a.id === q.app);
  return {
    actorId: q.actorId || undefined,
    action: q.action || undefined,
    entityType: q.entityType || undefined,
    entityTypes: app?.entityTypes,
    entityId: q.entityId || undefined,
    from: parseDay(q.from),
    to: parseDay(q.to, true),
  };
}
