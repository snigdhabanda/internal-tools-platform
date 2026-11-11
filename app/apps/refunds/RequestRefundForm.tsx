"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID needs a secure context; fall back to an RFC 4122 v4 UUID from getRandomValues.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function RequestRefundForm() {
  const router = useRouter();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  // One key per refund attempt: resubmitting after a failure reuses it, so a request that
  // reached the server but lost its response can't refund twice. Rotated after success.
  const idempotencyKey = useRef<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    setMessage(null);
    idempotencyKey.current ??= newIdempotencyKey();
    let res: Response;
    try {
      res = await fetch("/api/apps/refunds", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify({
          customerName: fd.get("customerName"),
          customerEmail: fd.get("customerEmail"),
          chargeId: fd.get("chargeId"),
          amount: Number(fd.get("amount")),
          reason: fd.get("reason"),
        }),
      });
    } catch {
      setBusy(false);
      setMessage({ kind: "error", text: "Network error. Submit again to retry; it will not refund twice." });
      return;
    }
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      const detail = data.issues?.map((i: { path: string[]; message: string }) => `${i.path.join(".")}: ${i.message}`).join("; ");
      if (res.status === 409) {
        // This attempt already created a refund with other details. Keep the key so an edited
        // resubmit can't refund the charge again; only Clear (a deliberate new attempt) rotates it.
        setMessage({
          kind: "error",
          text: `${data.error ?? "Conflict"}. Your earlier attempt already went through; check the table. To request a different refund, click Clear first.`,
        });
        startTransition(() => router.refresh());
        return;
      }
      setMessage({ kind: "error", text: detail || data.error || "Request failed" });
      return;
    }
    idempotencyKey.current = null;
    form.reset();
    const outcome = data.approvalRequest ? "Submitted for approval (≥ $500)." : "Refund executed.";
    setMessage({ kind: "ok", text: data.duplicate ? `Already submitted: ${outcome}` : outcome });
    startTransition(() => router.refresh());
  }

  const input = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";
  return (
    <form
      onSubmit={onSubmit}
      onReset={() => {
        idempotencyKey.current = null;
        setMessage(null);
      }}
      className="grid grid-cols-1 gap-3 md:grid-cols-6" data-testid="refund-form">
      <input name="customerName" placeholder="Customer name" required className={`${input} md:col-span-2`} />
      <input name="customerEmail" type="email" placeholder="customer@example.com" required className={`${input} md:col-span-2`} />
      <input name="chargeId" placeholder="ch_..." required className={input} />
      <input name="amount" type="number" step="0.01" min="0.01" placeholder="Amount (USD)" required className={input} />
      <input name="reason" placeholder="Reason" required className={`${input} md:col-span-4`} />
      <button type="reset" disabled={busy} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        Clear
      </button>
      <button disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {busy ? "Submitting…" : "Request refund"}
      </button>
      {message && (
        <p className={`text-sm md:col-span-6 ${message.kind === "ok" ? "text-emerald-700" : "text-rose-600"}`}>{message.text}</p>
      )}
    </form>
  );
}
