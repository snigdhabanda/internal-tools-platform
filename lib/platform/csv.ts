/** Quote every cell and neutralize spreadsheet formulas (=, +, -, @) so exports can't execute in Excel. */
export function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  // Leading whitespace too: some importers trim it and would then evaluate the formula.
  return `"${(/^\s*[=+\-@]/.test(s) || /^[\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
}

export function csvResponse(name: string, header: string[], rows: unknown[][]) {
  const body = [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
