import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createRefund, listRefunds, processRefund, REFUND_ENTITY, requestRefundSchema } from "@/lib/apps/refunds/service";
import { audit } from "@/lib/platform/audit";
import { getUserFromRequest } from "@/lib/platform/auth";
import { parseBody, route } from "@/lib/platform/http";
import { requireRole } from "@/lib/platform/rbac";

export const GET = route(async (req) => {
  requireRole(await getUserFromRequest(req), ["reviewer", "approver", "admin"]);
  return NextResponse.json(await listRefunds(prisma));
});

export const POST = route(async (req) => {
  const user = requireRole(await getUserFromRequest(req), ["reviewer"]);
  const input = await parseBody(req, requestRefundSchema);

  const result = await prisma.$transaction(async (tx) => {
    const created = await createRefund(tx, user, input);
    await audit({ actorId: user.id, action: "refund.requested", entityType: REFUND_ENTITY, entityId: created.id, after: created }, tx);
    return processRefund(tx, user, created);
  });

  return NextResponse.json(result, { status: 201 });
});
