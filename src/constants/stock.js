/**
 * Issue #202 — the stock-badge rule, kept as one pure function so the SOR
 * modal and the Purchase Request view can never disagree about "available".
 *
 * `product` is the entry stored per-product in a sor_stock_snapshots row
 * (see that migration): `{ type, free, onHand, forecast, byWarehouse }`, or
 * `null`/`undefined` for a line with no reading. Two causes, kept apart: a line
 * with no Odoo product id — typed by hand, so it never had one to look up —
 * is NOT_LINKED; a line that has an id but no reading yet (the last stock
 * read failed, or the line arrived after it) is NOT_CHECKED, never "not
 * linked", since the fix for it is a Refresh, not a link.
 */

import { STATUS_THEME } from "./statusTheme";

export const STOCK_BADGE = {
  AVAILABLE: "AVAILABLE",
  PARTIAL: "PARTIAL",
  OUT_OF_STOCK: "OUT_OF_STOCK",
  NOT_TRACKED: "NOT_TRACKED",
  NOT_LINKED: "NOT_LINKED",
  NOT_CHECKED: "NOT_CHECKED",
};

export const STOCK_BADGE_THEME = {
  [STOCK_BADGE.AVAILABLE]: STATUS_THEME.GREEN,
  [STOCK_BADGE.PARTIAL]: STATUS_THEME.AMBER,
  [STOCK_BADGE.OUT_OF_STOCK]: STATUS_THEME.RED,
  [STOCK_BADGE.NOT_TRACKED]: STATUS_THEME.MAUVE,
  [STOCK_BADGE.NOT_LINKED]: STATUS_THEME.MAUVE,
  [STOCK_BADGE.NOT_CHECKED]: STATUS_THEME.MAUVE,
};

/**
 * #501 — a stock reading older than this is stale. Stock moves daily, and a
 * snapshot is only re-read when someone opens or refreshes the SOR, so a
 * figure from before yesterday is marked rather than trusted.
 */
export const STOCK_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Whether a snapshot read at `fetchedAt` is stale at `now`. No reading is not stale: it is Not checked. */
export function isStockStale(fetchedAt, now = Date.now()) {
  if (!fetchedAt) return false;
  const at = new Date(fetchedAt).getTime();
  return Number.isFinite(at) && now - at > STOCK_STALE_AFTER_MS;
}

/**
 * Returns `{ kind, label, free }` for a Product List line.
 *
 * Judged on free stock (on hand minus reserved), not on-hand — units already
 * promised to another order must not read as available (Q38).
 */
export function stockBadge({ quantity, product, odooProductId } = {}) {
  if (!product && odooProductId) {
    return { kind: STOCK_BADGE.NOT_CHECKED, label: "Not checked", free: null };
  }
  if (!product) {
    return { kind: STOCK_BADGE.NOT_LINKED, label: "Not linked to Odoo", free: null };
  }
  if (product.type !== "product") {
    return { kind: STOCK_BADGE.NOT_TRACKED, label: "Not tracked", free: null };
  }

  const free = Number(product.free) || 0;
  const qty = Number(quantity) || 0;

  if (free <= 0) {
    return { kind: STOCK_BADGE.OUT_OF_STOCK, label: "Out of stock", free };
  }
  if (free >= qty) {
    return { kind: STOCK_BADGE.AVAILABLE, label: "Available", free };
  }
  return {
    kind: STOCK_BADGE.PARTIAL,
    label: `Partial · ${free} of ${qty}`,
    free,
  };
}
