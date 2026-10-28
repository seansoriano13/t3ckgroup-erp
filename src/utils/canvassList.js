import { CANVASS_KIND } from "../constants/canvass";
import { ITEM_STATUS_LABELS, ITEM_STATUS_THEME } from "../constants/purchaseRequest";
import { STATUS_THEME } from "../constants/status";

/** The Canvasses page filters (ADR 0034, #566); "all" on a select means no filter. */
export const ANY = "all";
export const WINNER_FILTER = { YES: "yes", NO: "no" };
export const LINKED_FILTER = { LINKED: "linked", FREE: "free" };
export const REQUEST_FILTER = { NOT_YET: "not_yet", CREATED: "created" };

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

/** What the row says it is for: "S07983 · 1.2 Stretcher", "Gloves (PR-12)", or the product alone. */
export function canvassSubjectLabel(row) {
  if (row.kind === CANVASS_KIND.COMPONENT) {
    return [row.salesReference, [row.componentNumber, row.subjectName].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  }
  if (row.kind === CANVASS_KIND.REQUESTED_ITEM) {
    return [row.subjectName, row.requestLabel ? `(${row.requestLabel})` : null].filter(Boolean).join(" ");
  }
  return row.productName || row.subjectName || "";
}

/**
 * The State pills (#728, ADR 0047): Open is a Canvass with no winner yet; Winner picked has one. Signed off
 * is history, kept on old records only.
 */
export const CANVASS_STATE = { OPEN: "open", WON: "won", SIGNED: "signed", ALL: "all" };

/** A Canvass's own state for the State badge: Signed off (old history), Requested (a Purchase Request was made), Winner picked, or Open. */
export const CANVASS_ROW_STATE = { OPEN: "open", WON: "won", REQUESTED: "requested", SIGNED: "signed" };

/** State -> StatusBadge tone, the one place this list maps them. */
export const CANVASS_STATE_TONES = {
  [CANVASS_ROW_STATE.OPEN]: "amber",
  [CANVASS_ROW_STATE.REQUESTED]: "blue",
  [CANVASS_ROW_STATE.WON]: "green",
  [CANVASS_ROW_STATE.SIGNED]: "mauve",
};

/** `{ state, label }` for a StateCell. Open means no winner yet. */
export function canvassStateOf(row) {
  if (row.signedOffAt) return { state: CANVASS_ROW_STATE.SIGNED, label: "Signed off" };
  if (row.requestId) return { state: CANVASS_ROW_STATE.REQUESTED, label: "Requested" };
  if (row.winner) return { state: CANVASS_ROW_STATE.WON, label: "Winner picked" };
  return { state: CANVASS_ROW_STATE.OPEN, label: "Open" };
}

/** The winner as the list says it: "Supplier · Brand", "Picked", or "No winner". */
export function canvassWinnerLabel(row) {
  if (!row.winner) return "No winner";
  return [row.winner.supplierName, row.winner.brand].filter(Boolean).join(" · ") || "Picked";
}

export const CANVASS_EXPORT_HEADER = ["Canvass", "Subject", "Canvasser", "Winner", "Offers", "Request", "Signed off by", "State"];

/** The rows shown, in the order shown, as the sheet's cells. */
export function canvassExportRows(rows) {
  return rows.map((row) => [
    row.number,
    canvassSubjectLabel(row) || null,
    row.canvasserName ?? null,
    canvassWinnerLabel(row),
    row.offerCount ?? 0,
    canvassRequestState(row)?.label ?? null,
    row.signerName ?? null,
    canvassStateOf(row).label,
  ]);
}

/** Whether a row is in a State pill: Open (no winner yet), Winner picked, or Signed off (old history). */
function matchesState(row, state) {
  const signed = Boolean(row.signedOffAt);
  if (state === CANVASS_STATE.SIGNED) return signed;
  if (state === CANVASS_STATE.WON) return !signed && Boolean(row.winner);
  return !signed && !row.winner;
}

/** Rows that pass the filter bar: search, Canvasser, state pill, has a winner, linked or not, request made or not. */
export function filterCanvasses(rows, { search = "", canvasserId = ANY, state = ANY, winner = ANY, linked = ANY, request = ANY } = {}) {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (canvasserId !== ANY && row.canvasserId !== canvasserId) return false;
    if (state !== ANY && !matchesState(row, state)) return false;
    if (winner !== ANY && Boolean(row.winner) !== (winner === WINNER_FILTER.YES)) return false;
    if (linked !== ANY && (row.kind !== CANVASS_KIND.NONE) !== (linked === LINKED_FILTER.LINKED)) return false;
    if (request !== ANY) {
      const key = canvassRequestState(row)?.key;
      // "Not yet" is a Canvass that could still start a request; a Component Canvass has none either way.
      const wanted = request === REQUEST_FILTER.CREATED ? key === "created" : key === "needs_winner" || key === "ready";
      if (!wanted) return false;
    }
    if (!needle) return true;
    const haystack = [row.number, canvassSubjectLabel(row), row.canvasserName, row.winner?.supplierName, row.winner?.brand, row.projectTitle]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}
