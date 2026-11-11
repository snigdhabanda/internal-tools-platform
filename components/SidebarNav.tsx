"use client";

import { CheckCircle2, FileText, IdCard, Layers, LayoutDashboard, Undo2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type SidebarItem = { name: string; href: string; icon?: string; badge?: number };

const ICONS: Record<string, LucideIcon> = {
  home: LayoutDashboard,
  refunds: Undo2,
  kyc: IdCard,
  approvals: CheckCircle2,
  audit: FileText,
};

export function SidebarNav({ sections }: { sections: { title?: string; items: SidebarItem[] }[] }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <nav className="flex-1 space-y-6 px-3 py-5">
      {sections.map((s, i) =>
        s.items.length === 0 ? null : (
          <div key={s.title ?? i}>
            {s.title && <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{s.title}</div>}
            <ul className="space-y-0.5">
              {s.items.map((item) => {
                const Icon = ICONS[item.icon ?? ""] ?? Layers;
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        active ? "bg-primary/10 text-primary" : "text-neutral-600 hover:bg-neutral-100 hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                      <span className="flex-1">{item.name}</span>
                      {!!item.badge && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-amber-800">{item.badge}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ),
      )}
    </nav>
  );
}
