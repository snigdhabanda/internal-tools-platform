import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/platform/audit";
import { getUserFromRequest, SESSION_COOKIE } from "@/lib/platform/auth";
import { NotFoundError } from "@/lib/platform/errors";
import { parseBody, route } from "@/lib/platform/http";

/**
 * MOCK LOGIN (user switcher). The one route exempt from requireRole: it establishes identity,
 * so there is no user to authorize yet. Exemption is listed explicitly in tests/guardrails.test.ts.
 */
export const POST = route(async (req) => {
  const { userId } = await parseBody(req, z.object({ userId: z.string().min(1) }));
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new NotFoundError("Unknown user");
  const previous = await getUserFromRequest(req);

  await audit({
    actorId: target.id,
    action: "session.switched",
    entityType: "User",
    entityId: target.id,
    before: previous ? { userId: previous.id } : null,
    after: { userId: target.id },
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, target.id, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
});
