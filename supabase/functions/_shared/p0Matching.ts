// Which P0 lines a P0 attach picks for each Requested Item of a request (#804).
//
// Pure functions over rows already read from Odoo and the request's items, so the rules are
// tested without Odoo or the database. Products are matched by Odoo product id only, never by
// name. The bulk attach (#809) reuses matchP0ToItems and pickedLineIds.

import type { OdooP0 } from "./p0Suggestions.ts";

/** The part of a Requested Item these rules read. */
export type MatchItem = {
  id: string;
  status: string;
  /** The Odoo product id; null when the item has no Odoo product. */
  odoo_product_id: number | null;
  /** The P0 the item already has, if any. Callers attaching now pass null here. */
  po_number?: string | null;
};

export type MatchOutcome =
  /** The P0 can be attached to the item. `lineIds` are the P0 rows picked for it (may be several). */
  | { itemId: string; outcome: "offered"; lineIds: number[] }
  | { itemId: string; outcome: "has_p0" }
  | { itemId: string; outcome: "cancelled" }
  /** Another open item on the request has the same Odoo product, so nothing is picked. */
  | { itemId: string; outcome: "shared_product" }
  /** The P0 has no row for the item's Odoo product. The P0 may be wrong. */
  | { itemId: string; outcome: "no_row" }
  /** An open item with no P0 and no Odoo product. Nothing is picked. */
  | { itemId: string; outcome: "no_odoo_product" }
  /** A status that does not take a P0 (Cannot source, Received with no P0). */
  | { itemId: string; outcome: "not_offered" };

// Statuses a P0 can be attached to. Cancelled is refused elsewhere; the rest are closed buying.
const OFFERED_STATUSES = new Set(["not_checked", "available", "to_purchase", "still_canvassing"]);
// Items that are done with buying: they never compete for a product's P0 rows.
const CLOSED_STATUSES = new Set(["cancelled", "cannot_source", "received"]);

const isOpen = (item: MatchItem) => !CLOSED_STATUSES.has(item.status);

/**
 * True when another open item on the request has the same Odoo product as `item`, and that item does not
 * already have a different P0 (#798 review): an item on a different P0 is not competing for this P0's rows.
 */
function sharesProduct(item: MatchItem, items: MatchItem[], p0Name: string): boolean {
  if (item.odoo_product_id == null) return false;
  return items.some(
    (other) =>
      other.id !== item.id &&
      isOpen(other) &&
      !(other.po_number && other.po_number !== p0Name) &&
      other.odoo_product_id === item.odoo_product_id,
  );
}

/**
 * The P0 row ids an attach picks for `item`: every row of the P0 whose Odoo product is the
 * item's product. Nothing (an empty list) when the item has no Odoo product, when another open
 * item on the request has the same product, or when the P0 has no row for it.
 */
export function pickedLineIds(p0: OdooP0, item: MatchItem, items: MatchItem[]): number[] {
  if (item.odoo_product_id == null || sharesProduct(item, items, p0.name)) return [];
  const ids = p0.lines
    .filter((line) => line.product_id === item.odoo_product_id && line.id != null)
    .map((line) => Number(line.id));
  return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * True when the item has an Odoo product and the P0 has no row for it, so the P0 may be the wrong one.
 * Whatever the item's status: the attach of the item itself warns for a Received or Purchased line too.
 * An item with no Odoo product has nothing to compare, so it never warns.
 */
export function lacksRowForProduct(p0: OdooP0, item: MatchItem): boolean {
  return item.odoo_product_id != null && !p0.lines.some((line) => line.product_id === item.odoo_product_id);
}

/** One outcome per item of the request, in the same order as `items`. */
export function matchP0ToItems(p0: OdooP0, items: MatchItem[]): MatchOutcome[] {
  return items.map((item): MatchOutcome => {
    if (item.status === "cancelled") return { itemId: item.id, outcome: "cancelled" };
    if (item.po_number) return { itemId: item.id, outcome: "has_p0" };
    if (!OFFERED_STATUSES.has(item.status)) return { itemId: item.id, outcome: "not_offered" };
    if (item.odoo_product_id == null) return { itemId: item.id, outcome: "no_odoo_product" };
    if (lacksRowForProduct(p0, item)) return { itemId: item.id, outcome: "no_row" };
    if (sharesProduct(item, items, p0.name)) return { itemId: item.id, outcome: "shared_product" };
    return { itemId: item.id, outcome: "offered", lineIds: pickedLineIds(p0, item, items) };
  });
}
