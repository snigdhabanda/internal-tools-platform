import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as decidePOST } from "@/app/api/approvals/[id]/route";
import { GET as refundsGET, POST as refundsPOST } from "@/app/api/apps/refunds/route";
import { prisma } from "@/lib/db";
import { payments } from "@/lib/integrations/payments";
import { auditFor, ensureUsers, params, req, type TestUserKey } from "./helpers";

const body = (amount: number) => ({
  customerName: "Jane Doe",
  customerEmail: "jane@example.com",
  chargeId: "ch_test123",
  amount,
  reason: "Duplicate charge",
});

async function requestRefund(amount: number, as: TestUserKey = "both", key: string = randomUUID()) {
  const res = await refundsPOST(
    req("POST", "/api/apps/refunds", { as, body: body(amount), headers: { "Idempotency-Key": key } }),
    undefined,
  );
  return { res, data: await res.json() };
}

const decide = (approvalId: string, as: TestUserKey, decision = "approved") =>
  decidePOST(req("POST", `/api/approvals/${approvalId}`, { as, body: { decision } }), params({ id: approvalId }));

describe("refunds app", () => {
  beforeAll(ensureUsers);
  afterEach(() => vi.restoreAllMocks());

  it("refunds under $500 execute immediately via the payments provider and are audited", async () => {
    const { res, data } = await requestRefund(120.5, "reviewer");
    expect(res.status).toBe(201);
    expect(data.refund.status).toBe("executed");
    expect(data.refund.amountCents).toBe(12050);
    expect(data.refund.providerRefundId).toMatch(/^re_/);
    expect(data.approvalRequest).toBeNull();
    expect((await auditFor(data.refund.id)).map((l) => l.action)).toEqual(["refund.requested", "refund.executed"]);
  });

  it("refund audit entries omit customer name and email", async () => {
    const { data } = await requestRefund(42, "reviewer");
    const logs = await auditFor(data.refund.id);
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      expect(`${l.before ?? ""}${l.after ?? ""}`).not.toMatch(/Jane Doe|jane@example\.com/);
    }
  });

  it("acceptance: a $600 refund cannot be approved by its requester, and succeeds with a different approver", async () => {
    const { res, data } = await requestRefund(600, "both");
    expect(res.status).toBe(201);
    expect(data.refund.status).toBe("pending_approval");
    const approvalId = data.approvalRequest.id;

    const self = await decide(approvalId, "both");
    expect(self.status).toBe(403);
    expect((await self.json()).error).toMatch(/maker-checker/i);
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: data.refund.id } })).status).toBe("pending_approval");

    const other = await decide(approvalId, "approver");
    expect(other.status).toBe(200);
    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: data.refund.id } });
    expect(refund.status).toBe("executed");
    expect(refund.providerRefundId).toMatch(/^re_/);

    expect((await auditFor(data.refund.id)).map((l) => l.action)).toEqual(["refund.requested", "refund.executed"]);
    expect((await auditFor(approvalId)).map((l) => l.action)).toEqual(["approval.requested", "approval.approved"]);
  });

  it("exactly $500 requires approval", async () => {
    const { data } = await requestRefund(500, "reviewer");
    expect(data.refund.status).toBe("pending_approval");
  });

  it("a reviewer (non-approver) cannot approve", async () => {
    const { data } = await requestRefund(900, "reviewer");
    expect((await decide(data.approvalRequest.id, "reviewer2")).status).toBe(403);
  });

  it("rejection marks the refund rejected and never calls the provider", async () => {
    const { data } = await requestRefund(1000, "reviewer");
    expect((await decide(data.approvalRequest.id, "approver", "rejected")).status).toBe(200);
    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: data.refund.id } });
    expect(refund.status).toBe("rejected");
    expect(refund.providerRefundId).toBeNull();
    expect((await auditFor(data.refund.id)).map((l) => l.action)).toEqual(["refund.requested", "refund.rejected"]);
  });

  it("an approved request cannot be approved again", async () => {
    const { data } = await requestRefund(700, "reviewer");
    expect((await decide(data.approvalRequest.id, "approver")).status).toBe(200);
    expect((await decide(data.approvalRequest.id, "approver2")).status).toBe(409);
  });

  it("only reviewers can request refunds", async () => {
    expect((await requestRefund(10, "approver")).res.status).toBe(403);
    expect((await requestRefund(10, "admin")).res.status).toBe(403);
    const anon = await refundsPOST(req("POST", "/api/apps/refunds", { body: body(10), headers: { "Idempotency-Key": randomUUID() } }), undefined);
    expect(anon.status).toBe(401);
  });

  it("validates input", async () => {
    const res = await refundsPOST(
      req("POST", "/api/apps/refunds", { as: "reviewer", body: { ...body(-5), chargeId: "bogus" }, headers: { "Idempotency-Key": randomUUID() } }),
      undefined,
    );
    expect(res.status).toBe(400);
  });

  it("listing requires a platform role", async () => {
    expect((await refundsGET(req("GET", "/api/apps/refunds"), undefined)).status).toBe(401);
    expect((await refundsGET(req("GET", "/api/apps/refunds", { as: "admin" }), undefined)).status).toBe(200);
  });

  describe("idempotency", () => {
    it("rejects a request without an Idempotency-Key with 400 and creates nothing", async () => {
      const spy = vi.spyOn(payments.refunds, "create");
      const before = await prisma.refund.count();
      const res = await refundsPOST(req("POST", "/api/apps/refunds", { as: "reviewer", body: body(25) }), undefined);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/Idempotency-Key/);
      expect(await prisma.refund.count()).toBe(before);
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects a non-UUID Idempotency-Key with 400", async () => {
      expect((await requestRefund(25, "reviewer", "retry-1")).res.status).toBe(400);
    });

    it("the same key twice yields one refund and one payments call; the replay is audited as a duplicate", async () => {
      const spy = vi.spyOn(payments.refunds, "create");
      const key = randomUUID();
      const first = await requestRefund(80, "reviewer", key);
      const second = await requestRefund(80, "reviewer", key);
      expect(first.res.status).toBe(201);
      expect(second.res.status).toBe(200);
      expect(second.res.headers.get("Idempotent-Replayed")).toBe("true");
      expect(second.data.duplicate).toBe(true);
      expect(second.data.refund.id).toBe(first.data.refund.id);
      expect(await prisma.refund.count({ where: { idempotencyKey: key } })).toBe(1);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].idempotencyKey).toBe(key);
      const logs = await auditFor(first.data.refund.id);
      expect(logs.map((l) => l.action)).toEqual(["refund.requested", "refund.executed", "refund.duplicate_request"]);
      expect(JSON.parse(logs[2].after!)).toMatchObject({ duplicate: true, idempotencyKey: key });
    });

    it("concurrent requests with the same key create one refund and call payments once", async () => {
      const spy = vi.spyOn(payments.refunds, "create");
      const key = randomUUID();
      const results = await Promise.all([requestRefund(90, "reviewer", key), requestRefund(90, "reviewer", key)]);
      expect(results.map((r) => r.res.status).sort()).toEqual([200, 201]);
      expect(await prisma.refund.count({ where: { idempotencyKey: key } })).toBe(1);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("a replayed $500+ request returns the original pending approval without creating another", async () => {
      const key = randomUUID();
      const first = await requestRefund(650, "reviewer", key);
      const second = await requestRefund(650, "reviewer", key);
      expect(second.data.approvalRequest.id).toBe(first.data.approvalRequest.id);
      expect(await prisma.approvalRequest.count({ where: { entityId: first.data.refund.id } })).toBe(1);
    });

    it("reusing a key for a different request or by a different user returns 409", async () => {
      const key = randomUUID();
      await requestRefund(30, "reviewer", key);
      expect((await requestRefund(31, "reviewer", key)).res.status).toBe(409);
      const editedReason = await refundsPOST(
        req("POST", "/api/apps/refunds", { as: "reviewer", body: { ...body(30), reason: "Edited reason" }, headers: { "Idempotency-Key": key } }),
        undefined,
      );
      expect(editedReason.status).toBe(409);
      expect((await requestRefund(30, "reviewer2", key)).res.status).toBe(409);
    });

    it("two concurrent approvals execute the refund exactly once", async () => {
      const { data } = await requestRefund(800, "reviewer");
      const spy = vi.spyOn(payments.refunds, "create");
      const [a, b] = await Promise.all([decide(data.approvalRequest.id, "approver"), decide(data.approvalRequest.id, "approver2")]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(spy).toHaveBeenCalledTimes(1);
      const refund = await prisma.refund.findUniqueOrThrow({ where: { id: data.refund.id } });
      expect(refund.status).toBe("executed");
      expect((await auditFor(data.refund.id)).map((l) => l.action)).toEqual(["refund.requested", "refund.executed"]);
    });
  });
});
