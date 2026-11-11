import { CheckCircle2, Clock, Download, XCircle } from "lucide-react";
import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { CopyText } from "@/components/CopyButton";
import {
  DetailList,
  EmptyState,
  Forbidden,
  hrefWith,
  LinkTabs,
  PageHeader,
  Pagination,
  Person,
  StatCard,
  StatusBadge,
  TimeAgo,
  Timeline,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actorName, describeAction } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { formatCents, formatDate } from "@/lib/format";
import {
  APPROVAL_THRESHOLD_CENTS,
  getRefund,
  queryRefunds,
  reasonLabel,
  REFUND_ENTITY,
  REFUND_REASON_LABELS,
  refundStats,
  remainingCents,
  type RefundTab,
} from "@/lib/apps/refunds/service";
import { getApp } from "@/lib/apps/registry";
import type { CurrentUser } from "@/lib/platform/auth";
import { listEntityHistory } from "@/lib/platform/audit";
import { listUsers } from "@/lib/platform/auth";
import { getPageAccess } from "@/lib/platform/page";
import { hasRole } from "@/lib/platform/rbac";
import { NewRefundDialog } from "./NewRefundDialog";
import { RefundDrawer } from "./RefundDrawer";

const app = getApp("refunds");

type SearchParams = Promise<Record<string, string | undefined>>;

const TAB_LABELS: Record<RefundTab, string> = {
  mine: "Needs my approval",
  pending_approval: "Pending",
  executed: "Executed",
  rejected: "Rejected",
  all: "All",
};

const FILTER_KEYS = ["tab", "q", "min", "max", "from", "to", "sort"] as const;

