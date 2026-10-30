import { describe, expect, it } from "vitest";
import { matchP0ToItems, pickedLineIds } from "../../supabase/functions/_shared/p0Matching.ts";

const line = (product_id, product_name = `Product ${product_id}`, quantity = 1, received = 0, id = null) => ({
  id,
  product_id,
  product_name,
  quantity,
  received,
});
const p0 = (name, origin, lines = [line(1)], extra = {}) => ({ name, state: "purchase", origin, date_order: "2026-10-01", lines, ...extra });
const item = (id, odoo_product_id, status = "to_purchase", extra = {}) => ({ id, odoo_product_id, status, po_number: null, ...extra });
const outcomeOf = (order, items, id) => matchP0ToItems(order, items).find((o) => o.itemId === id);

describe("pickedLineIds", () => {
  it("picks the one row with the item's product", () => {
    const order = p0("P1", "S1", [line(1, "A", 2, 0, 10), line(2, "B", 1, 0, 11)]);
    expect(pickedLineIds(order, item("a", 1), [item("a", 1)])).toEqual([10]);
  });

  it("picks every row with the item's product when the product is split over two rows", () => {
    const order = p0("P1", "S1", [line(1, "A", 2, 0, 10), line(2, "B", 1, 0, 11), line(1, "A", 3, 0, 12)]);
    expect(pickedLineIds(order, item("a", 1), [item("a", 1)])).toEqual([10, 12]);
  });

  it("picks nothing when the P0 has no row for the product", () => {
    const order = p0("P1", "S1", [line(2, "B", 1, 0, 11)]);
    expect(pickedLineIds(order, item("a", 1), [item("a", 1)])).toEqual([]);
  });

  it("picks nothing when another open item on the request has the same product", () => {
    const order = p0("P1", "S1", [line(1, "A", 2, 0, 10)]);
    const items = [item("a", 1), item("b", 1, "purchased")];
    expect(pickedLineIds(order, items[0], items)).toEqual([]);
  });

  it("ignores a same-product item that is closed (cancelled or received)", () => {
    const order = p0("P1", "S1", [line(1, "A", 2, 0, 10)]);
    expect(pickedLineIds(order, item("a", 1), [item("a", 1), item("b", 1, "cancelled")])).toEqual([10]);
    expect(pickedLineIds(order, item("a", 1), [item("a", 1), item("b", 1, "received")])).toEqual([10]);
  });

  it("picks nothing for an item with no Odoo product, even when the P0 has rows", () => {
    const order = p0("P1", "S1", [line(1, "A", 2, 0, 10)]);
    expect(pickedLineIds(order, item("a", null), [item("a", null)])).toEqual([]);
  });

  it("matches by product id, never by name", () => {
    const order = p0("P1", "S1", [line(7, "Cable", 1, 0, 10)]);
    expect(pickedLineIds(order, item("a", 8, "to_purchase", { name: "Cable" }), [item("a", 8)])).toEqual([]);
  });

  it("skips rows that have no Odoo line id", () => {
    const order = p0("P1", "S1", [line(1, "A", 2, 0, null)]);
    expect(pickedLineIds(order, item("a", 1), [item("a", 1)])).toEqual([]);
  });
});

describe("matchP0ToItems", () => {
  it("offers a P0 to Not checked, Available, To purchase and Still canvassing items, with the picked rows", () => {
    const order = p0("P1", "S1", [line(1, "A", 2, 0, 10)]);
    for (const status of ["not_checked", "available", "to_purchase", "still_canvassing"]) {
      const items = [item("a", 1, status)];
      expect(outcomeOf(order, items, "a")).toEqual({ itemId: "a", outcome: "offered", lineIds: [10] });
    }
  });

  it("offers an item with no picked rows only when its product has a row", () => {
    const order = p0("P1", "S1", [line(1, "A", 2, 0, 10)]);
    expect(outcomeOf(order, [item("a", 1)], "a")).toEqual({ itemId: "a", outcome: "offered", lineIds: [10] });
  });

  it("says no_row when the P0 has no row for the item's product", () => {
    const order = p0("P1", "S1", [line(2, "B", 1, 0, 11)]);
    expect(outcomeOf(order, [item("a", 1)], "a")).toEqual({ itemId: "a", outcome: "no_row" });
  });

  it("says shared_product when another open item has the same product and the P0 has its row", () => {
    const order = p0("P1", "S1", [line(1, "A", 2, 0, 10)]);
    const items = [item("a", 1), item("b", 1, "to_purchase")];
    expect(outcomeOf(order, items, "a")).toEqual({ itemId: "a", outcome: "shared_product" });
    expect(outcomeOf(order, items, "b")).toEqual({ itemId: "b", outcome: "shared_product" });
  });

  it("says has_p0 when the item already has a P0", () => {
    const order = p0("P1", "S1", [line(1, "A", 2, 0, 10)]);
    expect(outcomeOf(order, [item("a", 1, "purchased", { po_number: "P9" })], "a")).toEqual({ itemId: "a", outcome: "has_p0" });
  });

  it("says cancelled for a cancelled item, even one with a P0", () => {
    const order = p0("P1", "S1", [line(1, "A", 2, 0, 10)]);
    expect(outcomeOf(order, [item("a", 1, "cancelled")], "a")).toEqual({ itemId: "a", outcome: "cancelled" });
    expect(outcomeOf(order, [item("a", 1, "cancelled", { po_number: "P9" })], "a")).toEqual({ itemId: "a", outcome: "cancelled" });
  });

  it("says no_odoo_product for an open item with no P0 and no Odoo product", () => {
    const order = p0("P1", "S1", [line(1, "A", 2, 0, 10)]);
    expect(outcomeOf(order, [item("a", null)], "a")).toEqual({ itemId: "a", outcome: "no_odoo_product" });
  });

  it("says not_offered for a status that does not take a P0 and has none", () => {
    const order = p0("P1", "S1", [line(1, "A", 2, 0, 10)]);
    expect(outcomeOf(order, [item("a", 1, "cannot_source")], "a")).toEqual({ itemId: "a", outcome: "not_offered" });
  });

  it("gives one outcome per item, in order, with each item judged on its own", () => {
    const order = p0("P1", "S1", [line(1, "A", 2, 0, 10), line(2, "B", 1, 0, 11), line(1, "A", 1, 0, 12)]);
    const items = [item("a", 1), item("b", 2), item("c", 3), item("d", null), item("e", 1, "cancelled")];
    expect(matchP0ToItems(order, items)).toEqual([
      { itemId: "a", outcome: "offered", lineIds: [10, 12] },
      { itemId: "b", outcome: "offered", lineIds: [11] },
      { itemId: "c", outcome: "no_row" },
      { itemId: "d", outcome: "no_odoo_product" },
      { itemId: "e", outcome: "cancelled" },
    ]);
  });
});
