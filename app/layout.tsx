import type { Metadata } from "next";
import Link from "next/link";
import { UserSwitcher } from "@/components/UserSwitcher";
import { appNav, PLATFORM_NAV, type NavItem } from "@/lib/apps/registry";
import { getCurrentUser, listUsers } from "@/lib/platform/auth";
import "./globals.css";

export const metadata: Metadata = { title: "Internal Tools Platform" };
export const dynamic = "force-dynamic";

function NavSection({ title, items, roles }: { title: string; items: NavItem[]; roles: string[] }) {
  const visible = items.filter((i) => i.roles.some((r) => roles.includes(r)));
  if (visible.length === 0) return null;
  return (
    <div className="mb-6">
      <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      {visible.map((i) => (
        <Link key={i.href} href={i.href} className="block rounded-md px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
          {i.name}
        </Link>
      ))}
    </div>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, users] = await Promise.all([getCurrentUser(), listUsers()]);
  const roles = user?.roles ?? [];

  return (
    <html lang="en">
      <body>
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6">
          <Link href="/" className="font-semibold">
            Internal Tools <span className="text-slate-400">Platform</span>
          </Link>
          <UserSwitcher users={users} currentId={user?.id ?? null} />
        </header>
        <div className="flex">
          <nav className="min-h-[calc(100vh-3.5rem)] w-56 shrink-0 border-r border-slate-200 bg-white py-6">
            <NavSection title="Apps" items={appNav()} roles={roles} />
            <NavSection title="Platform" items={PLATFORM_NAV} roles={roles} />
            {!user && <p className="px-3 text-xs text-slate-500">Choose a user in the header to see apps.</p>}
          </nav>
          <main className="flex-1 p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
