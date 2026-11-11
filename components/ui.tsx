import type { ReactNode } from "react";

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function Card({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white shadow-sm">
      {title && <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">{title}</h2>}
      <div className="p-4">{children}</div>
    </section>
  );
}

const STATUS_COLORS: Record<string, string> = {
  executed: "bg-emerald-100 text-emerald-800",
  approved: "bg-emerald-100 text-emerald-800",
  pending_approval: "bg-amber-100 text-amber-800",
  pending: "bg-amber-100 text-amber-800",
  submitted: "bg-sky-100 text-sky-800",
  in_review: "bg-indigo-100 text-indigo-800",
  escalated: "bg-orange-100 text-orange-800",
  rejected: "bg-rose-100 text-rose-800",
  failed: "bg-rose-100 text-rose-800",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? "bg-slate-100 text-slate-700"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function Forbidden({ roles }: { roles: readonly string[] }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-rose-800">
      <h1 className="text-lg font-semibold">Access denied</h1>
      <p className="mt-1 text-sm">This page requires one of these roles: {roles.join(", ")}. Switch users in the header.</p>
    </div>
  );
}

export const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
export const td = "px-3 py-2 text-sm align-top";
