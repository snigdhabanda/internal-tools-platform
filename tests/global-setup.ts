import { execSync } from "node:child_process";

/** Fresh SQLite test database (prisma/test.db) with all migrations, including audit triggers. */
export default function setup() {
  execSync("node scripts/reset-db.mjs", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: "file:./test.db", QUIET: "1" },
  });
}
