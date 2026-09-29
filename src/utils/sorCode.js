/**
 * SOR Code — `SOR-357` — the SOR's own reference. The database stores it
 * (`sales_opportunities.sor_code`, generated from `serial_no`); this only
 * reads it. The `serial_no` fallback covers a row fetched before the column
 * existed (a frontend deployed ahead of its migration), never a second source.
 */
export function sorCodeOf(opportunity) {
  if (!opportunity) return "";
  if (opportunity.sor_code) return opportunity.sor_code;
  return opportunity.serial_no != null ? `SOR-${opportunity.serial_no}` : "";
}

const squash = (value) => String(value).toLowerCase().replace(/[\s-]/g, "");

/**
 * Whether a search box query points at this SOR's code. People type it every
 * way — `SOR-357`, `sor357`, `SOR 357`, `357` — so dashes, spaces and case
 * are ignored on both sides.
 */
export function matchesSorCode(opportunity, query) {
  const q = squash(query ?? "");
  const code = sorCodeOf(opportunity);
  if (!q || !code) return false;
  return squash(code).includes(q);
}
