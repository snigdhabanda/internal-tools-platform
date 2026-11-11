import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as decidePOST } from "@/app/api/approvals/[id]/route";
import { GET as chargesGET } from "@/app/api/apps/refunds/charges/route";
import { GET as exportGET } from "@/app/api/apps/refunds/export/route";
import { GET as refundsGET, POST as refundsPOST } from "@/app/api/apps/refunds/route";
import { prisma } from "@/lib/db";
import { payments } from "@/lib/integrations/payments";
import { csvCell } from "@/lib/platform/csv";
import { auditFor, ensureUsers, params, req, type TestUserKey } from "./helpers";

/** Default charge for a test; replaced before each test so cumulative-per-charge totals start at zero. */
let BIG_CHARGE = "ch_test123";

const body = (amount: number, chargeId = BIG_CHARGE, extra: Record<string, unknown> = {}) => ({ chargeId, amount, reason: "duplicate", ...extra });

async function requestRefund(amount: number, as: TestUserKey = "both", key: string = randomUUID(), chargeId = BIG_CHARGE, extra: Record<string, unknown> = {}) {
  const res = await refundsPOST(
    req("POST", "/api/apps/refunds", { as, body: body(amount, chargeId, extra), headers: { "Idempotency-Key": key } }),
    undefined,
  );
  return { res, data: await res.json() };
}

const decide = (approvalId: string, as: TestUserKey, decision = "approved", note?: string) =>
  decidePOST(
    req("POST", `/api/approvals/${approvalId}`, { as, body: { decision, note: note ?? (decision === "rejected" ? "Test rejection reason" : undefined) } }),
    params({ id: approvalId }),
  );

/** A fresh charge, so balance assertions aren't affected by other tests. */
async function newCharge(amountCents: number, customerName = "Sam Lee", customerEmail = "sam.lee@example.com") {
  return prisma.charge.create({
    data: { id: `ch_${randomUUID().replace(/-/g, "")}`, customerName, customerEmail, description: "Test charge", amountCents },
  });
}

/** Moves every refund out of the requester window, so each test starts with an empty 24h total. */
const clearRequesterWindows = () =>
  prisma.refund.updateMany({ where: { createdAt: { gte: new Date(Date.now() - 48 * 3_600_000) } }, data: { createdAt: new Date(Date.now() - 72 * 3_600_000) } });

const chargeBalance = (id: string) => prisma.charge.findUniqueOrThrow({ where: { id } });

describe("csvCell", () => {
  it("neutralizes formulas, including ones preceded by whitespace", () => {
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvCell("  @SUM(A1)")).toBe(`"'  @SUM(A1)"`);
    expect(csvCell('say "hi"')).toBe(`"say ""hi"""`);
  });
});

