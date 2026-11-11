import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { approvalHandlers } from "@/lib/apps/registry";
import { decideApproval } from "@/lib/platform/approvals";
import { audit } from "@/lib/platform/audit";
import { getUserFromRequest } from "@/lib/platform/auth";
import { parseBody, route } from "@/lib/platform/http";
import { requireRole } from "@/lib/platform/rbac";

const bodySchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    note: z.string().trim().max(500).optional(),
  })
  .refine((b) => b.decision !== "rejected" || (b.note && b.note.length >= 3), {
    message: "A reason is required when rejecting",
    path: ["note"],
  });

/** Generic maker-checker decision endpoint for every app's ApprovalRequests. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const user = requireRole(await getUserFromRequest(req), ["approver"]);
  const { id } = await params;
  const { decision, note } = await parseBody(req, bodySchema);

  const result = await prisma.$transaction(async (tx) => {
    const { before, after } = await decideApproval(tx, {
      requestId: id,
      decider: user,
      decision,
      note,
      handlers: approvalHandlers(),
    });
    await audit(
      { actorId: user.id, action: `approval.${decision}`, entityType: "ApprovalRequest", entityId: id, before, after },
      tx,
    );
    return after;
  });

  return NextResponse.json(result);
});
