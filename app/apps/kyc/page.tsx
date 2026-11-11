import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { EmptyState, Forbidden, hrefWith, LinkTabs, PageHeader, Pagination, Person, RiskBadge, StatusBadge, TimeAgo } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { humanize } from "@/lib/format";
import { actionsFor, queryCases, type KycTab } from "@/lib/apps/kyc/service";
import { getApp } from "@/lib/apps/registry";
import { getPageAccess } from "@/lib/platform/page";
import { canViewPii, ID_TYPE_LABELS, type KycCaseView } from "@/lib/apps/kyc/present";
import { KYC_REASON_CODES, reasonLabel } from "@/lib/apps/kyc/state-machine";
import { cn } from "@/lib/utils";

const app = getApp("kyc");
const VARIANT = { claim: "default", approve: "outline", reject: "outline", escalate: "outline" } as const;
const TAB_LABELS: Record<KycTab, string> = { open: "Open", submitted: "New", in_review: "In review", escalated: "Escalated", pending_rejection: "Pending 2nd approval", approved: "Approved", rejected: "Rejected", all: "All" };
const CHECKS = [["identityCheck", "Identity"], ["documentCheck", "Document"], ["sanctionsCheck", "Sanctions/OFAC"], ["pepCheck", "PEP"]] as const;
const CHECK_CLS: Record<string, string> = { pass: "bg-emerald-50 text-emerald-700 border-emerald-200", fail: "bg-rose-50 text-rose-700 border-rose-200", needs_review: "bg-amber-50 text-amber-800 border-amber-200" };
const reasonOptions = (action: "approve" | "reject" | "escalate") => Object.entries(KYC_REASON_CODES[action]).map(([value, label]) => ({ value, label }));

function VendorChecks({ c }: { c: KycCaseView }) {
  if (!c.vendorCheckId) return <span className="text-xs text-muted-foreground">Runs on claim</span>;
  return (
    <div className="grid gap-1 text-xs" data-testid="vendor-checks">
      {CHECKS.map(([key, label]) => {
        const r = c[key];
        return (
          <div key={key} className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{label}</span>
            <Badge variant="outline" className={cn("px-1.5 py-0 text-[11px]", r ? CHECK_CLS[r] : "")}>{r ? humanize(r) : "—"}</Badge>
          </div>
        );
      })}
    </div>
  );
}

type SearchParams = Promise<Record<string, string | undefined>>;

