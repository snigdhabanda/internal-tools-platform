/** Parses YYYY-MM-DD as local time; rejects rollover dates like 2026-02-30 (JS would turn it into March 2). */
export function parseDay(v?: string, endOfDay = false) {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
  return d.getDate() === Number(v.slice(8, 10)) ? d : undefined;
}
