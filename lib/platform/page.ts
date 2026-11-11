import { getCurrentUser, type CurrentUser } from "./auth";
import type { Role } from "./roles";

/** Page-level access check for server components. Pages render <Forbidden /> when !allowed. */
export async function getPageAccess(
  roles: readonly Role[],
): Promise<{ user: CurrentUser | null; allowed: boolean }> {
  const user = await getCurrentUser();
  const allowed = !!user && roles.some((r) => user.roles.includes(r));
  return { user, allowed };
}
