"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Monospace ID with a copy-to-clipboard button. */
export function CopyText({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 font-mono text-xs", className)}>
      <span className="truncate">{value}</span>
      <button
        type="button"
        title="Copy"
        aria-label={`Copy ${value}`}
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await navigator.clipboard?.writeText(value).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}
