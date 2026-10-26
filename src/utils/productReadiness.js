/**
 * #680 — the ready bar and the fold rule of a Purchase Request's product list.
 * Computed from the items on screen, never stored.
 */

import { ITEM_STATUS } from "@/constants/purchaseRequest";

const FINISHED = [ITEM_STATUS.AVAILABLE, ITEM_STATUS.RECEIVED, ITEM_STATUS.CANCELLED];

/**
 * Warnings someone must act on: "Now 1 free of 4", "S0 still lists A", "Is this yours?".
 * They arrive in later tickets; each one only has to set its flag on the item.
 * "Removed from S0" is not here on purpose: it never holds a finished line open.
 */
export const NEEDS_LOOK_FLAGS = ["now_free", "s0_still_lists", "new_on_s0"];

export const isDone = (item) => FINISHED.includes(item?.status);
export const needsLook = (item) => NEEDS_LOOK_FLAGS.some((flag) => Boolean(item?.[flag]));
/** A finished line folds away unless it carries a warning someone must act on. */
export const isFolded = (item) => isDone(item) && !needsLook(item);

/** Counts, bar segments and the plain sentence. Cancelled lines are left out of the total. */
export function summarize(items) {
  const live = (items || []).filter((i) => i.status !== ITEM_STATUS.CANCELLED);
  const pick = (...statuses) => live.filter((i) => statuses.includes(i.status));
  const ready = pick(ITEM_STATUS.AVAILABLE, ITEM_STATUS.RECEIVED);
  const purchased = pick(ITEM_STATUS.PURCHASED);
  const sourcing = pick(ITEM_STATUS.TO_PURCHASE, ITEM_STATUS.STILL_CANVASSING);
  const notChecked = pick(ITEM_STATUS.NOT_CHECKED);
  const cannot = pick(ITEM_STATUS.CANNOT_SOURCE);

  const parts = [`${ready.length} ${ready.length === 1 ? "is" : "are"} in the warehouse.`];
  const need = sourcing.length + purchased.length;
  if (need > 0) {
    const bits = [];
    if (sourcing.length) bits.push(`${sourcing.length} still ${sourcing.length === 1 ? "needs" : "need"} a supplier`);
    if (purchased.length === 1) bits.push(`1 is on ${purchased[0].po_number || "a P0"} and not here yet`);
    else if (purchased.length > 1) bits.push(`${purchased.length} are on a P0 and not here yet`);
    parts.push(`${need} ${need === 1 ? "needs" : "need"} buying: ${bits.join(", ")}.`);
  }
  if (notChecked.length) parts.push(`${notChecked.length} ${notChecked.length === 1 ? "has" : "have"} not been checked yet.`);
  if (cannot.length) parts.push(`${cannot.length} cannot be sourced.`);

  return {
    total: live.length,
    ready: ready.length,
    segments: [
      { key: "ready", label: "Available or Received", count: ready.length, bar: "bg-green-9" },
      { key: "purchased", label: "Purchased, not received yet", count: purchased.length, bar: "bg-blue-9" },
      { key: "sourcing", label: "To purchase or Still canvassing", count: sourcing.length, bar: "bg-amber-9" },
      { key: "unchecked", label: "Not checked", count: notChecked.length, bar: "bg-mauve-7" },
      { key: "cannot", label: "Cannot source", count: cannot.length, bar: "bg-red-9" },
    ],
    sentence: parts.join(" "),
  };
}
