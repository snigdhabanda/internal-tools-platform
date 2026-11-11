import { formatCents } from "@/lib/format";

type Balance = { amountCents: number; amountRefundedCents: number; amountPendingCents: number };

/** Original − Refunded − On hold = Remaining, laid out so the math visibly adds up. */
export function ChargeBalancePanel({ charge }: { charge: Balance }) {
  const remaining = charge.amountCents - charge.amountRefundedCents - charge.amountPendingCents;
  const cells: [string, number, string?][] = [
    ["Original", charge.amountCents],
    ["Refunded", charge.amountRefundedCents, "−"],
    ["On hold (pending)", charge.amountPendingCents, "−"],
    ["Remaining", remaining, "="],
  ];
  return (
    <div className="@container mb-3" data-testid="charge-balance">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border text-center @md:grid-cols-4">
        {cells.map(([label, cents, op]) => (
          <div key={label} className="relative bg-muted px-2 py-2.5">
            {op && <span className="absolute top-1/2 -left-1.5 hidden -translate-y-1/2 text-xs text-muted-foreground @md:inline">{op}</span>}
            <div className="text-xs whitespace-nowrap text-muted-foreground">{label}</div>
            <div className="text-sm font-semibold whitespace-nowrap tabular-nums">{formatCents(cents)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
