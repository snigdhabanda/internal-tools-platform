/**
 * STUB KYC/identity-verification vendor (Onfido/Persona-like). Deterministic, no network.
 * Replace with the real client; send only the fields the vendor needs.
 */

export type KycCheckInput = {
  applicantName: string;
  dateOfBirth: string;
  country: string;
  idType: string;
  idNumber: string;
};

export type KycCheckResult = {
  checkId: string;
  result: "clear" | "consider";
  riskScore: number; // 0-100
  checks: { document: "clear" | "consider"; watchlist: "clear" | "consider" };
};

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export const kycVendor = {
  async runCheck(input: KycCheckInput): Promise<KycCheckResult> {
    const h = hash(`${input.applicantName}|${input.dateOfBirth}|${input.idNumber}`);
    const riskScore = h % 100;
    const watchlist = riskScore > 85 ? "consider" : "clear";
    const document = riskScore % 7 === 0 ? "consider" : "clear";
    return {
      checkId: `chk_${h.toString(36)}`,
      result: watchlist === "clear" && document === "clear" ? "clear" : "consider",
      riskScore,
      checks: { document, watchlist },
    };
  },
};
