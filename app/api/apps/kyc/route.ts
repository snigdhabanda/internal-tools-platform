import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { listCases } from "@/lib/apps/kyc/service";
import { getUserFromRequest } from "@/lib/platform/auth";
import { route } from "@/lib/platform/http";
import { requireRole } from "@/lib/platform/rbac";

export const GET = route(async (req) => {
  const user = requireRole(await getUserFromRequest(req), ["reviewer", "approver", "admin"]);
  return NextResponse.json(await listCases(prisma, user));
});