export default async function RefundsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, allowed } = await getPageAccess(app.roles);
  if (!allowed) return <Forbidden roles={app.roles} />;

  const sp = await searchParams;
  const current: Record<string, string | undefined> = Object.fromEntries(FILTER_KEYS.map((k) => [k, sp[k]]));
  const [{ rows, total, counts, tab, page, pageSize, sort }, stats] = await Promise.all([
    queryRefunds(prisma, user!, { ...current, page: Number(sp.page) || 1 }),
    refundStats(prisma),
  ]);
  const isApprover = hasRole(user, "approver");
  const tabs = (isApprover ? (Object.keys(TAB_LABELS) as RefundTab[]) : (Object.keys(TAB_LABELS) as RefundTab[]).filter((t) => t !== "mine")).map((t) => ({
    key: t,
    label: TAB_LABELS[t],
    count: counts[t],
    highlight: t === "mine",
    href: hrefWith("/apps/refunds", current, { tab: t, page: undefined }),
  }));
  const listHref = hrefWith("/apps/refunds", { ...current, page: sp.page });
  const sortLink = (asc: string, desc: string) => hrefWith("/apps/refunds", current, { sort: sort === desc ? asc : desc, page: undefined });
  const arrow = (asc: string, desc: string) => (sort === desc ? " ↓" : sort === asc ? " ↑" : "");
  const filtered = !!(sp.q || sp.min || sp.max || sp.from || sp.to);

  return (
    <div>
      <PageHeader
        title="Refunds"
        description={`Refund a customer against their original charge. Partial refunds are supported; ${formatCents(APPROVAL_THRESHOLD_CENTS)} or more needs a second approver.`}
      >
        <Button variant="outline" asChild>
          <a href={hrefWith("/api/apps/refunds/export", { ...current, sort: undefined })}>
            <Download /> Export CSV
          </a>
        </Button>
        {hasRole(user, "reviewer") && (
          <NewRefundDialog
            thresholdCents={APPROVAL_THRESHOLD_CENTS}
            reasons={Object.entries(REFUND_REASON_LABELS).map(([value, label]) => ({ value, label }))}
          />
        )}
      </PageHeader>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Pending approval" value={stats.pending.count} hint={`${formatCents(stats.pending.cents)} on hold`} href={hrefWith("/apps/refunds", {}, { tab: "pending_approval" })} icon={<Clock />} />
        <StatCard label="Refunded today" value={formatCents(stats.executedToday.cents)} hint={`${stats.executedToday.count} refunds executed`} icon={<CheckCircle2 />} />
        <StatCard label="Approval threshold" value={formatCents(APPROVAL_THRESHOLD_CENTS)} hint="At or above needs a second approver" icon={<XCircle />} />
      </div>

      <Card className="gap-0 py-0">
        <LinkTabs active={tab} tabs={tabs} />
        <form method="get" className="flex flex-wrap items-end gap-3 border-b px-4 py-3" data-testid="refund-filters">
          <input type="hidden" name="tab" value={tab} />
          {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
          <label className="grid min-w-64 flex-1 gap-1 text-xs text-muted-foreground">
            Search
            <Input name="q" defaultValue={sp.q ?? ""} placeholder="Customer, email or charge ID" />
          </label>
          <label className="grid w-28 gap-1 text-xs text-muted-foreground">
            Min amount
            <Input name="min" type="number" step="0.01" min="0" defaultValue={sp.min ?? ""} placeholder="$0" className="text-right tabular-nums" />
          </label>
          <label className="grid w-28 gap-1 text-xs text-muted-foreground">
            Max amount
            <Input name="max" type="number" step="0.01" min="0" defaultValue={sp.max ?? ""} placeholder="Any" className="text-right tabular-nums" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            From
            <Input name="from" type="date" defaultValue={sp.from ?? ""} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            To
            <Input name="to" type="date" defaultValue={sp.to ?? ""} />
          </label>
          <Button type="submit" variant="secondary">Apply</Button>
          {filtered && (
            <Button variant="ghost" asChild>
              <Link href={hrefWith("/apps/refunds", { tab })}>Clear</Link>
            </Button>
          )}
        </form>

        {rows.length === 0 ? (
          <EmptyState
            title={tab === "mine" && !filtered ? "Nothing needs your approval" : "No refunds found"}
            description={filtered ? "No refunds match these filters." : tab === "mine" ? "Refunds other people request at or above the threshold will show up here." : "There are no refunds in this view yet."}
          />
        ) : (
          <Table data-testid="refunds-table">
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="pl-4">Customer</TableHead>
                <TableHead>Charge</TableHead>
                <TableHead className="text-right">
                  <Link href={sortLink("amount_asc", "amount_desc")} className="hover:text-foreground">Amount{arrow("amount_asc", "amount_desc")}</Link>
                </TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested by</TableHead>
                <TableHead>
                  <Link href={sortLink("oldest", "newest")} className="hover:text-foreground">Created{arrow("oldest", "newest")}</Link>
                </TableHead>
                <TableHead className="pr-4 text-right"><span className="sr-only">Open</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className={sp.refund === r.id ? "bg-primary/5" : undefined}>
                  <TableCell className="pl-4">
                    <Link href={hrefWith("/apps/refunds", { ...current, page: sp.page }, { refund: r.id })} scroll={false} className="block max-w-64 hover:opacity-80">
                      <Person name={r.customerName} sub={r.customerEmail} />
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground"><CopyText value={r.chargeId} /></TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatCents(r.amountCents)}</TableCell>
                  <TableCell className="text-muted-foreground">{reasonLabel(r.reason)}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{r.requestedBy.name}</TableCell>
                  <TableCell className="text-muted-foreground"><TimeAgo date={r.createdAt} /></TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={hrefWith("/apps/refunds", { ...current, page: sp.page }, { refund: r.id })} scroll={false}>View</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} href={(p) => hrefWith("/apps/refunds", current, { page: p })} />
      </Card>

      {sp.refund && <RefundDetail id={sp.refund} user={user!} closeHref={listHref} />}
    </div>
  );
}

async function RefundDetail({ id, user, closeHref }: { id: string; user: CurrentUser; closeHref: string }) {
  const result = await getRefund(prisma, id);
  if (!result) {
    return (
      <RefundDrawer title="Refund not found" description="It may have been removed, or the link is wrong." closeHref={closeHref}>
        <EmptyState title="Nothing to show" />
      </RefundDrawer>
    );
  }
  const { refund, approval } = result;
  const charge = refund.charge;
  const [history, users] = await Promise.all([
    listEntityHistory([{ entityType: REFUND_ENTITY, entityId: refund.id }, ...(approval ? [{ entityType: "ApprovalRequest", entityId: approval.id }] : [])]),
    listUsers(),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const pending = refund.status === "pending_approval" && approval?.status === "pending";
  const own = refund.requestedById === user.id;
  const canDecide = pending && hasRole(user, "approver") && !own;
  const money = formatCents(refund.amountCents);

  return (
    <RefundDrawer
      closeHref={closeHref}
      title={
        <>
          <span className="tabular-nums">{money}</span> <StatusBadge status={refund.status} />
        </>
      }
      description={`Refund to ${refund.customerName} · requested ${formatDate(refund.createdAt)}`}
    >
      {pending && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {own
            ? "You requested this refund, so a different approver must decide it (maker-checker)."
            : canDecide
              ? `Requested by ${refund.requestedBy.name}. No money moves until an approver signs off.`
              : `Waiting for an approver other than ${refund.requestedBy.name}.`}
          {canDecide && (
            <div className="mt-3 flex gap-2">
              <ActionButton
                url={`/api/approvals/${approval!.id}`}
                body={{ decision: "approved" }}
                label="Approve"
                variant="default"
                successMessage={`Approved: ${money} refunded to ${refund.customerName}`}
                confirm={{ title: `Refund ${money} to ${refund.customerName}?`, description: `Approving sends the refund to the payment processor immediately against ${charge.id}.`, confirmLabel: `Approve and refund ${money}` }}
              />
              <ActionButton
                url={`/api/approvals/${approval!.id}`}
                body={{ decision: "rejected" }}
                label="Reject"
                variant="outline"
                successMessage="Refund rejected"
                confirm={{ title: `Reject ${money} refund to ${refund.customerName}?`, description: "The customer will not be refunded and the held balance is released.", confirmLabel: "Reject refund", destructive: true, reason: { label: "Reason for rejecting", placeholder: "e.g. Already refunded via chargeback" } }}
              />
            </div>
          )}
        </div>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">Refund</h3>
        <DetailList
          items={[
            { label: "Amount", value: <span className="font-medium tabular-nums">{money} {refund.currency.toUpperCase()}</span> },
            { label: "Reason", value: reasonLabel(refund.reason) },
            { label: "Internal note", value: refund.note },
            { label: "Requested by", value: refund.requestedBy.name },
            { label: "Provider refund ID", value: refund.providerRefundId ? <CopyText value={refund.providerRefundId} /> : null },
            ...(approval
              ? [
                  { label: "Approval", value: <StatusBadge status={approval.status} /> },
                  { label: "Decided by", value: approval.approvedBy?.name ?? approval.rejectedBy?.name ?? null },
                  ...(approval.status === "rejected" ? [{ label: "Rejection reason", value: approval.decisionNote }] : []),
                ]
              : []),
            { label: "Idempotency key", value: <CopyText value={refund.idempotencyKey} className="text-muted-foreground" /> },
          ]}
        />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Original charge</h3>
        <div className="mb-3 grid grid-cols-3 divide-x rounded-lg border bg-muted/40 text-center">
          {[
            ["Original", charge.amountCents],
            ["Refunded", charge.amountRefundedCents],
            ["Remaining", remainingCents(charge)],
          ].map(([label, cents]) => (
            <div key={label} className="px-3 py-2.5">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-sm font-semibold tabular-nums">{formatCents(cents as number)}</div>
            </div>
          ))}
        </div>
        <DetailList
          items={[
            { label: "Charge ID", value: <CopyText value={charge.id} /> },
            { label: "Customer", value: <Person name={charge.customerName} sub={charge.customerEmail} /> },
            { label: "Description", value: charge.description },
            { label: "Charged", value: formatDate(charge.createdAt) },
            ...(charge.amountPendingCents > 0 ? [{ label: "On hold", value: <span className="tabular-nums">{formatCents(charge.amountPendingCents)} pending approval</span> }] : []),
          ]}
        />
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Timeline</h3>
        <Timeline
          items={history.map((h) => {
            const d = describeAction(h.action);
            const after = h.after ? (JSON.parse(h.after) as { decisionNote?: string | null; providerRefundId?: string | null }) : {};
            const detail =
              h.action === "approval.rejected" && after.decisionNote
                ? `“${after.decisionNote}”`
                : h.action === "refund.executed" && after.providerRefundId
                  ? after.providerRefundId
                  : undefined;
            return { id: h.id, title: d.label, detail, tone: d.tone, actor: actorName(h, names), at: h.timestamp };
          })}
        />
      </section>
    </RefundDrawer>
  );
}
