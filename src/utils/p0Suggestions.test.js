import { describe, expect, it } from "vitest";
import {
  boughtLines,
  namesReference,
  p0Facts,
  p0UnitPrice,
  rankP0Suggestions,
  referencesIn,
  statusFromP0,
} from "../../supabase/functions/_shared/p0Suggestions.ts";

const line = (product_id, product_name = `Product ${product_id}`, quantity = 1, received = 0) => ({ product_id, product_name, quantity, received });
const p0 = (name, origin, lines = [line(1)], extra = {}) => ({ name, state: "purchase", origin, date_order: "2026-10-01", lines, ...extra });

describe("referencesIn", () => {
  it("reads one S0, several S0s, an S0 plus text, a PR number", () => {
    expect(referencesIn("S01237")).toEqual(["S01237"]);
    expect(referencesIn("S01237, S01240 / s01301")).toEqual(["S01237", "S01240", "S01301"]);
    expect(referencesIn("S01237 rush for Cebu")).toEqual(["S01237"]);
    expect(referencesIn("PR_0042")).toEqual(["PR_0042"]);
  });

  it("names nothing for a typo or for letters glued to the number", () => {
    expect(referencesIn("S0123")).toEqual(["S0123"]);
    expect(referencesIn("SO1237")).toEqual([]);
    expect(referencesIn("PR0042")).toEqual([]);
    expect(referencesIn("XS01237")).toEqual([]);
    expect(referencesIn(null)).toEqual([]);
  });

  it("does not match a longer number that merely starts the same", () => {
    expect(namesReference("S012370", "S01237")).toBe(false);
    expect(namesReference("S01237", "s01237")).toBe(true);
  });
});

describe("rankP0Suggestions", () => {
  const p0s = [
    p0("P1", "S01237", [line(1)]),
    p0("P2", "S01237, S01240", [line(2)]),
    p0("P3", "S01240", [line(1)]),
    p0("P4", "S01237 urgent", [line(1), line(3)]),
    p0("P5", "SO1237", [line(1)]),
    p0("P6", "PR_0042", [line(1)]),
    p0("P7", "S01237", [line(1)], { state: "cancel" }),
  ];

  it("puts same-product P0s first, then other P0s that name the S0", () => {
    const { suggested, others } = rankP0Suggestions({ reference: "S01237", productId: 1, p0s });
    expect(suggested.map((x) => x.name).sort()).toEqual(["P1", "P4"]);
    expect(others.map((x) => x.name)).toEqual(["P2"]);
  });

  it("leaves out typos, other S0s and cancelled P0s", () => {
    const names = Object.values(rankP0Suggestions({ reference: "S01237", productId: 1, p0s })).flat().map((x) => x.name);
    expect(names).not.toContain("P3");
    expect(names).not.toContain("P5");
    expect(names).not.toContain("P7");
  });

  it("finds a Direct request's P0 by its PR number", () => {
    const { suggested } = rankP0Suggestions({ reference: "PR_0042", productId: null, p0s });
    expect(suggested).toEqual([]);
    expect(rankP0Suggestions({ reference: "PR_0042", productId: null, p0s }).others.map((x) => x.name)).toEqual(["P6"]);
  });
});

describe("what a P0 does to the line", () => {
  it("an RFQ stays To purchase, a confirmed P0 is Purchased, a full receipt is Received", () => {
    const status = (state, received) => statusFromP0(p0Facts(p0("P1", "S1", [line(1, "A", 4, received)], { state }), 1));
    expect(status("draft", 0)).toBe("to_purchase");
    expect(status("purchase", 0)).toBe("purchased");
    expect(status("purchase", 3)).toBe("purchased");
    expect(status("purchase", 4)).toBe("received");
  });

  it("carries Odoo's Expected Arrival, or null when it is not set", () => {
    expect(p0Facts(p0("P1", "S1", [line(1)], { date_planned: "2026-11-12" }), 1).eta).toBe("2026-11-12");
    expect(p0Facts(p0("P1", "S1"), 1).eta).toBeNull();
  });

  it("reads the P0 line for the line's product, and names a cancelled P0 as nothing", () => {
    const order = p0("P1", "S1", [line(5, "Other"), line(1, "Mine")]);
    expect(p0Facts(order, 1).bought_as).toBe("Mine");
    expect(p0Facts(order, 1).bought_product_id).toBe(1);
    expect(p0Facts({ ...order, state: "cancel" }, 1)).toBeNull();
  });
});

// Odoo line ids, as "Pick PO line…" stores them in odoo_po_line_ids.
const lineWithId = (id, product_id, quantity, received = 0, price_unit = null) => ({
  ...line(product_id, `Product ${product_id}`, quantity, received),
  id,
  price_unit,
});

