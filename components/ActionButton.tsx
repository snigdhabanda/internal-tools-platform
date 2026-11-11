"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const VARIANTS = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700",
  success: "bg-emerald-600 text-white hover:bg-emerald-700",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
  neutral: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
};

/** POSTs JSON to an API route, shows the server's error inline, then refreshes server data. */
export function ActionButton({
  url,
  body,
  label,
  variant = "neutral",
}: {
  url: string;
  body: unknown;
  label: string;
  variant?: keyof typeof VARIANTS;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function onClick() {
    setBusy(true);
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Request failed (${res.status})`);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${VARIANTS[variant]}`}
      >
        {busy ? "…" : label}
      </button>
      {error && <span className="mt-1 max-w-xs text-xs text-rose-600">{error}</span>}
    </span>
  );
}
