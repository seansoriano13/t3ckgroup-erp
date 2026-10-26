/**
 * #695 — what each column of the product list says about a Requested Item (spec #675).
 * Plain functions over an item: no screen, no network. The list draws what they return.
 */

import { STOCK_BADGE } from "@/constants/stock";
import { ITEM_STATUS, stockWarning } from "@/constants/purchaseRequest";
import { REQUEST_PURPOSES } from "@/constants/procurement";
import { deliveryNote } from "./deliveryNote";
import { isFromS0, replacedNote, s0StillListsNote } from "./requestedItem";

/**
 * Odoo writes a product as "[M18C] Milwaukee Charger M18". The list shows the name, with the code
 * under it. A name with no leading [code] has none.
 */
export function splitProductName(name) {
  const match = /^\s*\[([^\]]+)\]\s*(.+)$/.exec(String(name ?? ""));
  return match ? { name: match[2].trim(), code: match[1].trim() } : { name: String(name ?? ""), code: null };
}

const STOCK_TONE = {
  [STOCK_BADGE.AVAILABLE]: "enough",
  [STOCK_BADGE.PARTIAL]: "some",
  [STOCK_BADGE.OUT_OF_STOCK]: "none-left",
};

/** The Stock column: the figure in words and a colour (green, amber, red, or grey when not read). */
export function stockCell(stock) {
  if (!stock) return { text: "Not read yet", tone: "none" };
  return { text: stock.figure, tone: STOCK_TONE[stock.badge?.kind] ?? "none" };
}

/** "For the client" / "Material for the job", or null when the request says nothing. */
export const purposeLabel = (item) => REQUEST_PURPOSES.find((p) => p.value === item?.purpose)?.label ?? null;

/** The P0 column: the number, or null for "—". */
export const p0Cell = (item) => item?.po_number || null;

/**
 * The Delivery and notes column, as `{ text, warn }` lines. Warnings are the ones somebody has to
 * act on. A Canvass note is drawn by the screen, which reads its offers.
 */
export function lineNotes(item, { replacedBy = null } = {}) {
  const notes = [];
  if (item.closed_note) notes.push({ text: item.closed_note });
  if (item.status === ITEM_STATUS.CANCELLED && replacedBy) notes.push({ text: replacedNote(item, replacedBy) });
  if (item.po_number && item.po_state === "rfq") notes.push({ text: `RFQ ${item.po_number}` });
  const delivery = deliveryNote(item);
  if (delivery) notes.push({ text: delivery });
  if (isFromS0(item) && item.removed_from_s0 === true) notes.push({ text: "Removed from S0", warn: true });
  const warning = stockWarning(item);
  if (warning) notes.push({ text: warning.label, warn: true });
  if (item.s0_still_lists === true) notes.push({ text: s0StillListsNote(item), warn: true });
  return notes;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "3 hours ago", "yesterday", "2 days ago"; a date once it is over a month old. */
export function ago(iso, now = Date.now()) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const age = Math.max(0, now - then);
  if (age < HOUR) return "just now";
  if (age < DAY) {
    const hours = Math.floor(age / HOUR);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const days = Math.floor(age / DAY);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * "Asked by Sales · 2 days ago" / "Added by Purchasing · 3 days ago". `side` is the requester's
 * side on the request; without it the requester's name stands in.
 */
export function askedByText(item, side, now = Date.now()) {
  const who =
    side === "purchasing"
      ? "Added by Purchasing"
      : `Asked by ${side === "sales" ? "Sales" : item.requester?.name || "someone"}`;
  const when = item.created_at ? ago(item.created_at, now) : null;
  return when ? `${who} · ${when}` : who;
}

/** The first attached picture of an item, for the thumbnail, or null. */
export const thumbnailOf = (item) => (item.images ?? []).find((f) => f?.type?.startsWith("image/")) ?? null;

/**
 * The Other request whose P0 moved onto this S0 line when Sales or Purchasing answered "Yes, same
 * product" (#688). The database closes that request with a note naming the line; it is the only
 * trace, since the pointer between the two is cleared.
 */
export const mergedRequestOf = (item, items) =>
  isFromS0(item) ? (items.find((i) => !isFromS0(i) && i.closed_note?.endsWith(`moved onto ${item.name}`)) ?? null) : null;
