"use client";

import { ArrowLeft, Loader2, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCents, formatDay } from "@/lib/format";

type Charge = {
  id: string;
  customerName: string;
  customerEmail: string;
  description: string;
  amountCents: number;
  amountRefundedCents: number;
  amountPendingCents: number;
  remainingCents: number;
  createdAt: string;
};

type Step = "search" | "details" | "confirm";

function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID needs a secure context; fall back to an RFC 4122 v4 UUID from getRandomValues.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function NewRefundDialog({ reasons, thresholdCents }: { reasons: { value: string; label: string }[]; thresholdCents: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Charge[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [charge, setCharge] = useState<Charge | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per refund attempt: retrying after a failure reuses it, so a request that reached the
  // server but lost its response can't refund twice. Rotated only after success or "Start over".
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    if (step !== "search" || query.trim().length < 3) {
      setResults(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const res = await fetch(`/api/apps/refunds/charges?q=${encodeURIComponent(query.trim())}`, { signal: ctrl.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Search failed");
        setResults(data);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setSearchError((e as Error).message);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, step]);

  function reset() {
    setStep("search");
    setQuery("");
    setResults(null);
    setCharge(null);
    setAmount("");
    setReason("");
    setNote("");
    setError(null);
    idempotencyKey.current = null;
  }

  function choose(c: Charge) {
    setCharge(c);
    setAmount((c.remainingCents / 100).toFixed(2));
    setError(null);
    setStep("details");
  }

  const amountCents = Math.round(Number(amount) * 100);
  const amountError =
    !amount || !Number.isFinite(amountCents) || amountCents <= 0
      ? "Enter an amount"
      : charge && amountCents > charge.remainingCents
        ? `Can't exceed the remaining ${formatCents(charge.remainingCents)}`
        : null;
  const needsApproval = amountCents >= thresholdCents;

  async function submit() {
    if (!charge) return;
    setBusy(true);
    setError(null);
    idempotencyKey.current ??= newIdempotencyKey();
    let res: Response;
    try {
      res = await fetch("/api/apps/refunds", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify({ chargeId: charge.id, amount: amountCents / 100, reason, note: note.trim() || undefined }),
      });
    } catch {
      setBusy(false);
      setError("Network error. Submit again to retry; it will not refund twice.");
      return;
    }
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      const detail = data.issues?.map((i: { message: string }) => i.message).join("; ");
      setError(
        res.status === 409
          ? `${data.error ?? "Conflict"}. Your earlier attempt already went through; check the table. Use Start over to request a different refund.`
          : detail || data.error || "Request failed",
      );
      if (res.status === 409) startTransition(() => router.refresh());
      return;
    }
    const who = charge.customerName;
    const text = data.approvalRequest
      ? `Refund of ${formatCents(amountCents)} to ${who} sent for approval`
      : `Refunded ${formatCents(amountCents)} to ${who}`;
    toast.success(data.duplicate ? `Already submitted. ${text}` : text);
    setOpen(false);
    reset();
    startTransition(() => router.push(`/apps/refunds?refund=${data.refund.id}`));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && !busy) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> New refund
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl" data-testid="refund-dialog">
        {step === "search" && (
          <>
            <DialogHeader>
              <DialogTitle>New refund</DialogTitle>
              <DialogDescription>Find the original charge. Refunds always go back to the customer who paid.</DialogDescription>
            </DialogHeader>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Customer email or charge ID (ch_…)" className="pl-9" data-testid="charge-search" />
            </div>
            <div className="max-h-80 min-h-32 overflow-y-auto">
              {searching && (
                <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Searching charges…
                </p>
              )}
              {!searching && searchError && <p className="py-6 text-sm text-destructive">{searchError}</p>}
              {!searching && !searchError && results === null && <p className="py-6 text-sm text-muted-foreground">Type at least 3 characters.</p>}
              {!searching && !searchError && results?.length === 0 && <p className="py-6 text-sm text-muted-foreground">No charges match “{query}”.</p>}
              {!searching && results && results.length > 0 && (
                <ul className="divide-y rounded-lg border">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => choose(c)}
                        disabled={c.remainingCents <= 0}
                        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{c.customerName}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {c.customerEmail} · <span className="font-mono">{c.id}</span> · {formatDay(c.createdAt)}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-medium tabular-nums">{formatCents(c.amountCents)}</span>
                          <span className="block text-xs tabular-nums text-muted-foreground">
                            {c.remainingCents <= 0 ? "Fully refunded" : `${formatCents(c.remainingCents)} refundable`}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {step !== "search" && charge && (
          <>
            <DialogHeader>
              <DialogTitle>{step === "confirm" ? "Confirm refund" : "Refund details"}</DialogTitle>
              <DialogDescription>
                {charge.customerName} · {charge.customerEmail}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-3 divide-x rounded-lg border bg-muted/40 text-center">
              {[
                ["Original charge", charge.amountCents],
                ["Already refunded", charge.amountRefundedCents + charge.amountPendingCents],
                ["Remaining", charge.remainingCents],
              ].map(([label, cents]) => (
                <div key={label} className="px-3 py-3">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="mt-0.5 text-sm font-semibold tabular-nums">{formatCents(cents as number)}</div>
                </div>
              ))}
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              <span className="font-mono">{charge.id}</span> · {charge.description} · {formatDay(charge.createdAt)}
              {charge.amountPendingCents > 0 && ` · ${formatCents(charge.amountPendingCents)} pending approval`}
            </p>

            {step === "details" ? (
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="refund-amount">Amount</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span>
                    <Input
                      id="refund-amount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={(charge.remainingCents / 100).toFixed(2)}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="pl-7 text-right tabular-nums"
                      aria-invalid={!!amountError}
                    />
                  </div>
                  <p className={`text-xs ${amountError ? "text-destructive" : needsApproval ? "font-medium text-amber-700" : "text-muted-foreground"}`}>
                    {amountError ??
                      (needsApproval
                        ? `${formatCents(thresholdCents)} or more: a second approver must sign off before money moves.`
                        : `Partial refunds allowed. Under ${formatCents(thresholdCents)} executes immediately.`)}
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label>Reason</Label>
                  <Select value={reason} onValueChange={setReason}>
                    <SelectTrigger className="w-full" data-testid="refund-reason">
                      <SelectValue placeholder="Select a reason code" />
                    </SelectTrigger>
                    <SelectContent>
                      {reasons.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="refund-note">
                    Internal note <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Textarea id="refund-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder="Context for the approver. Not shared with the customer." />
                </div>
              </div>
            ) : (
              <div className="rounded-lg border p-4 text-sm" data-testid="refund-confirm">
                <p className="text-base font-semibold">
                  Refund <span className="tabular-nums">{formatCents(amountCents)}</span> to {charge.customerName}?
                </p>
                <p className="mt-1 text-muted-foreground">
                  {reasons.find((r) => r.value === reason)?.label}
                  {note.trim() && ` · “${note.trim()}”`}
                </p>
                <p className="mt-3">
                  {needsApproval ? (
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">Goes to a second approver first</Badge>
                  ) : (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Executes immediately</Badge>
                  )}
                </p>
              </div>
            )}

            {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" onClick={step === "confirm" ? () => setStep("details") : reset} disabled={busy}>
                <ArrowLeft /> {step === "confirm" ? "Back" : "Start over"}
              </Button>
              {step === "details" ? (
                <Button onClick={() => setStep("confirm")} disabled={!!amountError || !reason}>
                  Review refund
                </Button>
              ) : (
                <Button onClick={submit} disabled={busy} data-testid="refund-submit">
                  {busy && <Loader2 className="animate-spin" />}
                  {needsApproval ? "Submit for approval" : `Refund ${formatCents(amountCents)}`}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
