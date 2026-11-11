import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createCase, createCaseSchema, KYC_ENTITY, listCases } from "@/lib/apps/kyc/service";
import { auditSnapshot, presentCase } from "@/lib/apps/kyc/present";
import { audit } from "@/lib/platform/audit";
import { getUserFromRequest } from "@/lib/platform/auth";
import { parseBody, route } from "@/lib/platform/http";
import { requireRole } from "@/lib/platform/rbac";

export const GET = route(async (req) => {
  const user = requireRole(await getUserFromRequest(req), ["reviewer", "approver", "admin"]);
  return NextResponse.json(await listCases(prisma, user));
});

/** CIP intake. Validation enforces the identifier rules (TIN for US persons, never an SSN otherwise). */
export const POST = route(async (req) => {
  const user = requireRole(await getUserFromRequest(req), ["reviewer"]);
  const input = await parseBody(req, createCaseSchema);
  const created = await prisma.$transaction(async (tx) => {
    const c = await createCase(tx, input);
    await audit({ actorId: user.id, action: "kyc.created", entityType: KYC_ENTITY, entityId: c.id, after: auditSnapshot(c) }, tx);
    return c;
  });
  return NextResponse.json(presentCase(created, user), { status: 201 });
});
