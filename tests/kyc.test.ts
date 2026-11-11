import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as kycGET, POST as kycPOST } from "@/app/api/apps/kyc/route";
import { POST as transitionPOST } from "@/app/api/apps/kyc/[id]/transition/route";
import { POST as decidePOST } from "@/app/api/approvals/[id]/route";
import { prisma } from "@/lib/db";
import { maskIdNumber, maskSsn } from "@/lib/apps/kyc/present";
import { findTransition, KYC_ACTIONS, KYC_STATUSES } from "@/lib/apps/kyc/state-machine";
import { auditFor, ensureUsers, params, req, type TestUserKey } from "./helpers";

const SSN = "987-65-4321";
const PASSPORT = "P12345678";
const STREET = "742 Evergreen Terrace";
const DOB = "1990-01-01";
const ALL_PASS = { identityCheck: "pass", documentCheck: "pass", sanctionsCheck: "pass", pepCheck: "pass" };

const US_CASE = {
  applicantName: "Test Applicant",
  email: "applicant@example.com",
  dateOfBirth: DOB,
  addressLine1: STREET,
  city: "Springfield",
  region: "IL",
  postalCode: "62704",
  country: "US",
  isUSPerson: true,
  idType: "ssn",
  idNumber: SSN,
};

async function newCase(status = "submitted", extra: Record<string, unknown> = {}) {
  return prisma.kycCase.create({ data: { ...US_CASE, status, ...extra } });
}

const REASONS = { approve: "identity_verified", reject: "identity_not_verified", escalate: "potential_sanctions_match" } as const;
const transition = (id: string, body: Record<string, unknown>, as: TestUserKey) =>
  transitionPOST(req("POST", `/api/apps/kyc/${id}/transition`, { as, body }), params({ id }));
/** Acts with a valid reason code and note (decisions require both). */
const act = (id: string, action: string, as: TestUserKey) =>
  transition(id, action in REASONS ? { action, reasonCode: REASONS[action as keyof typeof REASONS], note: "Checked against vendor results" } : { action }, as);
const intake = (body: Record<string, unknown>) => kycPOST(req("POST", "/api/apps/kyc", { as: "reviewer", body }), undefined);

describe("KYC state machine", () => {
  it("allows exactly the documented transitions", () => {
    const allowed = KYC_STATUSES.flatMap((s) => KYC_ACTIONS.filter((a) => findTransition(s, a)).map((a) => `${s}:${a}`));
    expect(allowed.sort()).toEqual(
      ["submitted:claim", "in_review:approve", "in_review:reject", "in_review:escalate", "escalated:approve", "escalated:reject"].sort(),
    );
  });
});

