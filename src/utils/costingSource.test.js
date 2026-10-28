import { describe, it, expect } from "vitest";
import { costingPriced, lineCost, resolveCost } from "./costingMath";

// #701: a row's cost fills in order Canvass winner, P0, Odoo, then typed; a typed cost is never replaced.

const OFFER = "11111111-1111-1111-1111-111111111111";

describe("resolveCost: the source order", () => {
  it("is the Canvass winner's price when one backs Acquire, even with a P0 and an Odoo cost", () => {
    const cost = resolveCost({ acquire_unit: 100, acquire_from_offer_id: OFFER, acquire_source: "canvass", p0_unit_price: 90, odoo_unit: 80 });
    expect(cost).toMatchObject({ source: "canvass", pesos: 100 });
  });

  it("is the P0 price without a Canvass winner, ahead of Odoo", () => {
    const cost = resolveCost({ acquire_unit: 80, acquire_source: "odoo", p0_unit_price: 90, odoo_unit: 80 });
    expect(cost).toMatchObject({ source: "p0", pesos: 90, currency: "PHP" });
  });

  it("keeps the quoted price and currency of a foreign P0 beside its peso figure", () => {
    const cost = resolveCost({ p0_unit_price: 5600, p0_quoted_unit_price: 100, p0_currency: "USD" });
    expect(cost).toEqual({ source: "p0", pesos: 5600, price: 100, currency: "USD" });
  });

  it("is Odoo's cost when nothing else has one", () => {
    expect(resolveCost({ acquire_unit: 80, acquire_source: "odoo", odoo_unit: 80 })).toMatchObject({ source: "odoo", pesos: 80 });
    expect(resolveCost({ odoo_unit: 70 })).toMatchObject({ source: "odoo", pesos: 70 });
  });

  it("reads Typed for a cost Purchasing typed", () => {
    expect(resolveCost({ acquire_unit: 55, acquire_source: "typed" })).toMatchObject({ source: "typed", pesos: 55 });
  });

  it("is null while there is no cost, or the tier was sent none", () => {
    expect(resolveCost({})).toBeNull();
    expect(resolveCost({ acquire_unit: null, odoo_unit: null, p0_unit_price: null })).toBeNull();
    expect(resolveCost(undefined)).toBeNull();
  });
});

describe("resolveCost: a typed cost is never replaced by a later fill", () => {
  const typed = { acquire_unit: 55, acquire_source: "typed" };

  it("stays typed when a P0 price arrives later", () => {
    expect(resolveCost({ ...typed, p0_unit_price: 90 })).toMatchObject({ source: "typed", pesos: 55 });
  });

  it("stays typed when Odoo's cost is read later", () => {
    expect(resolveCost({ ...typed, odoo_unit: 80 })).toMatchObject({ source: "typed", pesos: 55 });
  });

  it("stays typed when a Canvass mark is left on the row by the winner being dropped", () => {
    expect(resolveCost({ ...typed, acquire_from_offer_id: null })).toMatchObject({ source: "typed" });
  });
});

describe("lineCost", () => {
  it("is null with no part, or while any part has no cost", () => {
    expect(lineCost({ quantity: 1, components: [] })).toBeNull();
    expect(lineCost({ quantity: 2, components: [{ quantity: 1, acquire_unit: 10, acquire_source: "typed" }, { quantity: 1 }] })).toBeNull();
  });

  it("is the part's own cost for a one-part row", () => {
    expect(lineCost({ quantity: 4, components: [{ quantity: 4, p0_unit_price: 25 }] })).toMatchObject({ source: "p0", pesos: 25 });
  });

  it("adds the parts over the line's quantity, naming the shared source or Mixed", () => {
    const same = lineCost({ quantity: 2, components: [{ quantity: 2, acquire_unit: 10, acquire_source: "typed" }, { quantity: 2, acquire_unit: 30, acquire_source: "typed" }] });
    expect(same).toMatchObject({ source: "typed", pesos: 40 });
    const mixed = lineCost({ quantity: 1, components: [{ quantity: 1, acquire_unit: 10, acquire_source: "typed" }, { quantity: 1, odoo_unit: 5 }] });
    expect(mixed).toMatchObject({ source: "mixed", pesos: 15 });
  });
});

describe("Costing priced: every row has a cost and a Purchasing Incharge is named", () => {
  it("is met once nothing is missing and an Incharge is named", () => {
    expect(costingPriced({ has_matrix: true, component_count: 3, missing_acquire: 0, has_purchasing_incharge: true }).met).toBe(true);
  });

  it("fails while a row has no cost", () => {
    expect(costingPriced({ has_matrix: true, component_count: 3, missing_acquire: 1, has_purchasing_incharge: true })).toEqual({ met: false, failing: ["missing_acquire"] });
  });

  it("fails with no Incharge named", () => {
    expect(costingPriced({ has_matrix: true, component_count: 3, missing_acquire: 0, has_purchasing_incharge: false }).failing).toEqual(["no_purchasing_incharge"]);
  });
});
