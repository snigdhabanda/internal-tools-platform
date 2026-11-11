export const formatCents = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export const formatDate = (d: Date | string) =>
  new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
