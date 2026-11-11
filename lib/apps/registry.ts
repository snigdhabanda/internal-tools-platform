import type { ApprovalHandler } from "@/lib/platform/approvals";
import type { AppManifest } from "@/lib/platform/apps";
import type { Role } from "@/lib/platform/roles";
import { kycApp } from "./kyc/manifest";
import { refundsApp } from "./refunds/manifest";

/** Register every internal app here. Order = order in the left nav. */
export const APPS: AppManifest[] = [refundsApp, kycApp];

export type NavItem = { name: string; href: string; roles: Role[]; icon?: string };

export const PLATFORM_NAV: NavItem[] = [
  { name: "Approvals", href: "/approvals", roles: ["approver", "reviewer", "admin"], icon: "approvals" },
  { name: "Audit log", href: "/audit", roles: ["admin"], icon: "audit" },
];

export function appNav(): NavItem[] {
  return APPS.map((a) => ({ name: a.name, href: `/apps/${a.id}`, roles: a.roles, icon: a.id }));
}

export function getApp(id: string): AppManifest {
  const app = APPS.find((a) => a.id === id);
  if (!app) throw new Error(`Unknown app: ${id}`);
  return app;
}

export function approvalHandlers(): Record<string, ApprovalHandler> {
  const handlers: Record<string, ApprovalHandler> = {};
  for (const app of APPS) {
    for (const [entityType, handler] of Object.entries(app.approvalHandlers ?? {})) {
      if (handlers[entityType]) throw new Error(`Duplicate approval handler for ${entityType}`);
      handlers[entityType] = handler;
    }
  }
  return handlers;
}
