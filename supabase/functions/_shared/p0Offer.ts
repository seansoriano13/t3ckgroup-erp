// The "attach to the other items" offer after one P0 is attached (#809).
//
// Built on the server from the same Odoo read as the attach, so the browser never sends P0 facts
// (ADR 0044). Pure: the rules are tested without Odoo or the database. The offer has one list per
// kind of item it can name. `offered` items get the P0 when ticked. `unticked` items are shown with a
// note and cannot be ticked. #811 adds a list for items with no Odoo product beside them.

import { type MatchItem, matchP0ToItems } from "./p0Matching.ts";
import { type OdooP0, p0Facts, statusFromP0 } from "./p0Suggestions.ts";

/** An item of the request as the offer reads it: the match fields plus the name and quantity to show. */
export type OfferItem = MatchItem & { name: string; quantity: number | null };

export type OfferedItem = {
  itemId: string;
  name: string;
  /** The P0 row ids the attach would pick for this item. */
  lineIds: number[];
  /** The Odoo product names of those P0 rows, in the P0's order, without repeats. */
  products: string[];
  /** The status the item gets when the P0 is attached (the same rule as the attach itself). */
  status: "to_purchase" | "purchased" | "received";
};

export type UntickedItem = {
  itemId: string;
  name: string;
  /** Why it is not ticked: another open item on the request has the same Odoo product. */
  reason: "shared_product";
};

export type AttachOffer = {
  offered: OfferedItem[];
  unticked: UntickedItem[];
};

/**
 * The other items of the request this P0 can go to, right after `attachedItemId` got it.
 * `items` are the request's items as they were before the attach (the same read the attach used).
 * Items with the P0 already, cancelled items, items whose product has no row on the P0, and items
 * with no Odoo product are left out. A cancelled P0 never reaches here (the attach refuses it).
 */
export function buildAttachOffer(p0: OdooP0, items: OfferItem[], attachedItemId: string): AttachOffer {
  const offer: AttachOffer = { offered: [], unticked: [] };
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const outcome of matchP0ToItems(p0, items)) {
    if (outcome.itemId === attachedItemId) continue;
    const item = byId.get(outcome.itemId);
    if (!item) continue;
    if (outcome.outcome === "offered") {
      const facts = p0Facts(p0, item.odoo_product_id, outcome.lineIds, item.quantity);
      if (!facts) continue;
      const rows = p0.lines.filter((line) => line.id != null && outcome.lineIds.includes(Number(line.id)));
      offer.offered.push({
        itemId: item.id,
        name: item.name,
        lineIds: outcome.lineIds,
        products: [...new Set(rows.map((line) => line.product_name).filter(Boolean))],
        status: statusFromP0(facts),
      });
    } else if (outcome.outcome === "shared_product") {
      offer.unticked.push({ itemId: item.id, name: item.name, reason: "shared_product" });
    }
  }
  return offer;
}
