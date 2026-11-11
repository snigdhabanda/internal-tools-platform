import ts from "typescript";

/**
 * Static analysis of a Next.js route.ts file, used by tests/guardrails.test.ts.
 *
 * Rules for every exported HTTP handler:
 *   R1  calls requireRole(), imported from "@/lib/platform/rbac"
 *   R2  requireRole() is the first call in the handler (only the route() wrapper may precede it)
 *   R3  write handlers (POST/PUT/PATCH/DELETE, or any handler calling a Prisma write method)
 *       call audit(), imported from "@/lib/platform/audit"
 *   R4  handlers are defined in the route file, not re-exported from elsewhere
 */

export const HTTP_METHODS = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"] as const;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PRISMA_WRITE = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe)$/;
const ALLOWED_BEFORE_REQUIRE_ROLE = new Set(["route"]);

export type RouteExemptions = { requireRole?: string; audit?: string };

export type HandlerReport = {
  method: string;
  isWrite: boolean;
  calls: string[];
  callsRequireRole: boolean;
  callsAudit: boolean;
};

function calleeName(call: ts.CallExpression, sf: ts.SourceFile): string {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  return e.getText(sf).replace(/\s+/g, "");
}

function collectCalls(node: ts.Node, sf: ts.SourceFile): { name: string; pos: number }[] {
  const calls: { name: string; pos: number }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) calls.push({ name: calleeName(n, sf), pos: n.getStart(sf) });
    ts.forEachChild(n, visit);
  };
  visit(node);
  return calls.sort((a, b) => a.pos - b.pos);
}

function importedFrom(sf: ts.SourceFile): Map<string, string> {
  const map = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause?.namedBindings) continue;
    const mod = (stmt.moduleSpecifier as ts.StringLiteral).text;
    const nb = stmt.importClause.namedBindings;
    if (ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        if ((el.propertyName ?? el.name).text === el.name.text) map.set(el.name.text, mod);
      }
    }
  }
  return map;
}

const isExported = (node: ts.Node) =>
  !!ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

export function analyzeRoute(source: string, fileName: string, exemptions: RouteExemptions = {}) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: string[] = [];
  const handlers: HandlerReport[] = [];
  const imports = importedFrom(sf);
  const methods = new Set<string>(HTTP_METHODS);

  const handlerNodes: { method: string; node: ts.Node }[] = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && isExported(stmt) && stmt.name && methods.has(stmt.name.text)) {
      handlerNodes.push({ method: stmt.name.text, node: stmt });
    }
    if (ts.isVariableStatement(stmt) && isExported(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && methods.has(d.name.text) && d.initializer) {
          handlerNodes.push({ method: d.name.text, node: d.initializer });
        }
      }
    }
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        if (methods.has(el.name.text)) violations.push(`R4 ${el.name.text}: handlers must be defined in the route file, not re-exported`);
      }
    }
  }

  for (const { method, node } of handlerNodes) {
    const calls = collectCalls(node, sf);
    const names = calls.map((c) => c.name);
    const isWrite = WRITE_METHODS.has(method) || names.some((n) => PRISMA_WRITE.test(n));
    const report: HandlerReport = {
      method,
      isWrite,
      calls: names,
      callsRequireRole: names.includes("requireRole"),
      callsAudit: names.includes("audit"),
    };
    handlers.push(report);

    if (!exemptions.requireRole) {
      if (!report.callsRequireRole) {
        violations.push(`R1 ${method}: does not call requireRole()`);
      } else {
        const before = names.slice(0, names.indexOf("requireRole")).filter((n) => !ALLOWED_BEFORE_REQUIRE_ROLE.has(n));
        if (before.length) violations.push(`R2 ${method}: calls ${before.join(", ")} before requireRole()`);
      }
    }
    if (isWrite && !exemptions.audit && !report.callsAudit) {
      violations.push(`R3 ${method}: writes data but does not call audit()`);
    }
  }

  if (handlers.some((h) => h.callsRequireRole) && imports.get("requireRole") !== "@/lib/platform/rbac") {
    violations.push(`R1 requireRole must be imported from "@/lib/platform/rbac"`);
  }
  if (handlers.some((h) => h.callsAudit) && imports.get("audit") !== "@/lib/platform/audit") {
    violations.push(`R3 audit must be imported from "@/lib/platform/audit"`);
  }

  return { handlers, violations };
}
