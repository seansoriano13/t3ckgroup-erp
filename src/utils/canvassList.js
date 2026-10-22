import { CANVASS_KIND } from "../constants/canvass";
import { ITEM_STATUS_LABELS, ITEM_STATUS_THEME } from "../constants/purchaseRequest";
import { STATUS_THEME } from "../constants/status";

/** The Canvasses page filters (ADR 0034, #566); "all" on a select means no filter. */
export const ANY = "all";
export const SIGNED_FILTER = { SIGNED: "signed", UNSIGNED: "unsigned" };
export const WINNER_FILTER = { YES: "yes", NO: "no" };
export const LINKED_FILTER = { LINKED: "linked", FREE: "free" };
export const REQUEST_FILTER = { NOT_YET: "not_yet", CREATED: "created" };

/**
 * Whether a Purchase Request still has to be made from a Canvass, for the list column and the panel
 * strip: "Needs winner", "Ready to request", or "PR-12 · Cancelled" (the request and its item's
 * status). A Canvass on a Component has no request in its flow, so it has no state (null).
 * `theme` is a StatusBadge theme.
 */
export function canvassRequestState({ kind, winner, requestId, requestLabel, requestItemStatus } = {}) {
  if (requestId) {
    const status = ITEM_STATUS_LABELS[requestItemStatus];
    return {
      key: "created",
      label: [requestLabel || "Purchase Request", status].filter(Boolean).join(" · "),
      requestId,
      theme: ITEM_STATUS_THEME[requestItemStatus] || STATUS_THEME.MAUVE,
    };
  }
  if (kind !== CANVASS_KIND.NONE) return null;
  return winner
    ? { key: "ready", label: "Ready to request", requestId: null, theme: STATUS_THEME.BLUE }
    : { key: "needs_winner", label: "Needs winner", requestId: null, theme: STATUS_THEME.MAUVE };
}

/** The Canvasses page address: ?canvass=<id>, or ?item= / ?component= for one found by its subject. */
export function canvassAddressParams(params) {
  return { canvass: params.get("canvass"), item: params.get("item"), component: params.get("component") };
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

/** Rows that pass the filter bar: search, Canvasser, signed, has a winner, linked or not, request made or not. */
export function filterCanvasses(rows, { search = "", canvasserId = ANY, signed = ANY, winner = ANY, linked = ANY, request = ANY } = {}) {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (canvasserId !== ANY && row.canvasserId !== canvasserId) return false;
    if (signed !== ANY && Boolean(row.signedOffAt) !== (signed === SIGNED_FILTER.SIGNED)) return false;
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
