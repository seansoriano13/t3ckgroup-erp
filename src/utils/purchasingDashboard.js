/**
 * The Purchasing Dashboard (#322): every project's buying grouped by what is
 * outstanding. The rows come from `purchasing_dashboard_rows()`, one per record
 * that owns a piece of work; this file only groups and filters them. The groups
 * are derived, never stored, and one SOR sits in as many as apply (ADR 0023).
 */

export const DASHBOARD_GROUP = {
  TO_SOURCE: "to_source",
  TO_PRICE: "to_price",
  TO_ORDER: "to_order",
  ON_ORDER: "on_order",
  TO_CHECK: "to_check",
};

export const DASHBOARD_GROUPS = Object.values(DASHBOARD_GROUP);

export const DASHBOARD_GROUP_LABELS = {
  [DASHBOARD_GROUP.TO_SOURCE]: "To source",
  [DASHBOARD_GROUP.TO_PRICE]: "To price",
  [DASHBOARD_GROUP.TO_ORDER]: "To order",
  [DASHBOARD_GROUP.ON_ORDER]: "On order",
  [DASHBOARD_GROUP.TO_CHECK]: "To check",
};

export const DASHBOARD_GROUP_HINTS = {
  [DASHBOARD_GROUP.TO_SOURCE]: "Requested Items at Requested or To order, and Canvasses with no winner.",
  [DASHBOARD_GROUP.TO_PRICE]: "Components with no Acquire, and matrices still waiting on a Bid Decision.",
  [DASHBOARD_GROUP.TO_ORDER]: "Priced and decided Go, with no PO yet.",
  [DASHBOARD_GROUP.ON_ORDER]: "Ordered and not yet received.",
  [DASHBOARD_GROUP.TO_CHECK]: "Received, moving through a Transmittal's checks.",
};

const DAY = 86_400_000;

/** Whole days from `since` to `today`, never negative. */
export const ageDays = (since, today = new Date()) =>
  since ? Math.max(0, Math.floor((today.getTime() - new Date(since).getTime()) / DAY)) : 0;

/**
 * Narrow the rows by the filters, every one optional and all of them together:
 * `sor` (S number or project title, any case), `buyerId`, `canvasserId`,
 * `minAgeDays`, and `noCanvass`, which keeps only items ordered with no canvass
 * and counts only those.
 */
export function filterRows(rows, { sor = "", buyerId = null, canvasserId = null, minAgeDays = null, noCanvass = false } = {}, today = new Date()) {
  const needle = String(sor ?? "").trim().toLowerCase();
  return rows
    .filter((row) => !needle || [row.sales_reference, row.project_title].some((value) => String(value ?? "").toLowerCase().includes(needle)))
    .filter((row) => !buyerId || row.buyer_id === buyerId)
    .filter((row) => !canvasserId || row.canvasser_id === canvasserId)
    .filter((row) => !minAgeDays || ageDays(row.since, today) >= minAgeDays)
    .filter((row) => !noCanvass || row.no_canvass_count > 0)
    .map((row) => (noCanvass ? { ...row, item_count: row.no_canvass_count } : row));
}

/**
 * The five groups, always in order and always present, each with its item
 * count, how many SORs it spans, and per SOR its item count and the rows
 * (records) that hold the work, oldest first.
 */
export function dashboardView(rows, filters = {}, today = new Date()) {
  const kept = filterRows(rows ?? [], filters, today);
  const groups = DASHBOARD_GROUPS.map((key) => {
    const inGroup = kept.filter((row) => row.grp === key);
    const bySor = new Map();
    for (const row of inGroup) {
      const sor = bySor.get(row.opportunity_id) ?? {
        id: row.opportunity_id,
        salesReference: row.sales_reference,
        projectTitle: row.project_title,
        itemCount: 0,
        oldest: row.since,
        rows: [],
      };
      sor.itemCount += row.item_count;
      sor.rows.push(row);
      if (row.since && (!sor.oldest || row.since < sor.oldest)) sor.oldest = row.since;
      bySor.set(row.opportunity_id, sor);
    }
    const sors = [...bySor.values()].sort((a, b) => String(a.oldest).localeCompare(String(b.oldest)));
    for (const sor of sors) sor.rows.sort((a, b) => String(a.since).localeCompare(String(b.since)));
    return {
      key,
      label: DASHBOARD_GROUP_LABELS[key],
      itemCount: inGroup.reduce((sum, row) => sum + row.item_count, 0),
      sorCount: sors.length,
      sors,
    };
  });
  return { groups };
}

/** Everything one SOR has outstanding, every group it is in: "4 to source, 2 on order". */
export function sorSummary(rows, opportunityId) {
  return DASHBOARD_GROUPS.map((key) => {
    const count = rows.filter((row) => row.opportunity_id === opportunityId && row.grp === key).reduce((sum, row) => sum + row.item_count, 0);
    return count > 0 ? `${count} ${DASHBOARD_GROUP_LABELS[key].toLowerCase()}` : null;
  })
    .filter(Boolean)
    .join(", ");
}

/**
 * Where a row opens: the record that owns the work. A Purchase Request (or a
 * Canvass on one of its items) opens the request; a Canvass on a Component and
 * the Costing Matrix open the SOR, where the matrix lives; a Transmittal opens
 * itself.
 */
export function linkFor(row) {
  if (row.target_kind === "transmittal") return { to: `/purchasing/transmittals/${row.target_id}` };
  if (row.request_id) return { to: `/purchasing?request=${row.request_id}` };
  return { to: "/sors", state: { openOpportunityId: row.opportunity_id } };
}

/** What a row is called in its list. */
export function rowLabel(row) {
  switch (row.target_kind) {
    case "purchase_request":
      return row.target_label || "Purchase Request";
    case "canvass":
      return row.target_label ? `Canvass ${row.target_label}` : "Canvass";
    case "costing_matrix":
      return "Costing Matrix";
    case "transmittal":
      return row.target_label ? `Transmittal ${row.target_label}` : "Transmittal";
    default:
      return row.target_label ?? "";
  }
}
