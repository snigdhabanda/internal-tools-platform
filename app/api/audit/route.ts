import { NextResponse } from "next/server";
import { listAuditLogs } from "@/lib/platform/audit";
import { getUserFromRequest } from "@/lib/platform/auth";
import { route } from "@/lib/platform/http";
import { requireRole } from "@/lib/platform/rbac";

export const GET = route(async (req) => {
  requireRole(await getUserFromRequest(req), ["admin"]);
  const q = req.nextUrl.searchParams;
  const logs = await listAuditLogs({
    actorId: q.get("actorId") ?? undefined,
    action: q.get("action") ?? undefined,
    entityType: q.get("entityType") ?? undefined,
    entityId: q.get("entityId") ?? undefined,
  });
  return NextResponse.json(logs);
});
