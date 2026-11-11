import { ActionButton } from "@/components/ActionButton";
import { Card, Forbidden, PageHeader, StatusBadge, td, th } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatCents, formatDate } from "@/lib/format";
import { APPROVAL_THRESHOLD_CENTS, listRefunds } from "@/lib/apps/refunds/service";
import { getApp } from "@/lib/apps/registry";
import { getPageAccess } from "@/lib/platform/page";
import { hasRole } from "@/lib/platform/rbac";
import { RequestRefundForm } from "./RequestRefundForm";

const app = getApp("refunds");

export default async function RefundsPage() {
  const { user, allowed } = await getPageAccess(app.roles);
  if (!allowed) return <Forbidden roles={app.roles} />;

  const refunds = await listRefunds(prisma);
  const isApprover = hasRole(user, "approver");

  return (
    <div>
      <PageHeader title="Refunds" description={`Refunds of ${formatCents(APPROVAL_THRESHOLD_CENTS)} or more need approval from a different user with the approver role.`} />

      {hasRole(user, "reviewer") && (
        <Card title="Request a refund">
          <RequestRefundForm />
        </Card>
      )}

      <Card title={`All refunds (${refunds.length})`}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200" data-testid="refunds-table">
            <thead>
              <tr>
                <th className={th}>Customer</th>
                <th className={th}>Amount</th>
                <th className={th}>Reason</th>
                <th className={th}>Status</th>
                <th className={th}>Requested by</th>
                <th className={th}>Created</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {refunds.map((r) => {
                const ownRequest = r.requestedById === user!.id;
                return (
                  <tr key={r.id}>
                    <td className={td}>
                      <div className="font-medium">{r.customerName}</div>
                      <div className="text-xs text-slate-500">{r.customerEmail} · {r.chargeId}</div>
                    </td>
                    <td className={`${td} tabular-nums`}>{formatCents(r.amountCents)}</td>
                    <td className={td}>{r.reason}</td>
                    <td className={td}><StatusBadge status={r.status} /></td>
                    <td className={td}>{r.requestedBy.name}</td>
                    <td className={`${td} whitespace-nowrap text-slate-500`}>{formatDate(r.createdAt)}</td>
                    <td className={td}>
                      {r.status === "pending_approval" && r.approvalRequestId && isApprover && (
                        <div className="flex gap-2">
                          <ActionButton url={`/api/approvals/${r.approvalRequestId}`} body={{ decision: "approved" }} label="Approve" variant="success" />
                          <ActionButton url={`/api/approvals/${r.approvalRequestId}`} body={{ decision: "rejected" }} label="Reject" variant="danger" />
                        </div>
                      )}
                      {r.status === "pending_approval" && isApprover && ownRequest && (
                        <div className="mt-1 text-xs text-slate-500">You requested this; another approver must decide.</div>
                      )}
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
