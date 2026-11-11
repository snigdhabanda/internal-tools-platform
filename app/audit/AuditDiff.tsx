import { cn } from "@/lib/utils";

const parse = (v: string | null): Record<string, unknown> | null => {
  if (!v) return null;
  try {
    const o = JSON.parse(v);
    return o && typeof o === "object" && !Array.isArray(o) ? o : { value: o };
  } catch {
    return { value: v };
  }
};

const show = (v: unknown) => (v === undefined ? "" : v === null ? "null" : typeof v === "string" ? v : JSON.stringify(v));

/** Field-by-field before/after table. Changed fields are listed first and highlighted. */
export function AuditDiff({ before, after }: { before: string | null; after: string | null }) {
  const b = parse(before);
  const a = parse(after);
  if (!b && !a) return <span className="text-xs text-muted-foreground">No payload</span>;
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])];
  const changed = keys.filter((k) => show(b?.[k]) !== show(a?.[k]));
  const unchanged = keys.filter((k) => !changed.includes(k));
  const label = !b ? `Created · ${keys.length} fields` : `${changed.length} changed`;

  return (
    <details className="group">
      <summary className="cursor-pointer select-none text-xs font-medium text-primary">
        {label}
        {b && changed.length > 0 && <span className="ml-1 font-normal text-muted-foreground">({changed.slice(0, 3).join(", ")}{changed.length > 3 ? "…" : ""})</span>}
      </summary>
      <table className="mt-2 w-full border-collapse overflow-hidden rounded-md border text-xs">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-2 py-1 font-medium">Field</th>
            {b && <th className="px-2 py-1 font-medium">Before</th>}
            <th className="px-2 py-1 font-medium">{b ? "After" : "Value"}</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {[...changed, ...unchanged].map((k) => {
            const isChanged = !!b && changed.includes(k);
            return (
              <tr key={k} className={cn("border-t", !isChanged && b && "text-muted-foreground")}>
                <td className="px-2 py-1 align-top">{k}</td>
                {b && <td className={cn("max-w-48 break-all px-2 py-1 align-top", isChanged && "bg-rose-50 text-rose-800 line-through decoration-rose-300")}>{show(b[k])}</td>}
                <td className={cn("max-w-48 break-all px-2 py-1 align-top", isChanged && "bg-emerald-50 text-emerald-800")}>{show(a?.[k])}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