describe("refunds app", () => {
  beforeAll(ensureUsers);
  beforeEach(async () => {
    BIG_CHARGE = (await newCharge(1_000_000_000, "Jane Doe", "jane@example.com")).id;
    await clearRequesterWindows();
  });
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

  it("approval payloads (copied into the audit log) omit the customer", async () => {
    const { data } = await requestRefund(650, "reviewer");
    const logs = await auditFor(data.approvalRequest.id);
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(`${l.before ?? ""}${l.after ?? ""}`).not.toMatch(/Jane Doe|jane@example\.com/);
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

  describe("charges and refundable balance", () => {
    it("takes the customer from the charge, not the request", async () => {
      const charge = await newCharge(200_00);
      const res = await refundsPOST(
        req("POST", "/api/apps/refunds", {
          as: "reviewer",
          body: { ...body(20, charge.id), customerName: "Mallory", customerEmail: "mallory@evil.example" },
          headers: { "Idempotency-Key": randomUUID() },
        }),
        undefined,
      );
      expect(res.status).toBe(201);
      const { refund } = await res.json();
      expect(refund.customerName).toBe("Sam Lee");
      expect(refund.customerEmail).toBe("sam.lee@example.com");
    });

    it("rejects a refund on an unknown charge with 404", async () => {
      expect((await requestRefund(10, "reviewer", randomUUID(), "ch_doesnotexist")).res.status).toBe(404);
    });

    it("rejects an over-refund on the server without calling the provider", async () => {
      const charge = await newCharge(100_00);
      const spy = vi.spyOn(payments.refunds, "create");
      const { res, data } = await requestRefund(100.01, "reviewer", randomUUID(), charge.id);
      expect(res.status).toBe(400);
      expect(data.error).toMatch(/exceeds the remaining refundable balance of \$100\.00/);
      expect(spy).not.toHaveBeenCalled();
      expect(await prisma.refund.count({ where: { chargeId: charge.id } })).toBe(0);
      expect(await chargeBalance(charge.id)).toMatchObject({ amountRefundedCents: 0, amountPendingCents: 0 });
    });

    it("partial refunds add up, and the last cent can be refunded but not more", async () => {
      const charge = await newCharge(300_00);
      expect((await requestRefund(100, "reviewer", randomUUID(), charge.id)).res.status).toBe(201);
      expect((await requestRefund(150.5, "reviewer", randomUUID(), charge.id)).res.status).toBe(201);
      expect(await chargeBalance(charge.id)).toMatchObject({ amountRefundedCents: 250_50, amountPendingCents: 0 });

      expect((await requestRefund(49.51, "reviewer", randomUUID(), charge.id)).res.status).toBe(400);
      expect((await requestRefund(49.5, "reviewer", randomUUID(), charge.id)).res.status).toBe(201);
      expect(await chargeBalance(charge.id)).toMatchObject({ amountRefundedCents: 300_00, amountPendingCents: 0 });
      expect((await requestRefund(0.01, "reviewer", randomUUID(), charge.id)).res.status).toBe(400);
    });

    it("a refund awaiting approval holds its amount; approving moves it to refunded, rejecting releases it", async () => {
      const charge = await newCharge(1_000_00);
      const pending = await requestRefund(600, "reviewer", randomUUID(), charge.id);
      expect(pending.data.refund.status).toBe("pending_approval");
      expect(await chargeBalance(charge.id)).toMatchObject({ amountRefundedCents: 0, amountPendingCents: 600_00 });
      // Only $400 left while the $600 is on hold.
      expect((await requestRefund(500, "reviewer", randomUUID(), charge.id)).res.status).toBe(400);

      expect((await decide(pending.data.approvalRequest.id, "approver", "rejected")).status).toBe(200);
      expect(await chargeBalance(charge.id)).toMatchObject({ amountRefundedCents: 0, amountPendingCents: 0 });

      const second = await requestRefund(700, "reviewer", randomUUID(), charge.id);
      expect((await decide(second.data.approvalRequest.id, "approver")).status).toBe(200);
      expect(await chargeBalance(charge.id)).toMatchObject({ amountRefundedCents: 700_00, amountPendingCents: 0 });
    });

    it("concurrent requests can't over-refund a charge together", async () => {
      const charge = await newCharge(100_00);
      const results = await Promise.all([
        requestRefund(60, "reviewer", randomUUID(), charge.id),
        requestRefund(60, "reviewer", randomUUID(), charge.id),
      ]);
      expect(results.map((r) => r.res.status).sort()).toEqual([201, 400]);
      expect((await chargeBalance(charge.id)).amountRefundedCents).toBe(60_00);
    });

    it("rejecting without a reason fails and leaves the refund pending", async () => {
      const { data } = await requestRefund(900, "reviewer");
      const noReason = await decidePOST(req("POST", `/api/approvals/${data.approvalRequest.id}`, { as: "approver", body: { decision: "rejected" } }), params({ id: data.approvalRequest.id }));
      expect(noReason.status).toBe(400);
      expect((await noReason.json()).issues[0].message).toMatch(/reason is required/i);
      expect((await decide(data.approvalRequest.id, "approver", "rejected", "  ")).status).toBe(400);
      expect((await prisma.refund.findUniqueOrThrow({ where: { id: data.refund.id } })).status).toBe("pending_approval");

      expect((await decide(data.approvalRequest.id, "approver", "rejected", "Chargeback already issued")).status).toBe(200);
      const approval = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: data.approvalRequest.id } });
      expect(approval.decisionNote).toBe("Chargeback already issued");
    });

    it("rejects unknown reason codes", async () => {
      const res = await refundsPOST(
        req("POST", "/api/apps/refunds", { as: "reviewer", body: { ...body(10), reason: "because" }, headers: { "Idempotency-Key": randomUUID() } }),
        undefined,
      );
      expect(res.status).toBe(400);
    });
  });

  describe("charge search and export", () => {
    it("charge search is reviewer-only and finds by email or charge id with the remaining balance", async () => {
      const charge = await newCharge(80_00);
      expect((await chargesGET(req("GET", `/api/apps/refunds/charges?q=${charge.id}`, { as: "approver" }), undefined)).status).toBe(403);
      const byId = await (await chargesGET(req("GET", `/api/apps/refunds/charges?q=${charge.id}`, { as: "reviewer" }), undefined)).json();
      expect(byId).toEqual([expect.objectContaining({ id: charge.id, remainingCents: 80_00 })]);
      const byEmail = await (await chargesGET(req("GET", "/api/apps/refunds/charges?q=sam.lee@example", { as: "reviewer" }), undefined)).json();
      expect(byEmail.map((c: { id: string }) => c.id)).toContain(charge.id);
    });

    it("CSV export requires a role and is audited", async () => {
      expect((await exportGET(req("GET", "/api/apps/refunds/export"), undefined)).status).toBe(401);
      await requestRefund(12, "reviewer");
      const res = await exportGET(req("GET", `/api/apps/refunds/export?tab=all&q=${BIG_CHARGE}`, { as: "admin" }), undefined);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/csv/);
      const csv = await res.text();
      expect(csv.split("\n")[0]).toMatch(/^id,created_at,customer_name/);
      expect(csv).toContain(BIG_CHARGE);
      expect(csv.split("\n")[0]).toContain("approved_by");
      expect(csv.split("\n")[1]).toContain(`"auto"`);
      const log = await prisma.auditLog.findFirst({ where: { action: "refund.exported", actorId: "t_admin" }, orderBy: { timestamp: "desc" } });
      expect(log).not.toBeNull();
      expect(log!.after).not.toContain(BIG_CHARGE);
      expect(JSON.parse(log!.after!).filters.q).toBe("[redacted]");
    });
  });

  describe("approval controls", () => {
    it("two $499.99 refunds on the same charge: the second needs approval (cumulative per charge)", async () => {
      const charge = await newCharge(2_000_00);
      const first = await requestRefund(499.99, "reviewer", randomUUID(), charge.id);
      expect(first.data.refund.status).toBe("executed");
      expect(first.data.refund.approvalRule).toBeNull();

      const second = await requestRefund(499.99, "reviewer", randomUUID(), charge.id);
      expect(second.res.status).toBe(201);
      expect(second.data.refund.status).toBe("pending_approval");
      expect(second.data.refund.approvalRule).toBe("charge_cumulative");
      expect(second.data.refund.approvalReason).toMatch(/^Needs approval: cumulative refunds on this charge exceed \$500\.00/);
      expect(second.data.approvalRequest.status).toBe("pending");
      expect(await chargeBalance(charge.id)).toMatchObject({ amountRefundedCents: 499_99, amountPendingCents: 499_99 });
    });

    it("pending refunds count toward the charge total too", async () => {
      const charge = await newCharge(2_000_00);
      expect((await requestRefund(600, "reviewer", randomUUID(), charge.id)).data.refund.status).toBe("pending_approval");
      const small = await requestRefund(10, "reviewer", randomUUID(), charge.id);
      expect(small.data.refund.status).toBe("pending_approval");
      expect(small.data.refund.approvalRule).toBe("charge_cumulative");
    });

    it("the requester's 24h cap triggers approval once their total reaches $2,000", async () => {
      const spy = vi.spyOn(payments.refunds, "create");
      for (let i = 0; i < 4; i++) {
        const { data } = await requestRefund(450, "reviewer", randomUUID(), (await newCharge(1_000_00)).id);
        expect(data.refund.status).toBe("executed");
      }
      // $1,800 so far; another $200 on a fresh charge brings the requester to $2,000.
      const capped = await requestRefund(200, "reviewer", randomUUID(), (await newCharge(1_000_00)).id);
      expect(capped.data.refund.status).toBe("pending_approval");
      expect(capped.data.refund.approvalRule).toBe("requester_daily");
      expect(capped.data.refund.approvalReason).toMatch(/requester's refunds in the last 24h exceed \$2,000\.00/);
      expect(spy).toHaveBeenCalledTimes(4);

      // Another requester is unaffected, and refunds older than the window don't count.
      expect((await requestRefund(200, "both", randomUUID(), (await newCharge(1_000_00)).id)).data.refund.status).toBe("executed");
      await clearRequesterWindows();
      expect((await requestRefund(200, "reviewer", randomUUID(), (await newCharge(1_000_00)).id)).data.refund.status).toBe("executed");
    });

    it("a fraudulent refund without an internal note is rejected with 400", async () => {
      const charge = await newCharge(100_00);
      for (const note of [undefined, "", "   "]) {
        const { res, data } = await requestRefund(20, "reviewer", randomUUID(), charge.id, { reason: "fraudulent", note });
        expect(res.status).toBe(400);
        expect(JSON.stringify(data)).toMatch(/internal note is required/i);
      }
      expect(await prisma.refund.count({ where: { chargeId: charge.id } })).toBe(0);
      const ok = await requestRefund(20, "reviewer", randomUUID(), charge.id, { reason: "fraudulent", note: "Cardholder reported card stolen" });
      expect(ok.res.status).toBe(201);
      expect(ok.data.refund.note).toBe("Cardholder reported card stolen");
    });
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
        req("POST", "/api/apps/refunds", { as: "reviewer", body: { ...body(30), reason: "goodwill" }, headers: { "Idempotency-Key": key } }),
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
