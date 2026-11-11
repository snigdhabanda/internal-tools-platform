import { describe, expect, it } from "vitest";
import { ForbiddenError, UnauthorizedError } from "@/lib/platform/errors";
import { hasRole, requireRole } from "@/lib/platform/rbac";
import { asUser } from "./helpers";

describe("requireRole", () => {
  it("rejects anonymous users with 401", () => {
    expect(() => requireRole(null, ["reviewer"])).toThrow(UnauthorizedError);
  });

  it("rejects users without any of the roles with 403", () => {
    expect(() => requireRole(asUser("reviewer"), ["approver", "admin"])).toThrow(ForbiddenError);
  });

  it("passes when the user has any of the roles and returns the user", () => {
    const user = asUser("both");
    expect(requireRole(user, ["approver"])).toBe(user);
  });

  it("does not treat admin as a superuser", () => {
    expect(() => requireRole(asUser("admin"), ["approver"])).toThrow(ForbiddenError);
    expect(hasRole(asUser("admin"), "approver")).toBe(false);
  });

  it("refuses an empty role list", () => {
    expect(() => requireRole(asUser("admin"), [])).toThrow();
  });
});
