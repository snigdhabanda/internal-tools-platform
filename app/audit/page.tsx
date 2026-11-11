import { Download } from "lucide-react";
import Link from "next/link";
import { EmptyState, Forbidden, hrefWith, PageHeader } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actorName } from "@/lib/activity";
import { formatDate } from "@/lib/format";
import { APPS } from "@/lib/apps/registry";
import { listAuditFacets, listAuditLogs } from "@/lib/platform/audit";
import { parseAuditFilters, PLATFORM_ENTITY_TYPES } from "@/lib/platform/audit-filters";
import { listUsers } from "@/lib/platform/auth";
import { getPageAccess } from "@/lib/platform/page";
import { cn } from "@/lib/utils";
import { AuditDiff } from "./AuditDiff";

const ROLES = ["admin"] as const;
const FILTER_KEYS = ["actorId", "app", "action", "entityId", "from", "to"] as const;

type SearchParams = Promise<Record<string, string | undefined>>;

function appFor(entityType: string) {
  if (PLATFORM_ENTITY_TYPES.includes(entityType)) return "Platform";
  return APPS.find((a) => a.entityTypes?.includes(entityType))?.name ?? "—";
}

const selectCls =
  "h-9 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none";

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const { allowed } = await getPageAccess(ROLES);
  if (!allowed) return <Forbidden roles={ROLES} />;

  const sp = await searchParams;
  const current: Record<string, string | undefined> = Object.fromEntries(FILTER_KEYS.map((k) => [k, sp[k]]));
  const [logs, facets, users] = await Promise.all([listAuditLogs(parseAuditFilters(current, APPS)), listAuditFacets(), listUsers()]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const filtered = FILTER_KEYS.some((k) => sp[k]);

  return (
    <div>
      <PageHeader title="Audit log" description="Append-only record of every write on the platform, newest first (up to 200 rows; export for up to 1,000). Rows can't be edited or deleted.">
        <Button variant="outline" asChild>
          <a href={hrefWith("/api/audit/export", current)}>
            <Download /> Export CSV
          </a>
        </Button>
      </PageHeader>

      <Card className="gap-0 py-0">
        <form method="get" className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Actor
            <select name="actorId" defaultValue={sp.actorId ?? ""} className={selectCls}>
              <option value="">All actors</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              <option value="system:seed">System (seed)</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            App
            <select name="app" defaultValue={sp.app ?? ""} className={selectCls}>
              <option value="">All apps</option>
              {APPS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              <option value="platform">Platform</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Action
            <select name="action" defaultValue={sp.action ?? ""} className={selectCls}>
              <option value="">All actions</option>
              {facets.actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Entity ID
            <Input name="entityId" defaultValue={sp.entityId ?? ""} className="w-48 font-mono text-xs" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            From
            <Input type="date" name="from" defaultValue={sp.from ?? ""} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            To
            <Input type="date" name="to" defaultValue={sp.to ?? ""} />
          </label>
          <Button type="submit" variant="secondary">Apply</Button>
          {filtered && <Button variant="ghost" asChild><Link href="/audit">Reset</Link></Button>}
        </form>

        <div className="border-b px-4 py-2 text-xs text-muted-foreground">{logs.length} entries</div>
        {logs.length === 0 ? (
          <EmptyState title="No audit entries match" description="Try widening the date range or clearing filters." />
        ) : (
          <Table data-testid="audit-table">
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="pl-4">Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>App</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead className="pr-4">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((l) => (
                <TableRow key={l.id} className="align-top">
                  <TableCell className="whitespace-nowrap pl-4 text-muted-foreground tabular-nums">{formatDate(l.timestamp)}</TableCell>
                  <TableCell>{actorName(l, names)}</TableCell>
                  <TableCell className="text-muted-foreground">{appFor(l.entityType)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("font-mono font-normal", /rejected|failed/.test(l.action) && "border-rose-200 text-rose-700", /approved|executed/.test(l.action) && "border-emerald-200 text-emerald-700")}>
                      {l.action}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{l.entityType}</div>
                    <Link href={hrefWith("/audit", {}, { entityId: l.entityId })} className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline">
                      {l.entityId}
                    </Link>
                  </TableCell>
                  <TableCell className="min-w-80 whitespace-normal pr-4">
                    <AuditDiff before={l.before} after={l.after} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
