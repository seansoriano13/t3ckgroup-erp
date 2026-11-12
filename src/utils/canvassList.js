import { CANVASS_KIND } from "../constants/canvass";
import { ITEM_STATUS_LABELS, ITEM_STATUS_THEME } from "../constants/purchaseRequest";
import { STATUS_THEME } from "../constants/status";

/**
 * The Canvasses page (#973, spec #956): one row per Canvass, which is one per Purchase Request.
 * Every function here is pure, so the list, its filters and its export agree.
 */

/** "all" on a select means no filter. */
export const ANY = "all";

/** The Canvass needs this many suppliers, or a "No other supplier" note, before a winner (#969). */
export const SUPPLIERS_NEEDED = 3;

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
  if ((row.supplierCount ?? 0) < SUPPLIERS_NEEDED && !row.noOtherSupplier) key = CANVASS_STATUS.NEEDS_SUPPLIERS;
  else if ((row.openWinnerCount ?? 0) < (row.openLineCount ?? 0)) key = CANVASS_STATUS.NEEDS_WINNERS;
  else key = CANVASS_STATUS.WINNERS_PICKED;
  return { key, state: key, label: CANVASS_STATUS_LABELS[key] };
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
    row.updatedAt ?? row.createdAt ?? null,
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

// ---------------------------------------------------------------------------------------------
// Still read by the old per-line CanvassPanel and CanvassRequestBadge, which #970 replaces with the
// request's grid. Remove with them.
// ---------------------------------------------------------------------------------------------

/**
 * Whether a Purchase Request still has to be made from a Canvass, for the list column and the panel
 * strip: "Needs winner", "Ready to request", or the status of the request's item ("Not checked",
 * "Cancelled"); the request's own name rides along as `requestLabel` for a tooltip. A Canvass on a Component has no request in its flow, so it has no state (null).
 * `theme` is a StatusBadge theme.
 */
export function canvassRequestState({ kind, winner, requestId, requestLabel, requestItemStatus } = {}) {
  if (requestId) {
    const status = ITEM_STATUS_LABELS[requestItemStatus];
    return {
      key: "created",
      label: status || requestLabel || "Purchase Request",
      requestLabel: requestLabel || "Purchase Request",
      requestId,
      theme: ITEM_STATUS_THEME[requestItemStatus] || STATUS_THEME.MAUVE,
    };
  }
  if (kind !== CANVASS_KIND.NONE) return null;
  return winner
    ? { key: "ready", label: "Ready to request", requestId: null, theme: STATUS_THEME.BLUE }
    : { key: "needs_winner", label: "Needs winner", requestId: null, theme: STATUS_THEME.MAUVE };
}

/** A Canvass's own state for the State badge: Signed off (old history), Requested (a Purchase Request was made), Winner picked, or Open. */
export const CANVASS_ROW_STATE = { OPEN: "open", WON: "won", REQUESTED: "requested", SIGNED: "signed" };

/** State -> StatusBadge tone, the one place this list maps them. A made request shows its item's status, so those tones ride along. */
export const CANVASS_STATE_TONES = {
  ...ITEM_STATUS_THEME,
  [CANVASS_ROW_STATE.OPEN]: "amber",
  [CANVASS_ROW_STATE.REQUESTED]: "blue",
  [CANVASS_ROW_STATE.WON]: "green",
  [CANVASS_ROW_STATE.SIGNED]: "mauve",
};

/**
 * `{ state, label }` for a StateCell. Open means no winner yet. Once a request was made it is the
 * live status of the request's item ("Still canvassing", "Purchased", "Cancelled"); "Requested" is
 * only the fallback when that status is not known.
 */
export function canvassStateOf(row) {
  if (row.signedOffAt) return { state: CANVASS_ROW_STATE.SIGNED, label: "Signed off" };
  if (row.requestId) {
    const label = ITEM_STATUS_LABELS[row.requestItemStatus];
    if (label) return { state: row.requestItemStatus, label };
    return { state: CANVASS_ROW_STATE.REQUESTED, label: "Requested" };
  }
  if (row.winner) return { state: CANVASS_ROW_STATE.WON, label: "Winner picked" };
  return { state: CANVASS_ROW_STATE.OPEN, label: "Open" };
}

