import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APPS } from "@/lib/apps/registry";
import { analyzeRoute, type RouteExemptions } from "./guardrails/analyze-route";

/**
 * GUARDRAILS. These run in CI on every PR. If one fails, fix the code; do not weaken the test.
 * Adding an exemption requires a written reason and security review.
 */

const ROOT = path.resolve(__dirname, "..");

const EXEMPTIONS: Record<string, RouteExemptions> = {
  "app/api/session/route.ts": {
    requireRole: "Mock login: establishes identity, so there is no user to authorize yet. Still audited.",
  },
};

function walk(dir: string, match: (file: string) => boolean): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(rel, match);
    return match(rel) ? [rel] : [];
  });
}

const routeFiles = walk("app", (f) => /\/route\.(ts|tsx|js|mjs)$/.test(f));

describe("guardrail: every API route calls requireRole() first, and every write calls audit()", () => {
  it("discovers the route files", () => {
    expect(routeFiles).toEqual(expect.arrayContaining(["app/api/apps/refunds/route.ts", "app/api/approvals/[id]/route.ts"]));
  });

  it.each(routeFiles)("%s", (file) => {
    expect(file.endsWith(".ts"), "route handlers must be TypeScript").toBe(true);
    const { handlers, violations } = analyzeRoute(fs.readFileSync(path.join(ROOT, file), "utf8"), file, EXEMPTIONS[file]);
    expect(handlers.length, "route file exports no HTTP handlers").toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it("exemptions point at real files", () => {
    for (const file of Object.keys(EXEMPTIONS)) expect(routeFiles).toContain(file);
  });
});

describe("guardrail: no write paths that bypass route handlers", () => {
  const sources = ["app", "lib", "components"].flatMap((d) => walk(d, (f) => /\.(ts|tsx)$/.test(f)));

  it("no Server Actions ('use server'), since they would skip the route guardrails", () => {
    const offenders = sources.filter((f) => /^\s*["']use server["']/m.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("no pages/api directory or middleware-based handlers", () => {
    expect(fs.existsSync(path.join(ROOT, "pages"))).toBe(false);
  });

  it("client components never import the database or server-only platform modules", () => {
    const offenders = sources.filter((f) => {
      const text = fs.readFileSync(path.join(ROOT, f), "utf8");
      return /^\s*["']use client["']/m.test(text) && /from\s+["']@\/lib\/(db|platform\/(audit|approvals|auth))["']/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});

describe("guardrail: registered apps follow the platform layout", () => {
  it.each(APPS.map((a) => a.id))("app %s has a page at app/apps/<id>/page.tsx that checks access", (id) => {
    const page = path.join(ROOT, "app/apps", id, "page.tsx");
    expect(fs.existsSync(page)).toBe(true);
    expect(fs.readFileSync(page, "utf8")).toMatch(/getPageAccess\(/);
  });

  it.each(APPS.map((a) => a.id))("app %s keeps server logic in lib/apps/<id>/", (id) => {
    expect(fs.existsSync(path.join(ROOT, "lib/apps", id, "manifest.ts"))).toBe(true);
  });
});

describe("guardrail analyzer catches violations (negative controls)", () => {
  const header = `import { requireRole } from "@/lib/platform/rbac";\nimport { audit } from "@/lib/platform/audit";\n`;

  it("flags a handler without requireRole", () => {
    const src = header + `export async function GET() { return Response.json(await prisma.user.findMany()); }`;
    expect(analyzeRoute(src, "x.ts").violations.join()).toMatch(/R1 GET/);
  });

  it("flags a write handler without audit", () => {
    const src = header + `export const POST = route(async (req) => { requireRole(await getUserFromRequest(req), ["reviewer"]); await prisma.refund.create({}); return new Response(); });`;
    expect(analyzeRoute(src, "x.ts").violations.join()).toMatch(/R3 POST/);
  });

  it("flags a GET that writes without audit", () => {
    const src = header + `export async function GET(req) { requireRole(null, ["admin"]); await prisma.refund.update({}); return new Response(); }`;
    expect(analyzeRoute(src, "x.ts").violations.join()).toMatch(/R3 GET/);
  });

  it("flags work done before requireRole", () => {
    const src = header + `export async function POST(req) { const body = await req.json(); requireRole(null, ["admin"]); await audit({}); return new Response(); }`;
    expect(analyzeRoute(src, "x.ts").violations.join()).toMatch(/R2 POST: calls req\.json before requireRole/);
  });

  it("flags locally defined fakes of requireRole/audit", () => {
    const src = `const requireRole = () => {}; const audit = () => {};\nexport async function POST() { requireRole(); audit(); return new Response(); }`;
    const v = analyzeRoute(src, "x.ts").violations.join();
    expect(v).toMatch(/requireRole must be imported/);
    expect(v).toMatch(/audit must be imported/);
  });

  it("flags re-exported handlers", () => {
    const src = `export { POST } from "./elsewhere";`;
    expect(analyzeRoute(src, "x.ts").violations.join()).toMatch(/R4 POST/);
  });

  it("passes a compliant handler", () => {
    const src = header + `export const POST = route(async (req) => { const user = requireRole(await getUserFromRequest(req), ["reviewer"]); await prisma.$transaction(async (tx) => { await audit({}, tx); }); return new Response(); });`;
    expect(analyzeRoute(src, "x.ts").violations).toEqual([]);
  });
});
