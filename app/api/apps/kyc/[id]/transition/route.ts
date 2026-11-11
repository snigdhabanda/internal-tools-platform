import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { KYC_ENTITY, transitionCase, transitionSchema } from "@/lib/apps/kyc/service";
import { audit } from "@/lib/platform/audit";
import { getUserFromRequest } from "@/lib/platform/auth";
import { parseBody, route } from "@/lib/platform/http";
import { requireRole } from "@/lib/platform/rbac";

/** Coarse gate here; transitionCase() additionally requires the specific transition's role. */
export const POST = route(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const user = requireRole(await getUserFromRequest(req), ["reviewer", "approver"]);
  const { id } = await params;
  const { action } = await parseBody(req, transitionSchema);

  const view = await prisma.$transaction(async (tx) => {
    const result = await transitionCase(tx, user, id, action);
    await audit(
      { actorId: user.id, action: `kyc.${action}`, entityType: KYC_ENTITY, entityId: id, before: result.before, after: result.after },
      tx,
    );
    return result.view;
  });

  return NextResponse.json(view);
});
