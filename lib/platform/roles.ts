export const ROLES = ["reviewer", "approver", "admin"] as const;
export type Role = (typeof ROLES)[number];

export function parseRoles(value: string): Role[] {
  return value
    .split(",")
    .map((r) => r.trim())
    .filter((r): r is Role => (ROLES as readonly string[]).includes(r));
}