describe("a P0 that lists the product on several lines", () => {
  // P02674: the roof mount twice, 4 for one project and 1 for the other.
  const mounts = p0("P02674", "S04081 S04602", [lineWithId(11, 7, 4, 0, 30), lineWithId(12, 7, 1, 0, 30)]);

  it("sums every line of the product until Purchasing picks one", () => {
    expect(p0Facts(mounts, 7)).toMatchObject({ ordered: 5, received: 0, bought_as: "Product 7", bought_product_id: 7 });
  });

  it("reads only the picked lines once Purchasing picks", () => {
    expect(p0Facts(mounts, 7, [12])).toMatchObject({ ordered: 1, received: 0 });
    expect(p0Facts(mounts, 7, [11])).toMatchObject({ ordered: 4 });
  });

  it("ignores picks that are not on this P0", () => {
    expect(p0Facts(mounts, 7, [999]).ordered).toBe(5);
  });

  it("is Received only when every counted line arrived", () => {
    const part = p0("P1", "S1", [lineWithId(11, 7, 4, 4), lineWithId(12, 7, 1, 0)]);
    expect(statusFromP0(p0Facts(part, 7))).toBe("purchased");
    expect(statusFromP0(p0Facts(part, 7, [11]))).toBe("received");
  });

  it("does not depend on line order for the price: free lines lower it by their quantity", () => {
    // P01235: some lines of the battery pack are free (price 0).
    const lines = [lineWithId(1, 3, 9, 0, 0), lineWithId(2, 3, 9, 0, 100), lineWithId(3, 3, 2, 0, 100)];
    const forward = p0("P01235", "S03885", lines);
    const backward = p0("P01235", "S03885", [...lines].reverse());
    expect(p0UnitPrice(forward, 3).price).toBe(55);
    expect(p0UnitPrice(backward, 3).price).toBe(55);
    expect(p0UnitPrice(forward, 3, [1]).price).toBe(0);
  });
});

describe("a request line with no Odoo product, or a P0 for another product", () => {
  it("takes the P0's only product, summed over its lines", () => {
    const mounts = p0("P02674", "S04081", [lineWithId(11, 7, 4), lineWithId(12, 7, 1)]);
    expect(p0Facts(mounts, null)).toMatchObject({ ordered: 5, bought_as: "Product 7", bought_product_id: 7 });
    expect(p0Facts(mounts, 9)).toMatchObject({ ordered: 5, bought_product_id: 7 });
  });

  it("counts nothing on a P0 of several products until a line is picked", () => {
    const mixed = p0("P02587", "S04081", [lineWithId(21, 1, 3, 3), lineWithId(22, 2, 1, 1)]);
    expect(boughtLines(mixed, null)).toEqual([]);
    expect(p0Facts(mixed, null)).toMatchObject({ ordered: 0, received: 0, bought_as: null, bought_product_id: null });
    expect(statusFromP0(p0Facts(mixed, null))).toBe("purchased");
    expect(p0UnitPrice(mixed, null).price).toBeNull();
    expect(p0Facts(mixed, null, [22])).toMatchObject({ ordered: 1, received: 1, bought_product_id: 2 });
  });

  it("names every picked product, but gives a product id only when they are one product", () => {
    const mixed = p0("P02587", "S04081", [lineWithId(21, 1, 3), lineWithId(22, 2, 1)]);
    expect(p0Facts(mixed, null, [21, 22])).toMatchObject({ ordered: 4, bought_as: "Product 1, Product 2", bought_product_id: null });
  });
});

describe("p0UnitPrice (#686)", () => {
  const priced = (id, price_unit) => ({ ...line(id), price_unit });
  it("takes the price of the line for the same product, and none from a P0 of other products", () => {
    const order = p0("P01", "S01", [priced(1, 10), priced(2, 25)]);
    expect(p0UnitPrice(order, 2).price).toBe(25);
    expect(p0UnitPrice(order, 99).price).toBeNull();
    expect(p0UnitPrice(order, null).price).toBeNull();
  });
  it("is null when Odoo gave no price", () => {
    expect(p0UnitPrice(p0("P01", "S01", [line(1)]), 1).price).toBeNull();
  });
  it("carries the P0's currency, so a USD price is never taken as pesos", () => {
    // P01235 (Shenzhen Coming Technology): the Light Tower 400 at USD 388.
    const order = p0("P01235", "S01", [priced(7, 388)], { currency: "USD" });
    expect(p0UnitPrice(order, 7)).toEqual({ price: 388, currency: "USD" });
    expect(p0UnitPrice(p0("P01", "S01", [priced(1, 10)], { currency: "PHP" }), 1)).toEqual({ price: 10, currency: "PHP" });
  });
  it("does not assume pesos when Odoo did not say the currency", () => {
    expect(p0UnitPrice(p0("P01", "S01", [priced(1, 10)]), 1)).toEqual({ price: 10, currency: null });
  });
});
