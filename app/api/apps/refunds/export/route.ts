import { prisma } from "@/lib/db";
import { REFUND_ENTITY, exportRefunds, reasonLabel } from "@/lib/apps/refunds/service";
import { audit } from "@/lib/platform/audit";
import { getUserFromRequest } from "@/lib/platform/auth";
import { csvResponse } from "@/lib/platform/csv";
import { route } from "@/lib/platform/http";
import { requireRole } from "@/lib/platform/rbac";

const FILTERS = ["tab", "q", "min", "max", "from", "to", "sort"] as const;

/** CSV export of refunds matching the list filters. Exports contain customer PII, so each one is audited. */
export const GET = route(async (req) => {
  const user = requireRole(await getUserFromRequest(req), ["reviewer", "approver", "admin"]);
  const filters = Object.fromEntries(FILTERS.map((k) => [k, req.nextUrl.searchParams.get(k) ?? undefined]));

  const rows = await exportRefunds(prisma, user, filters);
  // The search term may be a customer email; record only that a search was applied, not its value.
  const audited = { ...filters, q: filters.q ? "[redacted]" : undefined };
  await audit({ actorId: user.id, action: "refund.exported", entityType: REFUND_ENTITY, entityId: "export", after: { rows: rows.length, filters: audited } });

  return csvResponse(
    "refunds",
    ["id", "created_at", "customer_name", "customer_email", "charge_id", "amount", "currency", "reason", "note", "status", "requested_by", "provider_refund_id"],
    rows.map((r) => [r.id, r.createdAt.toISOString(), r.customerName, r.customerEmail, r.chargeId, (r.amountCents / 100).toFixed(2), r.currency, reasonLabel(r.reason), r.note, r.status, r.requestedBy.name, r.providerRefundId]),
  );
});
