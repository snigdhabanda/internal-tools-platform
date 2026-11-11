import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  createRefund,
  findRefundByIdempotencyKey,
  isIdempotencyKeyConflict,
  listRefunds,
  processRefund,
  readIdempotencyKey,
  REFUND_ENTITY,
  refundAuditSnapshot,
  replayRefund,
  requestRefundSchema,
} from "@/lib/apps/refunds/service";
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
  const idempotencyKey = readIdempotencyKey(req.headers);
  const input = await parseBody(req, requestRefundSchema);

  const replay = async () => {
    const existing = await findRefundByIdempotencyKey(prisma, idempotencyKey);
    if (!existing) return null;
    const result = await prisma.$transaction(async (tx) => {
      const replayed = await replayRefund(tx, user, input, existing);
      await audit(
        {
          actorId: user.id,
          action: "refund.duplicate_request",
          entityType: REFUND_ENTITY,
          entityId: existing.id,
          after: { duplicate: true, idempotencyKey, status: existing.status },
        },
        tx,
      );
      return replayed;
    });
    return NextResponse.json({ ...result, duplicate: true }, { status: 200, headers: { "Idempotent-Replayed": "true" } });
  };

  const replayed = await replay();
  if (replayed) return replayed;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const created = await createRefund(tx, user, input, idempotencyKey);
      await audit({ actorId: user.id, action: "refund.requested", entityType: REFUND_ENTITY, entityId: created.id, after: refundAuditSnapshot(created) }, tx);
      return processRefund(tx, user, created);
    });
    return NextResponse.json({ ...result, duplicate: false }, { status: 201 });
  } catch (error) {
    // A concurrent request with the same key won the insert; answer as a replay.
    if (isIdempotencyKeyConflict(error)) {
      const raced = await replay();
      if (raced) return raced;
    }
    throw error;
  }
});
