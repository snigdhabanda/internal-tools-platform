import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { parseRoles, type Role } from "./roles";

/**
 * MOCK AUTH. The current user id is stored in a plain cookie that anyone can set.
 * This stands in for real SSO (OIDC/SAML) and must be replaced before production.
 */
export const SESSION_COOKIE = "itp_user";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  roles: Role[];
};

export async function loadUser(userId: string | undefined | null): Promise<CurrentUser | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, roles: parseRoles(user.roles) };
}

/** For API route handlers. */
export async function getUserFromRequest(req: NextRequest): Promise<CurrentUser | null> {
  return loadUser(req.cookies.get(SESSION_COOKIE)?.value);
}

/** For server components / layouts. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  return loadUser(store.get(SESSION_COOKIE)?.value);
}

export async function listUsers(): Promise<CurrentUser[]> {
  const users = await prisma.user.findMany({ orderBy: { name: "asc" } });
  return users.map((u) => ({ id: u.id, name: u.name, email: u.email, roles: parseRoles(u.roles) }));
}
