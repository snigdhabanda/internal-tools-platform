import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { SidebarNav, type SidebarItem } from "@/components/SidebarNav";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserSwitcher } from "@/components/UserSwitcher";
import { prisma } from "@/lib/db";
import { appNav, PLATFORM_NAV, type NavItem } from "@/lib/apps/registry";
import { getCurrentUser, listUsers } from "@/lib/platform/auth";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = { title: "Ops Console" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, users] = await Promise.all([getCurrentUser(), listUsers()]);
  // Badge = approvals this user could act on (approver, not their own request).
  const waitingOnMe = user?.roles.includes("approver")
    ? await prisma.approvalRequest.count({ where: { status: "pending", requestedById: { not: user.id } } })
    : 0;
  const roles = user?.roles ?? [];
  const visible = (items: NavItem[]): SidebarItem[] =>
    items
      .filter((i) => i.roles.some((r) => roles.includes(r)))
      .map((i) => ({ name: i.name, href: i.href, icon: i.icon, badge: i.href === "/approvals" ? waitingOnMe : undefined }));

  return (
    <html lang="en" className={cn("font-sans", inter.variable)}>
      <body>
        <TooltipProvider>
          <div className="flex min-h-screen">
            <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r bg-background">
              <Link href="/" className="flex h-16 items-center gap-3 border-b px-5">
                <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">O</span>
                <span>
                  <span className="block text-sm font-semibold">Ops Console</span>
                  <span className="block text-[11px] text-muted-foreground">Internal tools</span>
                </span>
              </Link>
              <SidebarNav
                sections={
                  user
                    ? [
                        { items: [{ name: "Dashboard", href: "/", icon: "home" }] },
                        { title: "Apps", items: visible(appNav()) },
                        { title: "Platform", items: visible(PLATFORM_NAV) },
                      ]
                    : []
                }
              />
              {!user && <p className="px-5 text-xs text-muted-foreground">Choose a user in the top right to see apps.</p>}
              <div className="border-t px-5 py-4 text-[11px] leading-relaxed text-muted-foreground">
                Every action is permission-checked and written to an append-only audit log.
              </div>
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/90 px-8 backdrop-blur">
                <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  Sandbox · stubbed payment processor and KYC vendor
                </span>
                <UserSwitcher users={users} currentId={user?.id ?? null} />
              </header>
              {/* Keyed by user so client state (inline errors, half-filled forms) resets on user switch. */}
              <main key={user?.id ?? "anonymous"} className="mx-auto w-full max-w-7xl flex-1 px-8 py-8">
                {children}
              </main>
            </div>
          </div>
          <Toaster position="bottom-right" richColors closeButton />
        </TooltipProvider>
      </body>
    </html>
  );
}
