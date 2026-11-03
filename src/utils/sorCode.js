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

/**
 * The Register's search: a SOR matches when the lowercase query `q` points at
 * its code, or sits inside its number, S0, client, project, Deal Owner or lead
 * source detail. The main register and the Deleted tab both filter with this.
 */
export function matchesSorSearch(opportunity, q) {
  if (matchesSorCode(opportunity, q)) return true;
  return [
    opportunity.opportunity_no,
    opportunity.sales_reference,
    opportunity.client_name,
    opportunity.project_title,
    opportunity.deal_owner?.name,
    opportunity.lead_source_detail,
  ]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
}
