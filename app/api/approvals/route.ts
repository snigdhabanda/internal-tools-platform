import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { approvalHandlers } from "@/lib/apps/registry";
import { listPendingApprovals, summarizeApprovals } from "@/lib/platform/approvals";
import { getUserFromRequest } from "@/lib/platform/auth";
import { route } from "@/lib/platform/http";
import { requireRole } from "@/lib/platform/rbac";

export const GET = route(async (req) => {
  requireRole(await getUserFromRequest(req), ["approver", "reviewer", "admin"]);
  const handlers = approvalHandlers();
  const pending = await listPendingApprovals(prisma);
  const labels = await summarizeApprovals(prisma, pending, handlers);
  return NextResponse.json(
    pending.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      summary: labels.get(r.id),
      requestedBy: { id: r.requestedBy.id, name: r.requestedBy.name },
      createdAt: r.createdAt,
    })),
  );
});
