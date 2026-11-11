import { ActionButton } from "@/components/ActionButton";
import { Card, Forbidden, PageHeader, StatusBadge, td, th } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { listCases } from "@/lib/apps/kyc/service";
import { availableActions, KYC_STATUSES } from "@/lib/apps/kyc/state-machine";
import { getApp } from "@/lib/apps/registry";
import { getPageAccess } from "@/lib/platform/page";

const app = getApp("kyc");
const VARIANT = { claim: "primary", approve: "success", reject: "danger", escalate: "neutral" } as const;

export default async function KycPage() {
  const { user, allowed } = await getPageAccess(app.roles);
  if (!allowed) return <Forbidden roles={app.roles} />;

  // Masking happens inside listCases() on the server; this page never sees raw PII unless allowed.
  const cases = await listCases(prisma, user!);
  const counts = Object.fromEntries(KYC_STATUSES.map((s) => [s, cases.filter((c) => c.status === s).length]));

  return (
    <div>
      <PageHeader
        title="KYC review queue"
        description="submitted → in_review → approved | rejected | escalated. Escalated cases are resolved by approvers."
      >
        <span className={`rounded-md px-2 py-1 text-xs ${cases[0]?.piiMasked === false ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
          PII {cases[0]?.piiMasked === false ? "visible (approver)" : "masked"}
        </span>
      </PageHeader>

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {KYC_STATUSES.map((s) => (
          <span key={s} className="flex items-center gap-1">
            <StatusBadge status={s} /> <span className="text-slate-500">{counts[s]}</span>
          </span>
        ))}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200" data-testid="kyc-table">
            <thead>
              <tr>
                <th className={th}>Applicant</th>
                <th className={th}>SSN</th>
                <th className={th}>ID</th>
                <th className={th}>Status</th>
                <th className={th}>Vendor</th>
                <th className={th}>Assigned</th>
                <th className={th}>Submitted</th>
                <th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cases.map((c) => {
                const actions = availableActions(c.status).filter(
                  (t) =>
                    t.roles.some((r) => user!.roles.includes(r)) &&
                    (c.status !== "in_review" || c.assignedToId === user!.id) &&
                    (c.status !== "escalated" || c.escalatedById !== user!.id),
                );
                return (
                  <tr key={c.id}>
                    <td className={td}>
                      <div className="font-medium">{c.applicantName}</div>
                      <div className="text-xs text-slate-500">{c.email} · DOB {c.dateOfBirth} · {c.country}</div>
                    </td>
                    <td className={`${td} whitespace-nowrap font-mono`} data-testid="ssn">{c.ssn}</td>
                    <td className={`${td} font-mono`}>
                      <div>{c.idNumber}</div>
                      <div className="text-xs text-slate-500">{c.idType.replace(/_/g, " ")}</div>
                    </td>
                    <td className={td}><StatusBadge status={c.status} /></td>
                    <td className={`${td} text-xs`}>
                      {c.vendorResult ? (
                        <>
                          <div>{c.vendorResult}</div>
                          <div className="text-slate-500">risk {c.riskScore}</div>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className={td}>{c.assignedToName ?? <span className="text-slate-400">—</span>}</td>
                    <td className={`${td} whitespace-nowrap text-slate-500`}>{formatDate(c.createdAt)}</td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-2">
                        {actions.map((t) => (
                          <ActionButton
                            key={t.action}
                            url={`/api/apps/kyc/${c.id}/transition`}
                            body={{ action: t.action }}
                            label={t.action}
                            variant={VARIANT[t.action]}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
