import { APPS } from "@/lib/apps/registry";
import { audit, listAuditLogs } from "@/lib/platform/audit";
import { getUserFromRequest } from "@/lib/platform/auth";
import { csvResponse } from "@/lib/platform/csv";
import { route } from "@/lib/platform/http";
import { requireRole } from "@/lib/platform/rbac";
import { parseAuditFilters } from "@/lib/platform/audit-filters";

/** CSV of the audit log with the same filters as /audit. The export itself is audited. */
export const GET = route(async (req) => {
  const user = requireRole(await getUserFromRequest(req), ["admin"]);
  const filters = parseAuditFilters(Object.fromEntries(req.nextUrl.searchParams), APPS);
  const logs = await listAuditLogs({ ...filters, limit: 1000 });
  await audit({ actorId: user.id, action: "audit.exported", entityType: "AuditLog", entityId: "export", after: { rows: logs.length, filters: Object.fromEntries(req.nextUrl.searchParams) } });
  return csvResponse(
    "audit-log",
    ["id", "timestamp", "actor_id", "action", "entity_type", "entity_id", "before", "after"],
    logs.map((l) => [l.id, l.timestamp.toISOString(), l.actorId, l.action, l.entityType, l.entityId, l.before, l.after]),
  );
});
