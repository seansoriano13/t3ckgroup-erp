/**
 * Requested Items (issue #305, part of #209) — what an item says about its
 * product's stock, and which section of the list it belongs to (#678).
 *
 * An item for an S0 line is kept in step with the line by the database, so
 * there is no "SOR changed" to read. The Costing Matrix's Tender Lines still
 * compare themselves with their SOR line (`sorLineChange`).
 */

import { STOCK_BADGE, isStockStale, stockBadge } from "@/constants/stock";
import { ITEM_STATUS } from "@/constants/purchaseRequest";

export const ITEM_SOURCE = {
  SOR_LINE: "sor_line",
  NEW: "new",
  /** Added from a Costing Matrix Component (#273); it names the Component it buys for. */
  COMPONENT: "component",
};

/** Where a Requested Item came from, in words. */
export const ITEM_SOURCE_LABEL = {
  [ITEM_SOURCE.SOR_LINE]: "From the SOR",
  [ITEM_SOURCE.NEW]: "New product",
  [ITEM_SOURCE.COMPONENT]: "From the S0 Evaluation",
};

/**
 * #678 — whether an item is for an S0 line ("From the S0"). Any item with no SOR line is an
 * Other request. The SOR line's fixed id is the only test: an item whose line was deleted
 * (a hand-typed line) has none and is an Other request from then on.
 */
export const isFromS0 = (item) => Boolean(item?.sor_item_id);

/**
 * #684 — what a P0's Source Document names for this request: the S0 of a Project request, or
 * the PR number of a Direct request (even one made for a project, which stays Direct).
 */
export const p0Reference = (request) => (request?.opportunity_id ? request.sales_reference : request?.pr_number) || null;

/** The section an item sits in, in the screen's words. */
export const itemSectionLabel = (item) => (isFromS0(item) ? "From the S0" : "Other request");

/**
 * #807 — an open item (not Cancelled) that has no Odoo product: a typed S0 product or an Other
 * request. Derived from the item's status and product id, never stored.
 */
export const isOpenWithoutOdooProduct = (item) => item?.status !== ITEM_STATUS.CANCELLED && !item?.odoo_product_id;

/** "1.2 · Rescue tripod": the Component a Requested Item buys for, or null when it names none (or it was removed). */
export const componentLabel = (item) => (item?.component ? `${item.component.number} · ${item.component.name}` : null);

export const SOR_LINE_CHANGE = {
  CHANGED: "changed",
  REMOVED: "removed",
};

const sameUnit = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();

/** "10 pc", "2.5 m", "3" — a quantity as the Product List shows it. */
export const formatAmount = (quantity, unit) => {
  const n = Number(quantity);
  const amount = Number.isFinite(n) ? String(n) : String(quantity ?? "");
  return unit ? `${amount} ${unit}` : amount;
};

/**
 * How the SOR line an item was picked from differs now, or null when it
 * still says what was picked (or the item didn't come from a line).
 *
 * `item.sorLine` is the line as the SOR says it now, from
 * `purchase_request_item_lines`: `{ found, quantity, unit }`. A change someone
 * kept as asked (`item.sor_change_seen`) stays quiet while the line is unchanged
 * since; a removed line is always said. Left undefined
 * when it hasn't been read, which says nothing rather than "removed".
 */
export function sorLineChange(item) {
  if (item?.source !== ITEM_SOURCE.SOR_LINE || !item.sor_line_snapshot || !item.sorLine) return null;

  const { sorLine, sor_line_snapshot: picked } = item;
  if (!sorLine.found) {
    return { kind: SOR_LINE_CHANGE.REMOVED, label: "SOR line removed" };
  }

  const quantity = Number(sorLine.quantity);
  const quantityChanged = quantity !== Number(picked.quantity);
  const unitChanged = !sameUnit(sorLine.unit, picked.unit);
  if (!quantityChanged && !unitChanged) return null;

  // Someone chose "Keep as asked" against this very reading: quiet until the SOR says something else.
  const seen = item.sor_change_seen;
  if (seen && quantity === Number(seen.quantity) && sameUnit(sorLine.unit, seen.unit)) return null;

  return {
    kind: SOR_LINE_CHANGE.CHANGED,
    quantity,
    unit: sorLine.unit || null,
    asked: { quantity: Number(picked.quantity), unit: picked.unit || null },
    quantityChanged,
    unitChanged,
    label: `SOR line now says ${formatAmount(quantity, sorLine.unit)}`,
  };
}

