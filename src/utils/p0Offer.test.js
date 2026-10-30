import { describe, expect, it } from "vitest";
import { buildAttachOffer } from "../../supabase/functions/_shared/p0Offer.ts";

const line = (product_id, product_name = `Product ${product_id}`, quantity = 1, received = 0, id = null) => ({
  id,
  product_id,
  product_name,
  quantity,
  received,
});
const p0 = (name, origin, lines = [line(1)], extra = {}) => ({ name, state: "purchase", origin, date_order: "2026-10-01", lines, ...extra });
const item = (id, odoo_product_id, status = "to_purchase", extra = {}) => ({
  id,
  name: `Item ${id}`,
  quantity: 2,
  odoo_product_id,
  status,
  po_number: null,
  ...extra,
});

describe("buildAttachOffer", () => {
  it("offers the other open items of the product, with the P0 line and the status each gets", () => {
    const order = p0("P1", "S1", [line(1, "Harness", 4, 0, 10)]);
    const items = [item("a", 1), item("b", 1, "to_purchase"), item("c", 1, "not_checked")];
    // "a" is the item attached now; "b" and "c" share its product, so both are shared and unticked.
    expect(buildAttachOffer(order, items, "a")).toEqual({
      offered: [],
      unticked: [
        { itemId: "b", name: "Item b", reason: "shared_product" },
        { itemId: "c", name: "Item c", reason: "shared_product" },
      ],
    });
  });

  it("offers an other item of a different product that is on the P0, with its line and status", () => {
    const order = p0("P1", "S1", [line(1, "Harness", 4, 0, 10), line(2, "Carabiner", 6, 0, 11)]);
    const items = [item("a", 1), item("b", 2, "not_checked")];
    expect(buildAttachOffer(order, items, "a")).toEqual({
      offered: [{ itemId: "b", name: "Item b", lineIds: [11], products: ["Carabiner"], status: "purchased" }],
      unticked: [],
    });
  });

  it("gives an RFQ P0 the To purchase status, and a fully received one Received", () => {
    const rfq = p0("P1", "S1", [line(2, "Carabiner", 2, 0, 11)], { state: "draft" });
    const items = [item("a", 1), item("b", 2, "not_checked", { quantity: 2 })];
    expect(buildAttachOffer(rfq, items, "a").offered[0].status).toBe("to_purchase");

    const done = p0("P2", "S1", [line(2, "Carabiner", 2, 2, 11)]);
    expect(buildAttachOffer(done, items, "a").offered[0].status).toBe("received");
  });

  it("names the P0 rows the item would pick, with their products, once each", () => {
    const order = p0("P1", "S1", [line(2, "Carabiner", 2, 0, 11), line(2, "Carabiner", 3, 0, 12), line(1, "Harness", 1, 0, 10)]);
    const items = [item("a", 1), item("b", 2, "available")];
    const [offered] = buildAttachOffer(order, items, "a").offered;
    expect(offered).toMatchObject({ lineIds: [11, 12], products: ["Carabiner"] });
  });

  it("leaves out items with a P0 already, cancelled, closed, with no row on the P0, or no Odoo product", () => {
    const order = p0("P1", "S1", [line(2, "Carabiner", 2, 0, 11)]);
    const items = [
      item("a", 1),
      item("has", 2, "to_purchase", { po_number: "P9" }),
      item("cancelled", 2, "cancelled"),
      item("closed", 2, "cannot_source"),
      item("norow", 3, "not_checked"),
      item("noproduct", null, "not_checked"),
    ];
    expect(buildAttachOffer(order, items, "a")).toEqual({ offered: [], unticked: [] });
  });

  it("never names the item attached now", () => {
    const order = p0("P1", "S1", [line(1, "Harness", 4, 0, 10)]);
    expect(buildAttachOffer(order, [item("a", 1)], "a")).toEqual({ offered: [], unticked: [] });
  });
});
