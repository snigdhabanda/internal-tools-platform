import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { approvalHandlers } from "@/lib/apps/registry";
import { listPendingApprovals } from "@/lib/platform/approvals";
import { getUserFromRequest } from "@/lib/platform/auth";
import { route } from "@/lib/platform/http";
import { requireRole } from "@/lib/platform/rbac";

export const GET = route(async (req) => {
  requireRole(await getUserFromRequest(req), ["approver", "reviewer", "admin"]);
  const handlers = approvalHandlers();
  const pending = await listPendingApprovals(prisma);
  return NextResponse.json(
    pending.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      summary: handlers[r.entityType]?.summarize(JSON.parse(r.payload)) ?? r.entityType,
      requestedBy: { id: r.requestedBy.id, name: r.requestedBy.name },
      createdAt: r.createdAt,
    })),
  );
});
