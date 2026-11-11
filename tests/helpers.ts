import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, type CurrentUser } from "@/lib/platform/auth";
import { parseRoles } from "@/lib/platform/roles";

export const TEST_USERS = {
  reviewer: { id: "t_reviewer", name: "Test Reviewer", email: "reviewer@test.example", roles: "reviewer" },
  reviewer2: { id: "t_reviewer2", name: "Test Reviewer 2", email: "reviewer2@test.example", roles: "reviewer" },
  approver: { id: "t_approver", name: "Test Approver", email: "approver@test.example", roles: "approver" },
  approver2: { id: "t_approver2", name: "Test Approver 2", email: "approver2@test.example", roles: "approver" },
  both: { id: "t_both", name: "Test Both", email: "both@test.example", roles: "reviewer,approver" },
  admin: { id: "t_admin", name: "Test Admin", email: "admin@test.example", roles: "admin" },
} as const;

export type TestUserKey = keyof typeof TEST_USERS;

export async function ensureUsers() {
  for (const u of Object.values(TEST_USERS)) {
    await prisma.user.upsert({ where: { id: u.id }, update: {}, create: u });
  }
}

export function asUser(key: TestUserKey): CurrentUser {
  const u = TEST_USERS[key];
  return { id: u.id, name: u.name, email: u.email, roles: parseRoles(u.roles) };
}

export function req(
  method: string,
  path: string,
  opts: { as?: TestUserKey; body?: unknown } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts.as) headers.set("cookie", `${SESSION_COOKIE}=${TEST_USERS[opts.as].id}`);
  return new NextRequest(new URL(path, "http://localhost"), {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

export async function auditFor(entityId: string) {
  return prisma.auditLog.findMany({ where: { entityId }, orderBy: { timestamp: "asc" } });
}
