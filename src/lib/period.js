const pad = (n) => String(n).padStart(2, "0");

/** The date string a timeframe filters on, for a given day: `2026`, `2026-09` or `2026-09-30`. */
export function periodValue(timeframe, date) {
  const y = date.getFullYear();
  if (timeframe === "YEARLY") return `${y}`;
  if (timeframe === "MONTHLY") return `${y}-${pad(date.getMonth() + 1)}`;
  return `${y}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
