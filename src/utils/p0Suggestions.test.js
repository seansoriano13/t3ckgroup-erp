import { describe, expect, it } from "vitest";
import {
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

  it("reads the P0 line for the line's product, else the first, and names a cancelled P0 as nothing", () => {
    const order = p0("P1", "S1", [line(5, "Other"), line(1, "Mine")]);
    expect(p0Facts(order, 1).bought_as).toBe("Mine");
    expect(p0Facts(order, 9).bought_as).toBe("Other");
    expect(p0Facts(order, 1).bought_product_id).toBe(1);
    expect(p0Facts(order, 9).bought_product_id).toBe(5);
    expect(p0Facts({ ...order, state: "cancel" }, 1)).toBeNull();
  });
});

describe("p0UnitPrice (#686)", () => {
  const priced = (id, price_unit) => ({ ...line(id), price_unit });
  it("takes the price of the line for the same product, else the first line", () => {
    const order = p0("P01", "S01", [priced(1, 10), priced(2, 25)]);
    expect(p0UnitPrice(order, 2)).toBe(25);
    expect(p0UnitPrice(order, 99)).toBe(10);
    expect(p0UnitPrice(order, null)).toBe(10);
  });
  it("is null when Odoo gave no price", () => {
    expect(p0UnitPrice(p0("P01", "S01", [line(1)]), 1)).toBeNull();
  });
});
