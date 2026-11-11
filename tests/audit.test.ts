import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as auditModule from "@/lib/platform/audit";
import { audit } from "@/lib/platform/audit";
import { GET as auditGET } from "@/app/api/audit/route";
import { ensureUsers, req } from "./helpers";

const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIRS = ["app", "lib", "components", "prisma", "scripts"];

function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx|mjs|js)$/.test(e.name) ? [rel] : [];
  });
}

describe("audit log is append-only", () => {
  beforeAll(ensureUsers);

  it("the audit module exports no update/delete functions", () => {
    const names = Object.keys(auditModule);
    expect(names).toContain("audit");
    for (const name of names) {
      expect(name).not.toMatch(/update|delete|remove|purge|truncate|edit|upsert|clear/i);
    }
  });

  it("no source file calls a mutating method on auditLog other than create", () => {
    const offenders: string[] = [];
    for (const file of SOURCE_DIRS.flatMap(sourceFiles)) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      if (/auditLog\s*\.\s*(update|updateMany|upsert|delete|deleteMany)\b/.test(text)) offenders.push(file);
      if (/(UPDATE|DELETE\s+FROM)\s+"?AuditLog"?/i.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("the database rejects UPDATE on AuditLog", async () => {
    const entry = await audit({ actorId: "t_admin", action: "test.created", entityType: "Test", entityId: "x1", after: { a: 1 } });
    // Prisma surfaces SQLite RAISE(ABORT) from ORM calls as a generic constraint error; raw SQL keeps the message.
    await expect(prisma.auditLog.update({ where: { id: entry.id }, data: { action: "tampered" } })).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE "AuditLog" SET "action" = 'tampered' WHERE "id" = ?`, entry.id)).rejects.toThrow(/append-only/);
    const reloaded = await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } });
    expect(reloaded.action).toBe("test.created");
  });

  it("the database rejects DELETE on AuditLog", async () => {
    const entry = await audit({ actorId: "t_admin", action: "test.created", entityType: "Test", entityId: "x2" });
    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow();
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE "id" = ?`, entry.id)).rejects.toThrow(/append-only/);
    expect(await prisma.auditLog.findUnique({ where: { id: entry.id } })).not.toBeNull();
  });

  it("stores before/after as JSON", async () => {
    const entry = await audit({ actorId: "t_admin", action: "test.changed", entityType: "Test", entityId: "x3", before: { v: 1 }, after: { v: 2 } });
    expect(JSON.parse(entry.before!)).toEqual({ v: 1 });
    expect(JSON.parse(entry.after!)).toEqual({ v: 2 });
  });

  it("the audit API is admin-only", async () => {
    expect((await auditGET(req("GET", "/api/audit", { as: "approver" }), undefined)).status).toBe(403);
    expect((await auditGET(req("GET", "/api/audit"), undefined)).status).toBe(401);
    const res = await auditGET(req("GET", "/api/audit?entityId=x3", { as: "admin" }), undefined);
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("test.changed");
  });
});
