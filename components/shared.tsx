import { ChevronLeft, ChevronRight, Inbox, Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar as UiAvatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatRelative, humanize, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Page title row with optional breadcrumbs and right-aligned actions. */
export function PageHeader({
  title,
  description,
  children,
  breadcrumbs,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
}) {
  return (
    <div className="mb-6">
      {breadcrumbs && (
        <nav className="mb-2 flex items-center gap-1 text-xs text-muted-foreground" aria-label="Breadcrumb">
          {breadcrumbs.map((b, i) => (
            <span key={b.label} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3" />}
              {b.href ? <Link href={b.href} className="hover:text-foreground">{b.label}</Link> : <span className="text-foreground">{b.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  href,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  icon?: ReactNode;
  tone?: "default" | "warning";
}) {
  const body = (
    <Card className={cn("h-full gap-0 py-0 transition-shadow", href && "hover:shadow-md", tone === "warning" && "ring-amber-300")}>
      <CardContent className="flex flex-row items-start justify-between gap-3 p-5">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        {icon && <div className="rounded-lg bg-primary/10 p-2 text-primary [&_svg]:size-5">{icon}</div>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

const STATUS: Record<string, { cls: string; label?: string }> = {
  executed: { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Executed" },
  approved: { cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  clear: { cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  pending_approval: { cls: "bg-amber-50 text-amber-800 border-amber-200", label: "Pending approval" },
  pending: { cls: "bg-amber-50 text-amber-800 border-amber-200" },
  consider: { cls: "bg-amber-50 text-amber-800 border-amber-200" },
  processing: { cls: "bg-sky-50 text-sky-700 border-sky-200" },
  submitted: { cls: "bg-sky-50 text-sky-700 border-sky-200", label: "New" },
  in_review: { cls: "bg-indigo-50 text-indigo-700 border-indigo-200", label: "In review" },
  escalated: { cls: "bg-orange-50 text-orange-700 border-orange-200" },
  pending_rejection: { cls: "bg-rose-50 text-rose-700 border-rose-200", label: "Rejection pending 2nd approver" },
  rejected: { cls: "bg-rose-50 text-rose-700 border-rose-200" },
  failed: { cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

export const statusLabel = (status: string) => STATUS[status]?.label ?? humanize(status);

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", STATUS[status]?.cls)}>
      {statusLabel(status)}
    </Badge>
  );
}

export function RiskBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  const [cls, label] =
    score >= 70 ? ["bg-rose-50 text-rose-700 border-rose-200", "High"] : score >= 40 ? ["bg-amber-50 text-amber-800 border-amber-200", "Medium"] : ["bg-emerald-50 text-emerald-700 border-emerald-200", "Low"];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn(cls, "cursor-help")} data-testid="risk-badge">
          {label} <span className="tabular-nums opacity-70">{score}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-60">
        Vendor risk score {score} on a 0–100 scale. Low 0–39 · Medium 40–69 · High 70–100.
      </TooltipContent>
    </Tooltip>
  );
}

export function Avatar({ name, size = "default" }: { name: string; size?: "sm" | "default" | "lg" }) {
  return (
    <UiAvatar className={cn(size === "sm" && "size-6", size === "lg" && "size-12")}>
      <AvatarFallback className={cn("bg-neutral-100 font-medium text-neutral-700", size === "sm" ? "text-[10px]" : "text-xs")}>{initials(name)}</AvatarFallback>
    </UiAvatar>
  );
}

export function Person({ name, sub }: { name: string; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={name} />
      <div className="min-w-0">
        <div className="truncate font-medium">{name}</div>
        {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

export function TimeAgo({ date, className }: { date: Date | string; className?: string }) {
  return (
    <time dateTime={new Date(date).toISOString()} title={formatDate(date)} className={cn("whitespace-nowrap", className)}>
      {formatRelative(date)}
    </time>
  );
}

export function Forbidden({ roles }: { roles: readonly string[] }) {
  return (
    <Card className="mx-auto mt-16 max-w-md text-center">
      <CardContent className="p-8">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
          <Lock className="size-6" />
        </div>
        <h1 className="text-lg font-semibold">Access denied</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page requires one of these roles: <span className="font-medium text-foreground">{roles.join(", ")}</span>. Switch users from the menu in the top right.
        </p>
      </CardContent>
    </Card>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-muted p-3 text-muted-foreground">
        <Inbox className="size-5" />
      </div>
      <div className="text-sm font-medium">{title}</div>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Builds `base?…` from current params plus overrides; empty/undefined values are dropped. */
export function hrefWith(base: string, current: Record<string, string | undefined>, overrides: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...overrides })) {
    if (v !== undefined && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** URL-driven tabs (server-rendered links styled like shadcn Tabs). */
export function LinkTabs({ tabs, active }: { tabs: { key: string; label: string; count?: number; href: string; highlight?: boolean }[]; active: string }) {
  return (
    <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b px-4" role="tablist">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            role="tab"
            aria-selected={on}
            className={cn(
              "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors",
              on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-xs tabular-nums",
                  t.highlight && t.count > 0 ? "bg-amber-100 text-amber-800" : on ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {t.count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

export function Pagination({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
      <span>
        Showing <span className="font-medium text-foreground tabular-nums">{from}–{to}</span> of <span className="font-medium text-foreground tabular-nums">{total}</span>
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button variant="outline" size="sm" asChild><Link href={href(page - 1)}><ChevronLeft /> Previous</Link></Button>
        ) : (
          <Button variant="outline" size="sm" disabled><ChevronLeft /> Previous</Button>
        )}
        {page < pages ? (
          <Button variant="outline" size="sm" asChild><Link href={href(page + 1)}>Next <ChevronRight /></Link></Button>
        ) : (
          <Button variant="outline" size="sm" disabled>Next <ChevronRight /></Button>
        )}
      </div>
    </div>
  );
}

export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y">
      {items.map((i) => (
        <div key={i.label} className="grid grid-cols-5 gap-4 py-2.5">
          <dt className="col-span-2 text-sm text-muted-foreground">{i.label}</dt>
          <dd className="col-span-3 min-w-0 break-words text-sm">{i.value ?? <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export type TimelineItem = { id: string; title: ReactNode; detail?: ReactNode; actor: string; at: Date; tone?: "emerald" | "rose" | "amber" | "indigo" | "slate" };

export function Timeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No history yet.</p>;
  const dots = { emerald: "bg-emerald-500", rose: "bg-rose-500", amber: "bg-amber-500", indigo: "bg-primary", slate: "bg-neutral-400" };
  return (
    <ol className="relative ml-1.5 space-y-5 border-l pl-5">
      {items.map((i) => (
        <li key={i.id} className="relative">
          <span className={cn("absolute -left-[25px] top-1 size-2.5 rounded-full ring-4 ring-background", dots[i.tone ?? "slate"])} />
          <div className="text-sm font-medium">{i.title}</div>
          {i.detail && <div className="mt-0.5 text-sm text-muted-foreground">{i.detail}</div>}
          <div className="mt-0.5 text-xs text-muted-foreground">
            {i.actor} · <span title={formatDate(i.at)}>{formatDate(i.at)}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Skeleton for a page with a header, stat cards, and a table. Used by route loading.tsx files. */
export function PageSkeleton({ stats = 0, rows = 8 }: { stats?: number; rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-7 w-56" />
      <Skeleton className="mb-6 h-4 w-96" />
      {stats > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: stats }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      )}
      <div className="rounded-xl border bg-card p-4">
        <Skeleton className="mb-4 h-9 w-full" />
        {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="mb-3 h-10 w-full" />)}
      </div>
    </div>
  );
}
