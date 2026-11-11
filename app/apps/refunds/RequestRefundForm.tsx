"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function RequestRefundForm() {
  const router = useRouter();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/apps/refunds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerName: fd.get("customerName"),
        customerEmail: fd.get("customerEmail"),
        chargeId: fd.get("chargeId"),
        amount: Number(fd.get("amount")),
        reason: fd.get("reason"),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      const detail = data.issues?.map((i: { path: string[]; message: string }) => `${i.path.join(".")}: ${i.message}`).join("; ");
      setMessage({ kind: "error", text: detail || data.error || "Request failed" });
      return;
    }
    form.reset();
    setMessage({
      kind: "ok",
      text: data.approvalRequest ? "Submitted for approval (≥ $500)." : "Refund executed.",
    });
    startTransition(() => router.refresh());
  }

  const input = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";
  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-6" data-testid="refund-form">
      <input name="customerName" placeholder="Customer name" required className={`${input} md:col-span-2`} />
      <input name="customerEmail" type="email" placeholder="customer@example.com" required className={`${input} md:col-span-2`} />
      <input name="chargeId" placeholder="ch_..." required className={input} />
      <input name="amount" type="number" step="0.01" min="0.01" placeholder="Amount (USD)" required className={input} />
      <input name="reason" placeholder="Reason" required className={`${input} md:col-span-5`} />
      <button disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {busy ? "Submitting…" : "Request refund"}
      </button>
      {message && (
        <p className={`text-sm md:col-span-6 ${message.kind === "ok" ? "text-emerald-700" : "text-rose-600"}`}>{message.text}</p>
      )}
    </form>
  );
}
