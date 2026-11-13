import { MIN_CANVASS_OFFERS } from "../constants/canvass";

/**
 * The Canvasses page (#973, spec #956): one row per Canvass, which is one per Purchase Request.
 * Every function here is pure, so the list, its filters and its export agree.
 */

/** "all" on a select means no filter. */
export const ANY = "all";


export const CANVASS_STATUS = {
  NEEDS_SUPPLIERS: "needs_suppliers",
  NEEDS_WINNERS: "needs_winners",
  WINNERS_PICKED: "winners_picked",
};

export const CANVASS_STATUS_LABELS = {
  [CANVASS_STATUS.NEEDS_SUPPLIERS]: "Needs suppliers",
  [CANVASS_STATUS.NEEDS_WINNERS]: "Needs winners",
  [CANVASS_STATUS.WINNERS_PICKED]: "Winners picked",
};

/** Status -> StatusBadge tone, the one place this list maps them. */
export const CANVASS_STATUS_TONES = {
  [CANVASS_STATUS.NEEDS_SUPPLIERS]: "amber",
  [CANVASS_STATUS.NEEDS_WINNERS]: "blue",
  [CANVASS_STATUS.WINNERS_PICKED]: "green",
};

/**
 * The one status a row shows: "Needs suppliers" (fewer than three and no note), "Needs winners",
 * or "Winners picked" (every open line has one; a locked line is no longer open).
 */
export function canvassStatusOf(row) {
  let key;
  if ((row.supplierCount ?? 0) < MIN_CANVASS_OFFERS && !row.noOtherSupplier) key = CANVASS_STATUS.NEEDS_SUPPLIERS;
  else if ((row.openWinnerCount ?? 0) < (row.openLineCount ?? 0)) key = CANVASS_STATUS.NEEDS_WINNERS;
  else key = CANVASS_STATUS.WINNERS_PICKED;
  return { key, state: key, label: CANVASS_STATUS_LABELS[key] };
}

/** When the Canvass last changed, for the column, its sort and the export. */
export function canvassChangedAt(row) {
  return row.updatedAt ?? row.createdAt ?? null;
}

/** The lock shows when every line of the request is locked. */
export function canvassLocked(row) {
  return (row.lineCount ?? 0) > 0 && (row.lockedLineCount ?? 0) >= row.lineCount;
}

/** The project the request is for ("S07983 · Hospital beds"), or "Direct request". */
export function canvassProjectLabel(row) {
  const project = [row.salesReference, row.projectTitle].filter(Boolean).join(" · ");
  return project || "Direct request";
}

/** How many lines have a winner out of all lines: "1 of 3". */
export function canvassWinnersLabel(row) {
  return `${row.winnerCount ?? 0} of ${row.lineCount ?? 0}`;
}

/**
 * Where a request's Canvass opens: the Purchase Request's own window with its Canvass grid open
 * (#970), at one line when `itemId` is given. The Canvasses page and the S0 Evaluation both link here,
 * so there is one grid and one address for it.
 */
export function canvassHref({ requestId, itemId = null }) {
  const params = new URLSearchParams({ request: requestId, canvass: "1" });
  if (itemId) params.set("line", itemId);
  return `/purchasing?${params.toString()}`;
}

export const CANVASS_EXPORT_HEADER = ["Canvass", "Request", "Project", "Canvasser", "Suppliers", "Winners", "Status", "Last changed"];

/** The rows shown, in the order shown, as the sheet's cells. */
export function canvassExportRows(rows) {
  return rows.map((row) => [
    row.number,
    row.requestLabel ?? null,
    canvassProjectLabel(row),
    row.canvasserName ?? null,
    row.supplierCount ?? 0,
    canvassWinnersLabel(row),
    canvassStatusOf(row).label,
    canvassChangedAt(row),
  ]);
}

/** Rows that pass the filter bar: search (number, request, supplier, product), Canvasser, status. */
export function filterCanvasses(rows, { search = "", canvasserId = ANY, status = ANY } = {}) {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (canvasserId !== ANY && row.canvasserId !== canvasserId) return false;
    if (status !== ANY && canvassStatusOf(row).key !== status) return false;
    if (!needle) return true;
    const haystack = [row.number, row.requestLabel, row.projectTitle, row.salesReference, ...(row.supplierNames || []), ...(row.productNames || [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}
