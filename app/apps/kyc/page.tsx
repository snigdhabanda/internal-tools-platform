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
import { canViewPii } from "@/lib/apps/kyc/present";

const app = getApp("kyc");
const VARIANT = { claim: "default", approve: "outline", reject: "outline", escalate: "outline" } as const;
const TAB_LABELS: Record<KycTab, string> = { open: "Open", submitted: "New", in_review: "In review", escalated: "Escalated", approved: "Approved", rejected: "Rejected", all: "All" };

type SearchParams = Promise<Record<string, string | undefined>>;

export default async function KycPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, allowed } = await getPageAccess(app.roles);
  if (!allowed) return <Forbidden roles={app.roles} />;

  const sp = await searchParams;
  const current = { tab: sp.tab, q: sp.q, mine: sp.mine };
  // Masking happens inside queryCases() on the server; this page never sees raw PII unless allowed.
  const { rows, total, counts, tab, page, pageSize } = await queryCases(prisma, user!, { tab: sp.tab, q: sp.q, mine: sp.mine === "1", page: Number(sp.page) || 1 });
  const piiVisible = canViewPii(user);

  return (
    <div>
      <PageHeader
        title="KYC review"
        description="Claim a case to run the vendor check, then approve, reject or escalate. Escalated cases are resolved by a different approver."
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
                <TableHead>SSN</TableHead>
                <TableHead>ID document</TableHead>
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
                  <TableCell className="pl-4">
                    <Person name={c.applicantName} sub={`${c.email} · ${c.country} · DOB ${c.dateOfBirth}`} />
                  </TableCell>
                  <TableCell className="font-mono text-xs" data-testid="ssn">{c.ssn}</TableCell>
                  <TableCell>
                    <div className="font-mono text-xs">{c.idNumber}</div>
                    <div className="text-xs text-muted-foreground">{humanize(c.idType)}</div>
                  </TableCell>
                  <TableCell>
                    <RiskBadge score={c.riskScore} />
                    {c.vendorResult && <div className="mt-1 text-xs text-muted-foreground">Vendor: {c.vendorResult}</div>}
                  </TableCell>
                  <TableCell><StatusBadge status={c.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{c.assignedToName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground"><TimeAgo date={c.createdAt} /></TableCell>
                  <TableCell className="pr-4">
                    <div className="flex flex-wrap justify-end gap-2">
                      {actionsFor(user!, c).map((t) => (
                        <ActionButton
                          key={t.action}
                          url={`/api/apps/kyc/${c.id}/transition`}
                          body={{ action: t.action }}
                          label={t.action}
                          variant={VARIANT[t.action]}
                          successMessage={`${c.applicantName}: ${t.action === "claim" ? "claimed, vendor check complete" : `${t.to.replace("_", " ")}`}`}
                          confirm={t.action === "claim" ? undefined : { title: `${humanize(t.action)} ${c.applicantName}?`, description: `Moves the case from ${humanize(c.status)} to ${humanize(t.to)}. This is recorded in the audit log.`, destructive: t.action === "reject" }}
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
