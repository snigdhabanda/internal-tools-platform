import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { remainingCents, searchCharges } from "@/lib/apps/refunds/service";
import { getUserFromRequest } from "@/lib/platform/auth";
import { route } from "@/lib/platform/http";
import { requireRole } from "@/lib/platform/rbac";

/** Charge lookup for the refund form: by charge id or customer email. Read-only. */
export const GET = route(async (req) => {
  requireRole(await getUserFromRequest(req), ["reviewer"]);
  const charges = await searchCharges(prisma, req.nextUrl.searchParams.get("q") ?? "");
  return NextResponse.json(charges.map((c) => ({ ...c, remainingCents: remainingCents(c) })));
});