export default async function KycPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, allowed } = await getPageAccess(app.roles);
  if (!allowed) return <Forbidden roles={app.roles} />;

  const sp = await searchParams;
  const current = { tab: sp.tab, q: sp.q, mine: sp.mine };
  // Masking happens inside queryCases() on the server; this page never sees raw PII unless allowed.
  const { rows, total, counts, tab, page, pageSize } = await queryCases(prisma, user!, { tab: sp.tab, q: sp.q, mine: sp.mine === "1", page: Number(sp.page) || 1 });
  const piiVisible = canViewPii(user);
  const userNames = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const approvalIds = rows.flatMap((c) => (c.approvalRequestId ? [c.approvalRequestId] : []));
  const secondApprovals = new Map(
    (await prisma.approvalRequest.findMany({ where: { id: { in: approvalIds } }, select: { id: true, status: true, approvedById: true, rejectedById: true, decidedAt: true } })).map((a) => [a.id, a]),
  );
  const when = (d: Date | null | undefined) => d?.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div>
      <PageHeader
        title="KYC review"
        description="CIP review (31 CFR 1020.220). Claim a case to run vendor checks, then approve, reject or escalate with a reason code and note. Escalations and rejections of all-clear cases need a different approver."
      >
        <Badge variant="outline" className={piiVisible ? "border-amber-200 bg-amber-50 text-amber-800" : ""}>
          {piiVisible ? "PII visible (approver)" : "PII masked"}
        </Badge>
      </PageHeader>

      <Card className="gap-0 py-0">
        <LinkTabs
          active={tab}
          tabs={(Object.keys(TAB_LABELS) as KycTab[]).map((t) => ({ key: t, label: TAB_LABELS[t], count: counts[t], highlight: t === "escalated", href: hrefWith("/apps/kyc", current, { tab: t, page: undefined }) }))}
        />
        <form method="get" className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <input type="hidden" name="tab" value={tab} />
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search applicant name, email or case ID" className="max-w-sm" />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === "1"} className="size-4 accent-primary" /> Assigned to me
          </label>
          <Button type="submit" variant="secondary">Apply</Button>
          {(sp.q || sp.mine) && <Button variant="ghost" asChild><Link href={hrefWith("/apps/kyc", { tab })}>Clear</Link></Button>}
        </form>

        {rows.length === 0 ? (
          <EmptyState title="No cases here" description={sp.q || sp.mine ? "No cases match these filters." : "The queue is empty for this status."} />
        ) : (
          <Table data-testid="kyc-table">
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="pl-4">Applicant</TableHead>
                <TableHead>Identifier</TableHead>
                <TableHead>Residential address</TableHead>
                <TableHead>Vendor checks</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-4 align-top">
                    <Person name={c.applicantName} sub={`${c.email} · DOB ${c.dateOfBirth}`} />
                    <Badge variant="outline" className="mt-1 text-[11px]">{c.isUSPerson ? "US person" : `Non-US person · ${c.country}`}</Badge>
                  </TableCell>
                  <TableCell className="align-top" data-testid="identifier">
                    <div className="text-xs text-muted-foreground">{ID_TYPE_LABELS[c.idType] ?? humanize(c.idType)}</div>
                    <div className="font-mono text-xs">{c.idNumber}</div>
                    {c.idCountry && <div className="text-xs text-muted-foreground">Issued by {c.idCountry}{c.idExpiry ? ` · exp ${c.idExpiry}` : ""}</div>}
                  </TableCell>
                  <TableCell className="align-top text-xs" data-testid="address">
                    <div>{c.addressLine1}{c.addressLine2 ? `, ${c.addressLine2}` : ""}</div>
                    <div className="text-muted-foreground">{[c.city, c.region, c.postalCode].filter(Boolean).join(", ")} · {c.country}</div>
                  </TableCell>
                  <TableCell className="min-w-44 align-top"><VendorChecks c={c} /></TableCell>
                  <TableCell className="align-top"><RiskBadge score={c.riskScore} /></TableCell>
                  <TableCell className="min-w-60 max-w-72 whitespace-normal align-top">
                    <StatusBadge status={c.status} />
                    {c.decisionReason && (
                      <div className="mt-1 text-xs" data-testid="decision">
                        <div className="font-medium">{reasonLabel(c.decisionReason)}</div>
                        {c.decisionNote && <div className="text-muted-foreground">“{c.decisionNote}”</div>}
                        <div className="text-muted-foreground">
                          {userNames.get(c.decidedById ?? "") ?? "—"} · {when(c.decidedAt)}
                        </div>
                        {(() => {
                          const a = c.approvalRequestId ? secondApprovals.get(c.approvalRequestId) : undefined;
                          if (!a) return null;
                          if (a.status === "pending") return <div className="font-medium text-rose-700">Awaiting a second approver</div>;
                          const by = userNames.get((a.status === "approved" ? a.approvedById : a.rejectedById) ?? "") ?? "—";
                          return <div className="text-muted-foreground">{a.status === "approved" ? "Rejection approved" : "Rejection declined"} by {by} · {when(a.decidedAt)}</div>;
                        })()}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">{c.assignedToName ?? "—"}</TableCell>
                  <TableCell className="align-top text-muted-foreground"><TimeAgo date={c.createdAt} /></TableCell>
                  <TableCell className="pr-4 align-top">
                    <div className="flex flex-wrap justify-end gap-2">
                      {actionsFor(user!, c).map((t) => (
                        <ActionButton
                          key={t.action}
                          url={`/api/apps/kyc/${c.id}/transition`}
                          body={{ action: t.action }}
                          label={t.action}
                          variant={VARIANT[t.action]}
                          successMessage={`${c.applicantName}: ${t.action === "claim" ? "claimed, vendor checks complete" : t.action === "reject" && CHECKS.every(([k]) => c[k] === "pass") ? "rejection sent for second approval" : humanize(t.to)}`}
                          confirm={
                            t.action === "claim"
                              ? undefined
                              : {
                                  title: `${humanize(t.action)} ${c.applicantName}?`,
                                  description:
                                    t.action === "reject" && CHECKS.every(([k]) => c[k] === "pass")
                                      ? "All vendor checks passed, so this rejection needs sign-off from a different approver before it takes effect."
                                      : `Moves the case from ${humanize(c.status)} to ${humanize(t.to)}. Recorded on the case and in the audit log.`,
                                  destructive: t.action === "reject",
                                  reasonCodes: reasonOptions(t.action),
                                  reason: { label: "Note", placeholder: "What did you check, and why this decision?" },
                                }
                          }
                        />
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} href={(p) => hrefWith("/apps/kyc", current, { page: p })} />
      </Card>
    </div>
  );
}
