/**
 * Requested Items (issue #305, part of #209) — what an item says about its
 * product's stock, and which section of the list it belongs to (#678).
 *
 * An item for an S0 line is kept in step with the line by the database, so
 * there is no "SOR changed" to read. The Costing Matrix's Tender Lines still
 * compare themselves with their SOR line (`sorLineChange`).
 */

import { isStockStale, stockBadge } from "@/constants/stock";
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
  [ITEM_SOURCE.COMPONENT]: "From the Costing Matrix",
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
  return {
    badge: stockBadge({ quantity: item.quantity, product, odooProductId: item.odoo_product_id }),
    fetchedAt,
    stale: isStockStale(fetchedAt, now),
  };
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
