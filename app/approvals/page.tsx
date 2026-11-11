import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { EmptyState, Forbidden, hrefWith, LinkTabs, PageHeader, StatusBadge, TimeAgo } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { approvalHandlers } from "@/lib/apps/registry";
import { listDecidedApprovals, listPendingApprovals } from "@/lib/platform/approvals";
import { getPageAccess } from "@/lib/platform/page";
import { hasRole } from "@/lib/platform/rbac";
import { cn } from "@/lib/utils";

const ROLES = ["approver", "reviewer", "admin"] as const;
const DAY_MS = 86_400_000;

type SearchParams = Promise<Record<string, string | undefined>>;

function waitingFor(createdAt: Date, now: number) {
  const hours = Math.floor((now - createdAt.getTime()) / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor((now - createdAt.getTime()) / 60_000))}m`;
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, allowed } = await getPageAccess(ROLES);
  if (!allowed) return <Forbidden roles={ROLES} />;

  const sp = await searchParams;
  const handlers = approvalHandlers();
  const [pending, decided] = await Promise.all([listPendingApprovals(prisma), listDecidedApprovals(prisma)]);
  const isApprover = hasRole(user, "approver");
  const waitingOnMe = isApprover ? pending.filter((r) => r.requestedById !== user!.id) : [];
  const mine = pending.filter((r) => r.requestedById === user!.id);
  const view = sp.view === "mine" || sp.view === "decided" || sp.view === "all" ? sp.view : isApprover ? "waiting" : "mine";
  const rows = view === "waiting" ? waitingOnMe : view === "mine" ? mine : view === "all" ? pending : [];
  const now = Date.now();
  const summary = (r: { entityType: string; payload: string; entityId: string }) => handlers[r.entityType]?.summarize(JSON.parse(r.payload)) ?? `${r.entityType} ${r.entityId}`;
  const link = (r: { entityType: string; entityId: string }) => handlers[r.entityType]?.href?.(r.entityId);

  const tabs = [
    ...(isApprover ? [{ key: "waiting", label: "Waiting on me", count: waitingOnMe.length, highlight: true }] : []),
    { key: "mine", label: "My requests", count: mine.length },
    { key: "all", label: "All pending", count: pending.length },
    { key: "decided", label: "Recently decided" },
  ].map((t) => ({ ...t, href: hrefWith("/approvals", {}, { view: t.key }) }));

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Maker-checker requests from every app. You can never decide your own request. Anything waiting more than 24 hours is highlighted."
      />
      <Card className="gap-0 py-0">
        <LinkTabs active={view} tabs={tabs} />
        {view === "decided" ? (
          decided.length === 0 ? (
            <EmptyState title="No decisions yet" />
          ) : (
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="pl-4">Request</TableHead>
                  <TableHead>Requested by</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>Decided by</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="pr-4">Decided</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decided.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-4 font-medium">{link(r) ? <Link href={link(r)!} className="hover:underline">{summary(r)}</Link> : summary(r)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.requestedBy.name}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-muted-foreground">{r.approvedBy?.name ?? r.rejectedBy?.name}</TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground" title={r.decisionNote ?? undefined}>{r.decisionNote ?? "—"}</TableCell>
                    <TableCell className="pr-4 text-muted-foreground">{r.decidedAt && <TimeAgo date={r.decidedAt} />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        ) : rows.length === 0 ? (
          <EmptyState
            title={view === "waiting" ? "You're all caught up" : "Nothing pending"}
            description={view === "waiting" ? "Nothing is waiting on your approval right now." : view === "mine" ? "None of your requests are waiting on an approver." : undefined}
          />
        ) : (
          <Table data-testid="approvals-table">
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="pl-4">Request</TableHead>
                <TableHead>App</TableHead>
                <TableHead>Requested by</TableHead>
                <TableHead>Waiting</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const stale = now - r.createdAt.getTime() > DAY_MS;
                const canDecide = isApprover && r.requestedById !== user!.id;
                const text = summary(r);
                return (
                  <TableRow key={r.id} className={cn(stale && "bg-amber-50/60 hover:bg-amber-50")} data-stale={stale || undefined}>
                    <TableCell className="pl-4 font-medium">{link(r) ? <Link href={link(r)!} className="hover:underline">{text}</Link> : text}</TableCell>
                    <TableCell className="text-muted-foreground">{r.entityType}</TableCell>
                    <TableCell className="text-muted-foreground">{r.requestedBy.name}</TableCell>
                    <TableCell>
                      <span className={cn("tabular-nums", stale ? "font-medium text-amber-800" : "text-muted-foreground")} title={r.createdAt.toISOString()}>
                        {waitingFor(r.createdAt, now)}
                      </span>
                      {stale && <Badge variant="outline" className="ml-2 border-amber-300 bg-amber-100 text-amber-900">Over 24h</Badge>}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      {canDecide ? (
                        <div className="flex justify-end gap-2">
                          <ActionButton
                            url={`/api/approvals/${r.id}`}
                            body={{ decision: "rejected" }}
                            label="Reject"
                            successMessage="Rejected"
                            confirm={{ title: `Reject: ${text}?`, description: "The requester will see your reason.", confirmLabel: "Reject", destructive: true, reason: { label: "Reason for rejecting" } }}
                          />
                          <ActionButton
                            url={`/api/approvals/${r.id}`}
                            body={{ decision: "approved" }}
                            label="Approve"
                            variant="default"
                            successMessage={`Approved: ${text}`}
                            confirm={{ title: `${text}?`, description: `Requested by ${r.requestedBy.name}. Approving executes it immediately.`, confirmLabel: "Approve" }}
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{r.requestedById === user!.id ? "Your request: needs another approver" : "Approvers only"}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
