/**
 * STUB KYC/identity-verification vendor (Onfido/Persona-like). Deterministic, no network.
 * Replace with the real client; send only the fields the vendor needs.
 */

export type CheckResult = "pass" | "fail" | "needs_review";

export type KycCheckInput = {
  applicantName: string;
  dateOfBirth: string;
  country: string;
  idType: string;
  idNumber: string;
};

export type KycCheckResult = {
  checkId: string;
  /** 0-100. Low < 40, Medium 40-69, High >= 70. */
  riskScore: number;
  checks: { identity: CheckResult; document: CheckResult; sanctions: CheckResult; pep: CheckResult };
};

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const pick = (n: number): CheckResult => (n < 80 ? "pass" : n < 93 ? "needs_review" : "fail");

export const kycVendor = {
  async runCheck(input: KycCheckInput): Promise<KycCheckResult> {
    const h = hash(`${input.applicantName}|${input.dateOfBirth}|${input.idNumber}`);
    return {
      checkId: `chk_${h.toString(36)}`,
      riskScore: h % 100,
      checks: {
        identity: pick(h % 97),
        document: pick((h >>> 3) % 97),
        sanctions: pick(((h >>> 7) % 97) + 3),
        pep: pick(((h >>> 11) % 97) + 2),
      },
    };
  },
};
