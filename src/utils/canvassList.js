import { CANVASS_KIND } from "../constants/canvass";

/** The Canvasses page filters (ADR 0034, #566); "all" on a select means no filter. */
export const ANY = "all";
export const SIGNED_FILTER = { SIGNED: "signed", UNSIGNED: "unsigned" };
export const WINNER_FILTER = { YES: "yes", NO: "no" };
export const LINKED_FILTER = { LINKED: "linked", FREE: "free" };

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

/** Rows that pass the filter bar: search, Canvasser, signed, has a winner, linked or not. */
export function filterCanvasses(rows, { search = "", canvasserId = ANY, signed = ANY, winner = ANY, linked = ANY } = {}) {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (canvasserId !== ANY && row.canvasserId !== canvasserId) return false;
    if (signed !== ANY && Boolean(row.signedOffAt) !== (signed === SIGNED_FILTER.SIGNED)) return false;
    if (winner !== ANY && Boolean(row.winner) !== (winner === WINNER_FILTER.YES)) return false;
    if (linked !== ANY && (row.kind !== CANVASS_KIND.NONE) !== (linked === LINKED_FILTER.LINKED)) return false;
    if (!needle) return true;
    const haystack = [row.number, canvassSubjectLabel(row), row.canvasserName, row.winner?.supplierName, row.winner?.brand, row.projectTitle]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}
