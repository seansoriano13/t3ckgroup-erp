/**
 * The Purchasing Dashboard (#322): every project's buying grouped by what is
 * outstanding. The rows come from `purchasing_dashboard_rows()`, one per record
 * that owns a piece of work; this file only groups and filters them. The groups
 * are derived, never stored, and one SOR sits in as many as apply (ADR 0023).
 */

export const DASHBOARD_GROUP = {
  NOT_CHECKED: "not_checked",
  TO_PURCHASE: "to_purchase",
  STILL_CANVASSING: "still_canvassing",
  PURCHASED: "purchased",
};

export const DASHBOARD_GROUPS = Object.values(DASHBOARD_GROUP);

export const DASHBOARD_GROUP_LABELS = {
  [DASHBOARD_GROUP.NOT_CHECKED]: "Not checked",
  [DASHBOARD_GROUP.TO_PURCHASE]: "To purchase",
  [DASHBOARD_GROUP.STILL_CANVASSING]: "Still canvassing",
  [DASHBOARD_GROUP.PURCHASED]: "Purchased (not received)",
};

export const DASHBOARD_GROUP_HINTS = {
  [DASHBOARD_GROUP.NOT_CHECKED]: "Product lines nobody has looked at yet.",
  [DASHBOARD_GROUP.TO_PURCHASE]: "Product lines that need buying, with no confirmed P0 yet.",
  [DASHBOARD_GROUP.STILL_CANVASSING]: "Product lines with supplier offers being collected, and Components still waiting on an Acquire price or a Bid Decision.",
  [DASHBOARD_GROUP.PURCHASED]: "Confirmed on a P0 and not all here yet, with the delivery note, by IPAS where the P0 has one.",
};

const DAY = 86_400_000;

/** Whole days from `since` to `today`, never negative. */
export const ageDays = (since, today = new Date()) =>
  since ? Math.max(0, Math.floor((today.getTime() - new Date(since).getTime()) / DAY)) : 0;

/** Ageing filter value: late by Order Monitoring's ageing rules (#262). */
export const LATE_BY_RULES = "late";

/**
 * Who a row belongs to in the lists: its SOR, or for a Direct request (no SOR)
 * the request itself.
 */
export const ownerKey = (row) => row.opportunity_id ?? `request:${row.request_id}`;

/**
 * Narrow the rows by the filters, every one optional and all of them together:
 * `sor` (S number or project title, any case), `buyerId`, `canvasserId`,
 * `minAgeDays`, `lateIpasIds` (a Set: keeps only IPAS rows Order Monitoring
 * marks late by its ageing rules), and `noCanvass`, which keeps only items
 * purchased with no canvass and counts only those.
 */
export function filterRows(
  rows,
  { sor = "", buyerId = null, canvasserId = null, minAgeDays = null, lateIpasIds = null, noCanvass = false } = {},
  today = new Date(),
) {
  const needle = String(sor ?? "").trim().toLowerCase();
  return rows
    .filter((row) => !needle || [row.sales_reference, row.project_title].some((value) => String(value ?? "").toLowerCase().includes(needle)))
    .filter((row) => !buyerId || row.buyer_id === buyerId)
    .filter((row) => !canvasserId || row.canvasser_id === canvasserId)
    .filter((row) => !minAgeDays || ageDays(row.since, today) >= minAgeDays)
    .filter((row) => !lateIpasIds || (row.target_kind === "ipas" && lateIpasIds.has(row.target_id)))
    .filter((row) => !noCanvass || row.no_canvass_count > 0)
    .map((row) => (noCanvass ? { ...row, item_count: row.no_canvass_count } : row));
}

/**
 * The four groups, always in order and always present, each with its item
 * count, how many SORs it spans, and per SOR its item count and the rows
 * (records) that hold the work, oldest first.
 */
export function dashboardView(rows, filters = {}, today = new Date()) {
  const kept = filterRows(rows ?? [], filters, today);
  const groups = DASHBOARD_GROUPS.map((key) => {
    const inGroup = kept.filter((row) => row.grp === key);
    const bySor = new Map();
    for (const row of inGroup) {
      const key = ownerKey(row);
      const sor = bySor.get(key) ?? {
        id: key,
        direct: !row.opportunity_id,
        salesReference: row.sales_reference,
        projectTitle: row.project_title,
        itemCount: 0,
        oldest: row.since,
        rows: [],
      };
      sor.itemCount += row.item_count;
      sor.rows.push(row);
      if (row.since && (!sor.oldest || row.since < sor.oldest)) sor.oldest = row.since;
      bySor.set(key, sor);
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

/** Everything one SOR (or Direct request, by `ownerKey`) has outstanding, every group it is in: "4 not checked, 2 purchased (not received)". */
export function sorSummary(rows, owner) {
  return DASHBOARD_GROUPS.map((key) => {
    const count = rows.filter((row) => ownerKey(row) === owner && row.grp === key).reduce((sum, row) => sum + row.item_count, 0);
    return count > 0 ? `${count} ${DASHBOARD_GROUP_LABELS[key].toLowerCase()}` : null;
  })
    .filter(Boolean)
    .join(", ");
}

/**
 * Where a row opens: the record that owns the work. A Purchase Request (or a
 * Canvass on one of its items) opens the request; a Canvass on a Component and
 * the Costing Matrix open the SOR, where the matrix lives; an IPAS and a
 * Transmittal open themselves.
 */
export function linkFor(row) {
  if (row.target_kind === "transmittal") return { to: `/purchasing/transmittals/${row.target_id}` };
  if (row.target_kind === "ipas") return { to: `/purchasing/ipas/${row.target_id}` };
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
    case "ipas":
      return row.target_label ? `IPAS ${row.target_label}` : "IPAS";
    case "transmittal":
      return row.target_label ? `Transmittal ${row.target_label}` : "Transmittal";
    default:
      return row.target_label ?? "";
  }
}
