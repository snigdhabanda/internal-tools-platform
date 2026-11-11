import { beforeAll, describe, expect, it } from "vitest";
import { POST as decidePOST } from "@/app/api/approvals/[id]/route";
import { GET as refundsGET, POST as refundsPOST } from "@/app/api/apps/refunds/route";
import { prisma } from "@/lib/db";
import { auditFor, ensureUsers, params, req, type TestUserKey } from "./helpers";

const body = (amount: number) => ({
  customerName: "Jane Doe",
  customerEmail: "jane@example.com",
  chargeId: "ch_test123",
  amount,
  reason: "Duplicate charge",
});

async function requestRefund(amount: number, as: TestUserKey = "both") {
  const res = await refundsPOST(req("POST", "/api/apps/refunds", { as, body: body(amount) }), undefined);
  return { res, data: await res.json() };
}

const decide = (approvalId: string, as: TestUserKey, decision = "approved") =>
  decidePOST(req("POST", `/api/approvals/${approvalId}`, { as, body: { decision } }), params({ id: approvalId }));

describe("refunds app", () => {
  beforeAll(ensureUsers);

  it("refunds under $500 execute immediately via the payments provider and are audited", async () => {
    const { res, data } = await requestRefund(120.5, "reviewer");
    expect(res.status).toBe(201);
    expect(data.refund.status).toBe("executed");
    expect(data.refund.amountCents).toBe(12050);
    expect(data.refund.providerRefundId).toMatch(/^re_/);
    expect(data.approvalRequest).toBeNull();
    expect((await auditFor(data.refund.id)).map((l) => l.action)).toEqual(["refund.requested", "refund.executed"]);
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
    const anon = await refundsPOST(req("POST", "/api/apps/refunds", { body: body(10) }), undefined);
    expect(anon.status).toBe(401);
  });

  it("validates input", async () => {
    const res = await refundsPOST(req("POST", "/api/apps/refunds", { as: "reviewer", body: { ...body(-5), chargeId: "bogus" } }), undefined);
    expect(res.status).toBe(400);
  });

  it("listing requires a platform role", async () => {
    expect((await refundsGET(req("GET", "/api/apps/refunds"), undefined)).status).toBe(401);
    expect((await refundsGET(req("GET", "/api/apps/refunds", { as: "admin" }), undefined)).status).toBe(200);
  });
});
