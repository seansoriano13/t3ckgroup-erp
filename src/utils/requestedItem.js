/**
 * Requested Items (issue #305, part of #209) — what an item says about the
 * SOR line it was picked from, and about its product's stock.
 *
 * Both are read beside the item, never stored on it: the item keeps only what
 * was picked (`sor_line_snapshot`), so a later SOR edit can't rewrite it.
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

/** "1.2 · Rescue tripod": the Component a Requested Item buys for, or null when it names none (or it was removed). */
export const componentLabel = (item) => (item?.component ? `${item.component.number} · ${item.component.name}` : null);

/**
 * The Components of a matrix as a flat pick list for "Add from the Costing Matrix" (#273), in grid
 * order: `{ id, number, name, quantity, unit, forOrder, bundle, requested }`. `forOrder` is the
 * default pick (availability For Order); `requested` counts the request's items that already name
 * the Component (`items`). A Component with no name can't be requested and is left out.
 */
export function componentPickList(tenderLines, items = []) {
  const requested = new Map();
  for (const item of items) {
    if (item.component_id) requested.set(item.component_id, (requested.get(item.component_id) ?? 0) + 1);
  }
  return (tenderLines ?? [])
    .flatMap((line) => line.components ?? [])
    .filter((component) => (component.name ?? "").trim() !== "")
    .map((component) => ({
      id: component.id,
      number: component.number,
      name: component.name.trim(),
      quantity: component.quantity,
      unit: component.unit ?? null,
      forOrder: component.availability === "for_order",
      bundle: Boolean(component.is_bundle),
      requested: requested.get(component.id) ?? 0,
    }));
}

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
 * `purchase_request_item_lines`: `{ found, quantity, unit }`. Left undefined
 * when it hasn't been read, which says nothing rather than "removed".
 */
export function sorLineChange(item) {
  if (item?.source !== ITEM_SOURCE.SOR_LINE || !item.sor_line_snapshot || !item.sorLine) return null;

  const { sorLine, sor_line_snapshot: picked } = item;
  if (!sorLine.found) {
    return { kind: SOR_LINE_CHANGE.REMOVED, label: "SOR line removed" };
  }

  const quantity = Number(sorLine.quantity);
  if (quantity === Number(picked.quantity) && sameUnit(sorLine.unit, picked.unit)) return null;

  return {
    kind: SOR_LINE_CHANGE.CHANGED,
    quantity,
    unit: sorLine.unit || null,
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

const sameProduct = (line, item) =>
  item.odoo_product_id != null
    ? line.odoo_product_id === item.odoo_product_id
    : (line.product_name || "").trim().toLowerCase() === (item.sor_line_snapshot?.name || item.name || "").trim().toLowerCase();

/**
 * Whether a Product List line already has a live item on the request, so the
 * picker can say so. Matched the way `purchase_request_item_lines` matches:
 * by Odoo product, else by name. A cancelled item doesn't count.
 */
export function isLineRequested(line, items = []) {
  return items.some(
    (item) => item.source === ITEM_SOURCE.SOR_LINE && item.status !== ITEM_STATUS.CANCELLED && sameProduct(line, item),
  );
}

/**
 * Issue #312 — whether an item bought on a PO still lacks its Odoo PO line:
 * Ordered (or since Received) with a PO number and no line picked. A line is
 * never guessed; Purchasing picks it from the PO's IPAS stored Odoo copy once
 * that exists.
 */
export function poLineNotPicked(item) {
  if (!item?.po_number) return false;
  if (item.status !== ITEM_STATUS.ORDERED && item.status !== ITEM_STATUS.RECEIVED) return false;
  return !(item.odoo_po_line_ids?.length > 0);
}
