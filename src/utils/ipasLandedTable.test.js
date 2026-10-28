import { describe, expect, it } from "vitest";

import { landedTable } from "./ipasLandedTable";

const ipas = (extra = {}) => ({
  purpose: "inventory",
  retail_multiplier: 3,
  wholesale_discount_pct: 30,
  charges: [
    { kindLabel: "Duties & Taxes", amount_php: 100 },
    { kindLabel: "Brokerage", amount_php: 50 },
  ],
  payments: [
    { amount: 100, forex_rate: 50 },
    { amount: 100, forex_rate: 60 },
  ],
  landedCost: {
    isForeign: true,
    totals: { goodsPhp: 1100, freightPhp: 30, landedPhp: 1280 },
    lines: [
      { lineId: "a", name: "A", quantity: 10, unitPriceForeign: 2, unitPricePhp: 110, goodsPhp: 1100, spreadPhp: 180, landedPerUnitPhp: 128 },
    ],
  },
  ...extra,
});

describe("landedTable", () => {
  it("splits the spread into duties, freight and other per unit", () => {
    const [row] = landedTable(ipas()).rows;
    expect(row.duties).toBe(10);
    expect(row.freight).toBe(3);
    expect(row.other).toBe(5);
    expect(row.share).toBe(100);
  });

  it("prices an Inventory IPAS off the bare peso price", () => {
    const [row] = landedTable(ipas()).rows;
    expect(row.retail).toBe(330);
    expect(row.wholesale).toBe(231);
    expect(row.income).toBe(78.25);
  });

  it("leaves pricing out for other purposes", () => {
    const table = landedTable(ipas({ purpose: "project" }));
    expect(table.pricing).toBe(false);
    expect(table.rows[0].retail).toBeNull();
  });

  it("has no retail until a multiplier is set, and defaults the discount to 30", () => {
    const table = landedTable(ipas({ retail_multiplier: null, wholesale_discount_pct: undefined }));
    expect(table.rows[0].retail).toBeNull();
    expect(table.discount).toBe(30);
  });

  it("says how far a single rate would have been off", () => {
    const { note } = landedTable(ipas());
    expect(note.average).toBe(55);
    expect(note.off).toBe(100);
  });

  it("is null with no lines", () => {
    expect(landedTable(ipas({ landedCost: { lines: [], totals: {} } }))).toBeNull();
  });
});
