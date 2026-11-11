import type { CurrentUser } from "./auth";
import { ForbiddenError, UnauthorizedError } from "./errors";
import type { Role } from "./roles";

/**
 * The single authorization gate. Every API route must call this before doing anything else
 * (enforced by tests/guardrails.test.ts). Passes if the user holds ANY of the given roles.
 * Returns the user narrowed to non-null.
 */
export function requireRole(user: CurrentUser | null, roles: readonly Role[]): CurrentUser {
  if (!user) throw new UnauthorizedError();
  if (roles.length === 0) throw new Error("requireRole called with no roles");
  if (!roles.some((r) => user.roles.includes(r))) {
    throw new ForbiddenError(`Requires one of: ${roles.join(", ")}`);
  }
  return user;
}

/** Non-throwing check, for UI decisions and data shaping. Never a substitute for requireRole. */
export function hasRole(user: CurrentUser | null, role: Role): boolean {
  return !!user && user.roles.includes(role);
}