describe("KYC CIP intake validation", () => {
  beforeAll(ensureUsers);

  it("accepts a US person identified by SSN, and audits it without PII", async () => {
    const res = await intake(US_CASE);
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const [log] = await auditFor(id);
    expect(log.action).toBe("kyc.created");
    expect(`${log.after}`).not.toContain("4321");
    expect(`${log.after}`).not.toContain(STREET);
  });

  it("accepts a non-US person with passport, issuing country and expiry", async () => {
    const res = await intake({ ...US_CASE, country: "GB", isUSPerson: false, idType: "passport", idNumber: PASSPORT, idCountry: "GB", idExpiry: "2031-05-01" });
    expect(res.status).toBe(201);
  });

  it("rejects a non-US applicant with an SSN", async () => {
    const res = await intake({ ...US_CASE, country: "GB", isUSPerson: false, idCountry: "GB" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/must not have an SSN/);
    // ...even when the SSN is smuggled in as an "other government ID".
    expect((await intake({ ...US_CASE, country: "GB", isUSPerson: false, idType: "other_gov_id", idCountry: "GB" })).status).toBe(400);
  });

  it("rejects a US person without a TIN, and a passport without issuing country or expiry", async () => {
    expect((await intake({ ...US_CASE, idType: "passport", idNumber: PASSPORT })).status).toBe(400);
    expect((await intake({ ...US_CASE, isUSPerson: false, country: "GB", idType: "passport", idNumber: PASSPORT })).status).toBe(400);
  });

  it("requires a residential address", async () => {
    expect((await intake({ ...US_CASE, addressLine1: undefined })).status).toBe(400);
  });
});

describe("KYC routes", () => {
  beforeAll(ensureUsers);

  it("claim -> approve happy path, with vendor checks, decision record and audit", async () => {
    const c = await newCase();
    const claimed = await act(c.id, "claim", "reviewer");
    expect(claimed.status).toBe(200);
    const view = await claimed.json();
    expect(view.status).toBe("in_review");
    expect(view.assignedToId).toBe("t_reviewer");
    expect(view.vendorCheckId).toMatch(/^chk_/);
    for (const k of ["identityCheck", "documentCheck", "sanctionsCheck", "pepCheck"]) expect(["pass", "fail", "needs_review"]).toContain(view[k]);

    expect((await act(c.id, "approve", "reviewer")).status).toBe(200);
    const done = await prisma.kycCase.findUniqueOrThrow({ where: { id: c.id } });
    expect(done).toMatchObject({ status: "approved", decisionReason: "identity_verified", decisionNote: "Checked against vendor results", decidedById: "t_reviewer" });
    expect(done.decidedAt).toBeInstanceOf(Date);

    const logs = await auditFor(c.id);
    expect(logs.map((l) => l.action)).toEqual(["kyc.claim", "kyc.approve"]);
    expect(JSON.parse(logs[1].after!)).toMatchObject({ decisionReason: "identity_verified", decisionNote: "Checked against vendor results" });
    for (const l of logs) {
      expect(`${l.before}${l.after}`).not.toContain("4321");
      expect(`${l.before}${l.after}`).not.toContain(STREET);
      expect(`${l.before}${l.after}`).not.toContain(DOB);
    }
  });

  it("a decision without a reason code or note fails with 400", async () => {
    const c = await newCase("in_review", { assignedToId: "t_reviewer" });
    for (const body of [
      { action: "approve" },
      { action: "approve", note: "looks fine" },
      { action: "reject", reasonCode: "identity_not_verified" },
      { action: "escalate", reasonCode: "not_a_real_code", note: "hmm" },
      { action: "reject", reasonCode: "identity_verified", note: "approve code on a reject" },
    ]) {
      expect((await transition(c.id, body, "reviewer")).status).toBe(400);
    }
    expect((await prisma.kycCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("in_review");
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
    const c = await newCase("in_review", { assignedToId: "t_both", identityCheck: "fail" });
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

describe("KYC: rejecting an all-clear case needs a second approver", () => {
  beforeAll(ensureUsers);
  const decide = (id: string, decision: string, as: TestUserKey) =>
    decidePOST(req("POST", `/api/approvals/${id}`, { as, body: { decision, note: decision === "rejected" ? "Checks are clean, keep reviewing" : undefined } }), params({ id }));

  it("a lone reject does not reject the case; the requester cannot sign off; a different approver can", async () => {
    const c = await newCase("in_review", { assignedToId: "t_both", ...ALL_PASS });
    const res = await act(c.id, "reject", "both");
    expect(res.status).toBe(200);
    let row = await prisma.kycCase.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.status).toBe("pending_rejection");
    expect(row.approvalRequestId).toBeTruthy();

    expect((await decide(row.approvalRequestId!, "approved", "both")).status).toBe(403);
    expect((await prisma.kycCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("pending_rejection");

    expect((await decide(row.approvalRequestId!, "approved", "approver")).status).toBe(200);
    row = await prisma.kycCase.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.status).toBe("rejected");
    expect((await auditFor(c.id)).map((l) => l.action)).toEqual(["kyc.reject_requested", "kyc.reject_approved"]);
  });

  it("a declined second approval sends the case back to review", async () => {
    const c = await newCase("in_review", { assignedToId: "t_reviewer", ...ALL_PASS });
    await act(c.id, "reject", "reviewer");
    const { approvalRequestId } = await prisma.kycCase.findUniqueOrThrow({ where: { id: c.id } });
    expect((await decide(approvalRequestId!, "rejected", "approver")).status).toBe(200);
    expect((await prisma.kycCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("in_review");
  });

  it("a case with a failed check is rejected directly", async () => {
    const c = await newCase("in_review", { assignedToId: "t_reviewer", ...ALL_PASS, sanctionsCheck: "fail" });
    await act(c.id, "reject", "reviewer");
    expect((await prisma.kycCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("rejected");
  });
});

describe("KYC case retention", () => {
  beforeAll(ensureUsers);

  it("case records cannot be deleted at the database level", async () => {
    const c = await newCase();
    await expect(prisma.kycCase.delete({ where: { id: c.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(prisma.kycCase.deleteMany({ where: { id: c.id } })).rejects.toThrow(/cannot be deleted/);
    expect(await prisma.kycCase.findUnique({ where: { id: c.id } })).not.toBeNull();
  });

  it("no KYC API route exports DELETE", () => {
    const files: string[] = [];
    const walk = (dir: string) =>
      readdirSync(dir).forEach((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f === "route.ts" && files.push(join(dir, f))));
    walk(join(process.cwd(), "app/api/apps/kyc"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(f, "utf8")).not.toMatch(/export\s+(const|async function|function)\s+DELETE\b/);
  });
});

describe("KYC PII masking (server-side)", () => {
  beforeAll(ensureUsers);

  it("mask helpers keep only the last 4", () => {
    expect(maskSsn("987-65-4321")).toBe("•••-••-4321");
    expect(maskIdNumber("D12345678")).toBe("•••••5678");
  });

  it("acceptance: a reviewer gets masked SSN, passport number, DOB and street address from the API", async () => {
    const c = await newCase();
    const p = await newCase("submitted", { isUSPerson: false, country: "GB", idType: "passport", idNumber: PASSPORT, idCountry: "GB", idExpiry: "2031-01-01" });
    const res = await kycGET(req("GET", "/api/apps/kyc", { as: "reviewer" }), undefined);
    const raw = await res.text();
    for (const pii of [SSN, PASSPORT, STREET, DOB, "62704"]) expect(raw).not.toContain(pii);
    const rows = JSON.parse(raw);
    const row = rows.find((r: { id: string }) => r.id === c.id);
    expect(row.idNumber).toBe("•••-••-4321");
    expect(row.dateOfBirth).toBe("••••-••-••");
    expect(row.city).toBe("Springfield");
    expect(row.piiMasked).toBe(true);
    expect(rows.find((r: { id: string }) => r.id === p.id).idNumber).toBe("•••••5678");
  });

  it("acceptance: an approver sees full PII", async () => {
    const c = await newCase();
    const rows = await (await kycGET(req("GET", "/api/apps/kyc", { as: "approver" }), undefined)).json();
    const row = rows.find((r: { id: string }) => r.id === c.id);
    expect(row).toMatchObject({ idNumber: SSN, dateOfBirth: DOB, addressLine1: STREET, piiMasked: false });
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
