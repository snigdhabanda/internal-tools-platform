import { Card, Forbidden, PageHeader, td, th } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { listAuditFacets, listAuditLogs } from "@/lib/platform/audit";
import { listUsers } from "@/lib/platform/auth";
import { getPageAccess } from "@/lib/platform/page";

const ROLES = ["admin"] as const;

type SearchParams = Promise<Record<string, string | undefined>>;

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const { allowed } = await getPageAccess(ROLES);
  if (!allowed) return <Forbidden roles={ROLES} />;

  const q = await searchParams;
  const parseDate = (v?: string, endOfDay = false) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
    const d = new Date(`${v}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const [logs, facets, users] = await Promise.all([
    listAuditLogs({
      actorId: q.actorId,
      action: q.action,
      entityType: q.entityType,
      entityId: q.entityId,
      from: parseDate(q.from),
      to: parseDate(q.to, true),
    }),
    listAuditFacets(),
    listUsers(),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const select = "rounded-md border border-slate-300 bg-white px-2 py-1 text-sm";

  return (
    <div>
      <PageHeader title="Audit log" description="Append-only record of every write on the platform. Newest first, up to 200 rows." />
      <Card>
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="text-xs text-slate-500">
            Actor
            <select name="actorId" defaultValue={q.actorId ?? ""} className={`${select} block`}>
              <option value="">All</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
              <option value="system:seed">system:seed</option>
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Entity type
            <select name="entityType" defaultValue={q.entityType ?? ""} className={`${select} block`}>
              <option value="">All</option>
              {facets.entityTypes.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Action
            <select name="action" defaultValue={q.action ?? ""} className={`${select} block`}>
              <option value="">All</option>
              {facets.actions.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Entity ID
            <input name="entityId" defaultValue={q.entityId ?? ""} className={`${select} block`} />
          </label>
          <label className="text-xs text-slate-500">
            From
            <input type="date" name="from" defaultValue={q.from ?? ""} className={`${select} block`} />
          </label>
          <label className="text-xs text-slate-500">
            To
            <input type="date" name="to" defaultValue={q.to ?? ""} className={`${select} block`} />
          </label>
          <button className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">Filter</button>
          <a href="/audit" className="text-sm text-slate-500 underline">Reset</a>
        </form>
      </Card>

      <Card title={`${logs.length} entries`}>
        <table className="min-w-full divide-y divide-slate-200" data-testid="audit-table">
          <thead>
            <tr>
              <th className={th}>Time</th>
              <th className={th}>Actor</th>
              <th className={th}>Action</th>
              <th className={th}>Entity</th>
              <th className={th}>Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((l) => (
              <tr key={l.id}>
                <td className={`${td} whitespace-nowrap text-slate-500`}>{formatDate(l.timestamp)}</td>
                <td className={td}>{userName.get(l.actorId) ?? l.actorId}</td>
                <td className={`${td} font-mono text-xs`}>{l.action}</td>
                <td className={td}>
                  <div>{l.entityType}</div>
                  <div className="font-mono text-xs text-slate-500">{l.entityId}</div>
                </td>
                <td className={td}>
                  <details>
                    <summary className="cursor-pointer text-xs text-indigo-600">before / after</summary>
                    <div className="mt-2 grid max-w-2xl grid-cols-2 gap-2">
                      <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs">{l.before ? JSON.stringify(JSON.parse(l.before), null, 2) : "—"}</pre>
                      <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs">{l.after ? JSON.stringify(JSON.parse(l.after), null, 2) : "—"}</pre>
                    </div>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
