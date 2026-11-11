import { ArrowRight, CheckCircle2, Clock, IdCard, Undo2 } from "lucide-react";
import Link from "next/link";
import { Avatar, EmptyState, PageHeader, StatCard, TimeAgo } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actorName, describeAction } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/format";
import { kycStats } from "@/lib/apps/kyc/service";
import { refundStats } from "@/lib/apps/refunds/service";
import { approvalHandlers, APPS } from "@/lib/apps/registry";
import { listPendingApprovals } from "@/lib/platform/approvals";
import { listRecentAudit } from "@/lib/platform/audit";
import { getCurrentUser, listUsers } from "@/lib/platform/auth";
import { hasRole } from "@/lib/platform/rbac";

const DAY_MS = 86_400_000;

/** Where an audit entry's entity lives in the UI, if anywhere. */
function entityHref(entityType: string, entityId: string, approvalTargets: Map<string, string>) {
  if (entityType === "Refund" && entityId !== "export") return `/apps/refunds?tab=all&refund=${entityId}`;
  if (entityType === "ApprovalRequest") return approvalTargets.get(entityId);
  if (entityType === "KycCase") return `/apps/kyc?tab=all&q=${entityId}`;
  return undefined;
}

export default async function Dashboard() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <EmptyState title="Welcome to Ops Console" description="Pick a user from the menu in the top right to sign in. Each seeded user has different roles." />
    );
  }

  const [refunds, kyc, pending, activity, users] = await Promise.all([
    refundStats(prisma),
    kycStats(prisma, user),
    listPendingApprovals(prisma),
    listRecentAudit(12),
    listUsers(),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const handlers = approvalHandlers();
  const approvalTargets = new Map(pending.map((p) => [p.id, handlers[p.entityType]?.href?.(p.entityId) ?? "/approvals"]));
  const isApprover = hasRole(user, "approver");
  const waitingOnMe = isApprover ? pending.filter((p) => p.requestedById !== user.id) : [];
  const now = Date.now();
  const apps = APPS.filter((a) => a.roles.some((r) => user.roles.includes(r)));

  return (
    <div>
      <PageHeader title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${user.name.split(" ")[0]}`} description="What needs attention across ops, compliance and support." />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Pending approvals"
          value={refunds.pending.count}
          hint={`${formatCents(refunds.pending.cents)} waiting for sign-off`}
          href="/approvals"
          icon={<Clock />}
          tone={pending.some((p) => now - p.createdAt.getTime() > DAY_MS) ? "warning" : "default"}
        />
        <StatCard label="Refunded today" value={formatCents(refunds.executedToday.cents)} hint={`${refunds.executedToday.count} refunds executed`} href="/apps/refunds?tab=executed" icon={<Undo2 />} />
        <StatCard
          label="KYC cases in queue"
          value={kyc.open}
          hint={`${kyc.submitted} new · ${kyc.inReview} in review · ${kyc.escalated} escalated`}
          href="/apps/kyc"
          icon={<IdCard />}
        />
        <StatCard
          label={isApprover ? "Waiting on you" : "Assigned to you"}
          value={isApprover ? waitingOnMe.length : kyc.assignedToMe}
          hint={isApprover ? "Approvals you can decide" : "KYC cases you've claimed"}
          href={isApprover ? "/approvals" : "/apps/kyc?mine=1&tab=in_review"}
          icon={<CheckCircle2 />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            {hasRole(user, "admin") && (
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/audit">Full audit log <ArrowRight /></Link>
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <EmptyState title="No activity yet" />
            ) : (
              <ul className="divide-y" data-testid="activity-feed">
                {activity.map((a) => {
                  const d = describeAction(a.action);
                  const who = actorName(a, names);
                  const href = entityHref(a.entityType, a.entityId, approvalTargets);
                  return (
                    <li key={a.id} className="flex items-center gap-3 py-3">
                      <Avatar name={who} />
                      <div className="min-w-0 flex-1 text-sm">
                        <span className="font-medium">{who}</span> <span className="text-muted-foreground">·</span>{" "}
                        {href ? <Link href={href} className="hover:underline">{d.label}</Link> : d.label}
                        <div className="truncate font-mono text-xs text-muted-foreground">{a.entityType} {a.entityId}</div>
                      </div>
                      <TimeAgo date={a.timestamp} className="text-xs text-muted-foreground" />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Oldest pending approvals</CardTitle>
            </CardHeader>
            <CardContent>
              {pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing waiting.</p>
              ) : (
                <ul className="space-y-3">
                  {pending.slice(0, 5).map((p) => {
                    const stale = now - p.createdAt.getTime() > DAY_MS;
                    return (
                      <li key={p.id}>
                        <Link href={approvalTargets.get(p.id) ?? "/approvals"} className="block rounded-md p-2 -m-2 hover:bg-muted/60">
                          <div className="text-sm font-medium">{handlers[p.entityType]?.summarize(JSON.parse(p.payload)) ?? p.entityType}</div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                            {p.requestedBy.name} · <TimeAgo date={p.createdAt} />
                            {stale && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">Over 24h</Badge>}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Apps</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {apps.map((a) => (
                <Link key={a.id} href={`/apps/${a.id}`} className="block rounded-md border p-3 hover:bg-muted/60">
                  <div className="text-sm font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">{a.description}</div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
