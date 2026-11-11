// Deletes the SQLite file referenced by DATABASE_URL and re-applies all migrations.
// Used instead of `prisma migrate reset` because the AuditLog table has triggers
// that block DELETE, so it cannot be emptied row-by-row.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(path.join(process.cwd(), ".env"), "utf8");
  const match = env.match(/^DATABASE_URL="?([^"\n]+)"?/m);
  if (!match) throw new Error("DATABASE_URL is not set");
  return match[1];
}

const url = databaseUrl();
if (!url.startsWith("file:")) throw new Error(`Refusing to reset non-SQLite database: ${url}`);
const dbFile = path.resolve(process.cwd(), "prisma", url.replace(/^file:/, ""));
for (const suffix of ["", "-journal"]) {
  if (existsSync(dbFile + suffix)) rmSync(dbFile + suffix);
}
execSync("npx prisma migrate deploy", {
  stdio: process.env.QUIET ? "ignore" : "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