/**
 * #681 — a line's Stock Availability in words: "4 free, enough", "1 free of 4", "0 free", "Not read yet".
 * Judged on free stock, as the badge is. A product Odoo does not track, or a line with no Odoo product,
 * has no figure to give and says so.
 */
export function stockFigure(badge, quantity) {
  switch (badge.kind) {
    case STOCK_BADGE.AVAILABLE:
      return `${badge.free} free, enough`;
    case STOCK_BADGE.PARTIAL:
      return `${badge.free} free of ${Number(quantity) || 0}`;
    case STOCK_BADGE.OUT_OF_STOCK:
      return "0 free";
    case STOCK_BADGE.NOT_TRACKED:
      return "Not tracked";
    case STOCK_BADGE.NOT_LINKED:
      return "Not linked to Odoo";
    default:
      return "Not read yet";
  }
}

/**
 * The item's product stock, judged on the SOR's stock snapshot (#202) against
 * the quantity requested, with the time it was read and whether that reading
 * is stale (#501). Null for a new product: there is nothing in Odoo to look up.
 *
 * `stockSnapshot` is the SOR's `sor_stock_snapshots` row ({ data, fetched_at }),
 * as `purchaseRequestService.stockSnapshot` reads it — the picker's source.
 */
export function requestedItemStock(item, stockSnapshot, now = Date.now()) {
  if (!item || item.source === ITEM_SOURCE.NEW) return null;
  const product = item.odoo_product_id ? stockSnapshot?.data?.products?.[item.odoo_product_id] || null : null;
  const fetchedAt = product ? stockSnapshot?.fetched_at ?? null : null;
  const badge = stockBadge({ quantity: item.quantity, product, odooProductId: item.odoo_product_id });
  return {
    badge,
    figure: stockFigure(badge, item.quantity),
    fetchedAt,
    stale: isStockStale(fetchedAt, now),
  };
}

/**
 * #803 — the "Now x free of y" a choice of Available would show, or null. Judged on the SOR's
 * latest stock check the way the database judges it (purchase_request_set_item_status): a stock
 * check for the item's Odoo product, type "product", with less free than the item needs. No
 * check, no product or enough stock: null, and Available needs no reason.
 */
export function shortStockOf(item, stockSnapshot) {
  if (!item?.odoo_product_id) return null;
  const product = stockSnapshot?.data?.products?.[item.odoo_product_id];
  if (product?.type !== "product") return null;
  const free = Number(product.free ?? 0);
  const needed = Number(item.quantity);
  return free < needed ? { free, needed } : null;
}

/**
 * Issue #312 — whether an item bought on a PO still lacks its Odoo PO line:
 * Ordered (or since Received) with a PO number and no line picked. A line is
 * never guessed; Purchasing picks it from the PO's IPAS stored Odoo copy once
 * that exists.
 */
export function poLineNotPicked(item) {
  if (!item?.po_number) return false;
  if (item.status !== ITEM_STATUS.PURCHASED && item.status !== ITEM_STATUS.RECEIVED) return false;
  return !(item.odoo_po_line_ids?.length > 0);
}

/**
 * #726 — "n of m received": a Purchased item whose Odoo receipts cover part of it. Null when nothing
 * has arrived, when it is fully covered (it moves to Received by itself), or before Purchased.
 */
export function partialReceiptText(item) {
  if (item?.status !== ITEM_STATUS.PURCHASED) return null;
  const got = Number(item.odoo_received_qty);
  const of = Number(item.quantity);
  if (!(got > 0) || !(of > 0) || got >= of) return null;
  return `${got} of ${of} received`;
}

/** #687 — "Replaced by B — reason", the note on a line Purchasing replaced. */
export function replacedNote(item, replacedBy) {
  const by = replacedBy?.name ? `Replaced by ${replacedBy.name}` : "Replaced";
  return item?.replaced_reason ? `${by} — ${item.replaced_reason}` : by;
}

/** #687 — the warning on a replaced S0 line while the S0 still lists it. */
export function s0StillListsNote(item) {
  return `S0 still lists ${item?.name ?? "this product"} · Sales to update the S0`;
}
