import { describe, it, expect } from "vitest";
import {
  complianceRollup,
  componentTotals,
  costRowsTotals,
  costRowTotals,
  describeComplianceRollup,
  extended,
  lineTotals,
  matrixTotals,
  percentOf,
} from "./costingMath";

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
      acquireTotal: null,
      odooTotal: null,
    });
  });

  it("flags a Final Offer above the ABC by one centavo", () => {
    expect(lineTotals({ quantity: 1, abc_unit: 100, final_offer_unit: 100 }).overAbc).toBe(false);
    expect(lineTotals({ quantity: 1, abc_unit: 100, final_offer_unit: 100.01 }).overAbc).toBe(true);
  });

  it("leaves a figure null when its input is blank or the tier never received it", () => {
    expect(lineTotals({ quantity: 2, abc_unit: 100 })).toEqual({
      abcTotal: 200,
      finalOfferTotal: null,
      overAbc: false,
      percentOfAbc: null,
      acquireTotal: null,
      odooTotal: null,
    });
    expect(lineTotals({ quantity: 2, abc_unit: null, final_offer_unit: 5 })).toEqual({
      abcTotal: null,
      finalOfferTotal: 10,
      overAbc: false,
      percentOfAbc: null,
      acquireTotal: null,
      odooTotal: null,
    });
    expect(lineTotals({ quantity: 2 })).toEqual({
      abcTotal: null,
      finalOfferTotal: null,
      overAbc: false,
      percentOfAbc: null,
      acquireTotal: null,
      odooTotal: null,
    });
  });

  describe("with Components", () => {
    const line = { quantity: 1, abc_unit: 2200000, final_offer_unit: 2100000 };

    it("totals a bundle priced as a whole: 1 x 2,160,500 is 2,160,500", () => {
      const totals = lineTotals(line, [{ quantity: 1, is_bundle: true, acquire_unit: 2160500, odoo_unit: 2200000 }]);
      expect(totals.acquireTotal).toBe(2160500);
      expect(totals.odooTotal).toBe(2200000);
    });

    it("adds each Component's unit cost times its own quantity", () => {
      const totals = lineTotals(line, [
        { quantity: 2, acquire_unit: 1000.5, odoo_unit: 1100 },
        { quantity: 3, acquire_unit: 200, odoo_unit: 250.25 },
      ]);
      expect(totals.acquireTotal).toBe(2601);
      expect(totals.odooTotal).toBe(2950.75);
    });

    it("leaves the Acquire total null, never zero, when any Component has a blank Acquire", () => {
      const totals = lineTotals(line, [
        { quantity: 1, acquire_unit: 2160500, odoo_unit: 2200000 },
        { quantity: 1, acquire_unit: null, odoo_unit: 100 },
        { quantity: 1, odoo_unit: 50 },
      ]);
      expect(totals.acquireTotal).toBeNull();
      expect(totals.odooTotal).toBe(2200150);
    });

    it("keeps a free Component as zero but a Component the tier never sent as blank", () => {
      expect(lineTotals(line, [{ quantity: 1, acquire_unit: 0 }]).acquireTotal).toBe(0);
      // A price-tier reader receives no acquire_unit key at all.
      expect(lineTotals(line, [{ quantity: 1, odoo_unit: 10 }]).acquireTotal).toBeNull();
    });

    it("has no Acquire or Odoo total for a line with no Components", () => {
      expect(lineTotals(line, []).acquireTotal).toBeNull();
      expect(lineTotals(line).odooTotal).toBeNull();
    });

    it("leaves ABC and Final Offer untouched by the Components", () => {
      const totals = lineTotals(line, [{ quantity: 1, acquire_unit: 1, odoo_unit: 1 }]);
      expect(totals).toMatchObject({ abcTotal: 2200000, finalOfferTotal: 2100000, overAbc: false });
    });
  });
});

describe("componentTotals and cost-only rows", () => {
  it("totals one Component or cost-only row, blank staying blank", () => {
    expect(componentTotals({ quantity: 4, acquire_unit: 25.5, odoo_unit: 30 })).toEqual({ acquireTotal: 102, odooTotal: 120 });
    expect(costRowTotals({ quantity: 1, acquire_unit: 100000 })).toEqual({ acquireTotal: 100000, odooTotal: null });
    expect(componentTotals(undefined)).toEqual({ acquireTotal: null, odooTotal: null });
  });

  it("keeps cost-only rows out of a Tender Line's totals and adds them up on their own", () => {
    const rows = [
      { quantity: 1, acquire_unit: 100000, odoo_unit: 110000 },
      { quantity: 2, acquire_unit: 5000, odoo_unit: 6000 },
    ];
    expect(costRowsTotals(rows)).toEqual({ acquireTotal: 110000, odooTotal: 122000 });
    expect(costRowsTotals([...rows, { quantity: 1, odoo_unit: 1 }]).acquireTotal).toBeNull();
    expect(costRowsTotals([])).toEqual({ acquireTotal: null, odooTotal: null });
    expect(lineTotals({ quantity: 1 }, []).acquireTotal).toBeNull();
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

describe("complianceRollup", () => {
  const verdicts = (...list) => list.map((compliance) => ({ compliance }));

  it("counts the Components that deviate and the ones with no verdict yet", () => {
    const rollup = complianceRollup(verdicts("complies", "deviates", null, "deviates", "complies"));
    expect(rollup).toEqual({ deviates: 2, notEvaluated: 1, total: 5 });
  });

  it("reads a missing or unknown verdict as not evaluated, never as complying", () => {
    expect(complianceRollup([{}, { compliance: undefined }, { compliance: "" }, { compliance: "maybe" }, null])).toEqual({ deviates: 0, notEvaluated: 5, total: 5 });
  });

  it("counts a Component that complies as neither", () => {
    expect(complianceRollup(verdicts("complies", "complies"))).toEqual({ deviates: 0, notEvaluated: 0, total: 2 });
  });

  it("is zero for no Components", () => {
    expect(complianceRollup([])).toEqual({ deviates: 0, notEvaluated: 0, total: 0 });
    expect(complianceRollup(undefined)).toEqual({ deviates: 0, notEvaluated: 0, total: 0 });
  });

  it("rolls up a whole offer when handed every line's Components", () => {
    const line1 = verdicts("deviates", "complies");
    const line2 = verdicts(null, "deviates", "complies");
    expect(complianceRollup([...line1, ...line2])).toEqual({ deviates: 2, notEvaluated: 1, total: 5 });
  });
});

describe("describeComplianceRollup", () => {
  it("says it the way the Tender Line and the header show it", () => {
    expect(describeComplianceRollup({ deviates: 2, notEvaluated: 1, total: 5 })).toBe("2 of 5 deviate · 1 not evaluated");
    expect(describeComplianceRollup({ deviates: 1, notEvaluated: 0, total: 4 })).toBe("1 of 4 deviate");
    expect(describeComplianceRollup({ deviates: 1, notEvaluated: 0, total: 1 })).toBe("1 of 1 deviates");
    expect(describeComplianceRollup({ deviates: 0, notEvaluated: 3, total: 3 })).toBe("3 not evaluated");
  });

  it("says when everything complies, and nothing when there is nothing to judge", () => {
    expect(describeComplianceRollup({ deviates: 0, notEvaluated: 0, total: 4 })).toBe("All 4 comply");
    expect(describeComplianceRollup({ deviates: 0, notEvaluated: 0, total: 1 })).toBe("Complies");
    expect(describeComplianceRollup({ deviates: 0, notEvaluated: 0, total: 0 })).toBeNull();
    expect(describeComplianceRollup(undefined)).toBeNull();
  });
});
