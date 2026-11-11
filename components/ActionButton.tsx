"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ComponentProps } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ButtonVariant = ComponentProps<typeof Button>["variant"];

async function post(url: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const issue = data.issues?.[0]?.message;
    return issue ?? data.error ?? `Request failed (${res.status})`;
  } catch {
    return "Network error. Check your connection and try again.";
  }
}

/**
 * POSTs JSON to an API route, toasts the result, and refreshes server data.
 * With `confirm`, asks first in a dialog; with `confirm.reason`, the dialog collects a required
 * reason that is sent as `note`.
 */
export function ActionButton({
  url,
  body,
  label,
  variant = "outline",
  size = "sm",
  confirm,
  successMessage,
}: {
  url: string;
  body: Record<string, unknown>;
  label: string;
  variant?: ButtonVariant;
  size?: "xs" | "sm" | "default";
  confirm?: { title: string; description?: string; confirmLabel?: string; destructive?: boolean; reason?: { label: string; placeholder?: string } };
  successMessage?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function run() {
    setBusy(true);
    setError(null);
    const failure = await post(url, confirm?.reason ? { ...body, note: reason.trim() } : body);
    setBusy(false);
    if (failure) {
      setError(failure);
      toast.error(failure);
      return;
    }
    setOpen(false);
    setReason("");
    toast.success(successMessage ?? "Done");
    startTransition(() => router.refresh());
  }

  if (!confirm) {
    return (
      <Button variant={variant} size={size} disabled={busy} onClick={run} className="capitalize">
        {busy && <Loader2 className="animate-spin" />}
        {label}
      </Button>
    );
  }

  const reasonMissing = !!confirm.reason && reason.trim().length < 3;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className="capitalize">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{confirm.title}</DialogTitle>
          {confirm.description && <DialogDescription>{confirm.description}</DialogDescription>}
        </DialogHeader>
        {confirm.reason && (
          <div className="grid gap-2">
            <Label htmlFor="action-reason">{confirm.reason.label}</Label>
            <Textarea id="action-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={confirm.reason.placeholder} rows={3} autoFocus />
            <p className="text-xs text-muted-foreground">Required. Recorded in the audit log.</p>
          </div>
        )}
        {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={run}
            disabled={busy || reasonMissing}
            className={confirm.destructive ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
          >
            {busy && <Loader2 className="animate-spin" />}
            {confirm.confirmLabel ?? label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
