export const formatCents = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Compact money for dashboards: $12.4K. */
export const formatCentsCompact = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

export const formatDate = (d: Date | string) =>
  new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export const formatDay = (d: Date | string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** "3 min ago", "2 days ago". Server-rendered, so relative to request time. */
export function formatRelative(d: Date | string, now: Date = new Date()) {
  const seconds = Math.round((now.getTime() - new Date(d).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return rtf.format(-Math.round(seconds / size), unit);
  }
  return "just now";
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((p) => /^[A-Za-z]/.test(p) && !/^(dr|mr|mrs|ms|jr|sr)\.?$/i.test(p))
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";

export const humanize = (s: string) => {
  const t = s.replace(/[_.]/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
