import { describe, it, expect } from "vitest";
import { extended, lineTotals, matrixTotals, percentOf } from "./costingMath";

describe("extended", () => {
  it("multiplies a unit price by a quantity to the centavo", () => {
    expect(extended(99500.5, 2)).toBe(199001);
    expect(extended("1234.56", "2.5")).toBe(3086.4);
    expect(extended(0.1, 3)).toBe(0.3);
  });

  it("rounds half away from zero, without float drift", () => {
    expect(extended(0.005, 3)).toBe(0.02);
    expect(extended(10.005, 1)).toBe(10.01);
    expect(extended(-0.005, 1)).toBe(-0.01);
    expect(extended(1.005, 100)).toBe(100.5);
  });

  it("counts a free item as zero but a blank as blank", () => {
    expect(extended(0, 5)).toBe(0);
    expect(extended(null, 5)).toBeNull();
    expect(extended(undefined, 5)).toBeNull();
    expect(extended("", 5)).toBeNull();
    expect(extended(100, null)).toBeNull();
    expect(extended("abc", 1)).toBeNull();
  });

  it("holds a bundle priced as a whole exactly", () => {
    expect(extended(2160500, 1)).toBe(2160500);
    expect(extended(9007199254.99, 1000)).toBe(9007199254990);
  });
});

describe("percentOf", () => {
  it("gives the prototype's 93.1% of ABC to two decimals", () => {
    expect(percentOf(2980000, 3200000)).toBe(93.13);
  });

  it("is null for a blank or a zero whole", () => {
    expect(percentOf(null, 100)).toBeNull();
    expect(percentOf(100, null)).toBeNull();
    expect(percentOf(100, 0)).toBeNull();
    expect(percentOf(0, 100)).toBe(0);
  });
});

describe("lineTotals", () => {
  it("totals ABC and Final Offer", () => {
    expect(lineTotals({ quantity: 2, abc_unit: 120000, final_offer_unit: 99500.5 })).toEqual({
      abcTotal: 240000,
      finalOfferTotal: 199001,
      overAbc: false,
      percentOfAbc: 82.92,
    });
  });

  it("flags a Final Offer above the ABC by one centavo", () => {
    expect(lineTotals({ quantity: 1, abc_unit: 100, final_offer_unit: 100 }).overAbc).toBe(false);
    expect(lineTotals({ quantity: 1, abc_unit: 100, final_offer_unit: 100.01 }).overAbc).toBe(true);
  });

  it("leaves a figure null when its input is blank or the tier never received it", () => {
    expect(lineTotals({ quantity: 2, abc_unit: 100 })).toEqual({ abcTotal: 200, finalOfferTotal: null, overAbc: false, percentOfAbc: null });
    expect(lineTotals({ quantity: 2, abc_unit: null, final_offer_unit: 5 })).toEqual({
      abcTotal: null,
      finalOfferTotal: 10,
      overAbc: false,
      percentOfAbc: null,
    });
    expect(lineTotals({ quantity: 2 })).toEqual({ abcTotal: null, finalOfferTotal: null, overAbc: false, percentOfAbc: null });
  });
});

describe("matrixTotals", () => {
  const lines = [
    { quantity: 1, abc_unit: 2200000, final_offer_unit: 2100000 },
    { quantity: 4, abc_unit: 250000, final_offer_unit: 220000 },
  ];

  it("sums the lines and shows Final Offer against the ABC", () => {
    expect(matrixTotals(lines)).toEqual({
      abcTotal: 3200000,
      finalOfferTotal: 2980000,
      missingAbc: 0,
      missingOffer: 0,
      overAbc: false,
      percentOfAbc: 93.13,
    });
  });

  it("flags the matrix total above the ABC total", () => {
    const over = matrixTotals([...lines, { quantity: 1, abc_unit: 100, final_offer_unit: 300000 }]);
    expect(over.overAbc).toBe(true);
    expect(over.percentOfAbc).toBe(102.5);
  });

  it("counts blanks and never treats them as zero", () => {
    const partial = matrixTotals([...lines, { quantity: 1, abc_unit: 500 }, { quantity: 1 }]);
    expect(partial).toEqual({
      abcTotal: null,
      finalOfferTotal: null,
      missingAbc: 1,
      missingOffer: 2,
      overAbc: false,
      percentOfAbc: null,
    });
  });

  it("checks the ceiling only when every line has an ABC", () => {
    const noCeiling = matrixTotals([
      { quantity: 1, final_offer_unit: 900 },
      { quantity: 1, abc_unit: 100, final_offer_unit: 1 },
    ]);
    expect(noCeiling.abcTotal).toBeNull();
    expect(noCeiling.finalOfferTotal).toBe(901);
    expect(noCeiling.overAbc).toBe(false);
  });

  it("gives nothing for an empty matrix", () => {
    expect(matrixTotals([])).toEqual({ abcTotal: null, finalOfferTotal: null, missingAbc: 0, missingOffer: 0, overAbc: false, percentOfAbc: null });
    expect(matrixTotals(undefined).missingOffer).toBe(0);
  });
});
