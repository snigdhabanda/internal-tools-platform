/**
 * STUB payments provider (Stripe-like). Always succeeds. Replace with the real SDK,
 * keeping the same interface, and load the API key from a secrets manager.
 */

export type CreateRefundParams = {
  charge: string;
  amount: number; // minor units (cents)
  currency: string;
  /** Prevents double refunds if a request is retried. */
  idempotencyKey: string;
  metadata?: Record<string, string>;
};

export type ProviderRefund = {
  id: string;
  object: "refund";
  status: "succeeded" | "pending" | "failed";
  charge: string;
  amount: number;
  currency: string;
  created: number;
};

const byIdempotencyKey = new Map<string, ProviderRefund>();

function randomId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
}

export const payments = {
  refunds: {
    async create(params: CreateRefundParams): Promise<ProviderRefund> {
      if (!params.charge.startsWith("ch_")) throw new Error(`Invalid charge id: ${params.charge}`);
      if (!Number.isInteger(params.amount) || params.amount <= 0) throw new Error("Invalid amount");
      const existing = byIdempotencyKey.get(params.idempotencyKey);
      if (existing) return existing;
      const refund: ProviderRefund = {
        id: randomId("re"),
        object: "refund",
        status: "succeeded",
        charge: params.charge,
        amount: params.amount,
        currency: params.currency,
        created: Math.floor(Date.now() / 1000),
      };
      byIdempotencyKey.set(params.idempotencyKey, refund);
      return refund;
    },
  },
};
