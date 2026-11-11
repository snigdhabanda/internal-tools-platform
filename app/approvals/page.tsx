import { ActionButton } from "@/components/ActionButton";
import { Card, Forbidden, PageHeader, td, th } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { approvalHandlers } from "@/lib/apps/registry";
import { listPendingApprovals } from "@/lib/platform/approvals";
import { getPageAccess } from "@/lib/platform/page";
import { hasRole } from "@/lib/platform/rbac";

const ROLES = ["approver", "reviewer", "admin"] as const;

export default async function ApprovalsPage() {
  const { user, allowed } = await getPageAccess(ROLES);
  if (!allowed) return <Forbidden roles={ROLES} />;

  const handlers = approvalHandlers();
  const pending = await listPendingApprovals(prisma);
  const isApprover = hasRole(user, "approver");

  return (
    <div>
      <PageHeader title="Approvals" description="Pending maker-checker requests from every app. You can never decide your own request." />
      <Card>
        {pending.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing waiting for approval.</p>
        ) : (
          <table className="min-w-full divide-y divide-slate-200">
            <thead>
              <tr>
                <th className={th}>Request</th>
                <th className={th}>Type</th>
                <th className={th}>Requested by</th>
                <th className={th}>Created</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pending.map((r) => (
                <tr key={r.id}>
                  <td className={td}>{handlers[r.entityType]?.summarize(JSON.parse(r.payload)) ?? r.entityId}</td>
                  <td className={td}>{r.entityType}</td>
                  <td className={td}>{r.requestedBy.name}</td>
                  <td className={`${td} text-slate-500`}>{formatDate(r.createdAt)}</td>
                  <td className={td}>
                    {isApprover && (
                      <div className="flex gap-2">
                        <ActionButton url={`/api/approvals/${r.id}`} body={{ decision: "approved" }} label="Approve" variant="success" />
                        <ActionButton url={`/api/approvals/${r.id}`} body={{ decision: "rejected" }} label="Reject" variant="danger" />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
