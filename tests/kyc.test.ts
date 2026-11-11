import { beforeAll, describe, expect, it } from "vitest";
import { GET as kycGET } from "@/app/api/apps/kyc/route";
import { POST as transitionPOST } from "@/app/api/apps/kyc/[id]/transition/route";
import { prisma } from "@/lib/db";
import { maskIdNumber, maskSsn } from "@/lib/apps/kyc/present";
import { findTransition, KYC_ACTIONS, KYC_STATUSES } from "@/lib/apps/kyc/state-machine";
import { auditFor, ensureUsers, params, req, type TestUserKey } from "./helpers";

const SSN = "987-65-4321";
const ID_NUMBER = "D12345678";

async function newCase(status = "submitted", extra: Record<string, string> = {}) {
  return prisma.kycCase.create({
    data: {
      applicantName: "Test Applicant",
      email: "applicant@example.com",
      dateOfBirth: "1990-01-01",
      country: "US",
      ssn: SSN,
      idType: "drivers_license",
      idNumber: ID_NUMBER,
      status,
      ...extra,
    },
  });
}

const act = (id: string, action: string, as: TestUserKey) =>
  transitionPOST(req("POST", `/api/apps/kyc/${id}/transition`, { as, body: { action } }), params({ id }));

describe("KYC state machine", () => {
  it("allows exactly the documented transitions", () => {
    const allowed = KYC_STATUSES.flatMap((s) => KYC_ACTIONS.filter((a) => findTransition(s, a)).map((a) => `${s}:${a}`));
    expect(allowed.sort()).toEqual(
      ["submitted:claim", "in_review:approve", "in_review:reject", "in_review:escalate", "escalated:approve", "escalated:reject"].sort(),
    );
  });
});

describe("KYC routes", () => {
  beforeAll(ensureUsers);

  it("claim -> approve happy path, with vendor check and audit", async () => {
    const c = await newCase();
    const claimed = await act(c.id, "claim", "reviewer");
    expect(claimed.status).toBe(200);
    const view = await claimed.json();
    expect(view.status).toBe("in_review");
    expect(view.assignedToId).toBe("t_reviewer");
    expect(view.vendorCheckId).toMatch(/^chk_/);

    expect((await act(c.id, "approve", "reviewer")).status).toBe(200);
    expect((await prisma.kycCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("approved");

    const logs = await auditFor(c.id);
    expect(logs.map((l) => l.action)).toEqual(["kyc.claim", "kyc.approve"]);
    for (const l of logs) {
      expect(`${l.before}${l.after}`).not.toContain("4321");
      expect(`${l.before}${l.after}`).not.toContain(ID_NUMBER);
    }
  });

  it("rejects invalid transitions on the server with 409", async () => {
    const c = await newCase();
    const res = await act(c.id, "approve", "reviewer");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/invalid transition/i);

    const done = await newCase("approved");
    expect((await act(done.id, "escalate", "reviewer")).status).toBe(409);
    expect((await act(done.id, "claim", "reviewer")).status).toBe(409);
  });

  it("rejects unknown actions with 400", async () => {
    const c = await newCase();
    expect((await act(c.id, "delete", "reviewer")).status).toBe(400);
  });

  it("only the assigned reviewer can act on an in-review case", async () => {
    const c = await newCase();
    await act(c.id, "claim", "reviewer");
    expect((await act(c.id, "reject", "reviewer2")).status).toBe(403);
  });

  it("only approvers can resolve escalated cases, and not the person who escalated", async () => {
    const c = await newCase();
    await act(c.id, "claim", "both");
    expect((await act(c.id, "escalate", "both")).status).toBe(200);

    expect((await act(c.id, "approve", "reviewer")).status).toBe(403);
    expect((await act(c.id, "approve", "both")).status).toBe(403);
    expect((await act(c.id, "reject", "approver")).status).toBe(200);
    expect((await prisma.kycCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("rejected");
  });

  it("approvers cannot claim (reviewer-only action)", async () => {
    const c = await newCase();
    expect((await act(c.id, "claim", "approver")).status).toBe(403);
  });

  it("admins cannot transition cases", async () => {
    const c = await newCase();
    expect((await act(c.id, "claim", "admin")).status).toBe(403);
  });
});

describe("KYC PII masking (server-side)", () => {
  beforeAll(ensureUsers);

  it("mask helpers keep only the last 4", () => {
    expect(maskSsn("987-65-4321")).toBe("•••-••-4321");
    expect(maskIdNumber("D12345678")).toBe("•••••5678");
  });

  it("acceptance: a reviewer gets masked SSNs and ID numbers from the API", async () => {
    const c = await newCase();
    const res = await kycGET(req("GET", "/api/apps/kyc", { as: "reviewer" }), undefined);
    const raw = await res.text();
    expect(raw).not.toContain(SSN);
    expect(raw).not.toContain(ID_NUMBER);
    const row = JSON.parse(raw).find((r: { id: string }) => r.id === c.id);
    expect(row.ssn).toBe("•••-••-4321");
    expect(row.idNumber).toBe("•••••5678");
    expect(row.piiMasked).toBe(true);
  });

  it("acceptance: an approver sees full SSNs", async () => {
    const c = await newCase();
    const rows = await (await kycGET(req("GET", "/api/apps/kyc", { as: "approver" }), undefined)).json();
    const row = rows.find((r: { id: string }) => r.id === c.id);
    expect(row.ssn).toBe(SSN);
    expect(row.idNumber).toBe(ID_NUMBER);
    expect(row.piiMasked).toBe(false);
  });

  it("admins see masked PII too (no implicit superuser)", async () => {
    const raw = await (await kycGET(req("GET", "/api/apps/kyc", { as: "admin" }), undefined)).text();
    expect(raw).not.toContain(SSN);
  });

  it("transition responses are masked for reviewers", async () => {
    const c = await newCase();
    const raw = await (await act(c.id, "claim", "reviewer")).text();
    expect(raw).not.toContain(SSN);
    expect(raw).toContain("•••-••-4321");
  });
});
