import { describe, it, expect } from "vitest";
import { complianceRollup, componentTotals, costRowsTotals, costRowTotals, describeComplianceRollup, extended, finalAcquireTotal, lineTotals, matrixTotals, percentOf, revenueComparison, revenueInputs, summary } from "./costingMath";

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
      landedCost: null,
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
      landedCost: null,
      abcTotal: 200,
      finalOfferTotal: null,
      overAbc: false,
      percentOfAbc: null,
      acquireTotal: null,
      odooTotal: null,
    });
    expect(lineTotals({ quantity: 2, abc_unit: null, final_offer_unit: 5 })).toEqual({
      landedCost: null,
      abcTotal: null,
      finalOfferTotal: 10,
      overAbc: false,
      percentOfAbc: null,
      acquireTotal: null,
      odooTotal: null,
    });
    expect(lineTotals({ quantity: 2 })).toEqual({
      landedCost: null,
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
      landedCost: null,
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
      landedCost: null,
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
    expect(matrixTotals([])).toEqual({ abcTotal: null, finalOfferTotal: null, missingAbc: 0, missingOffer: 0, overAbc: false, percentOfAbc: null, landedCost: null });
    expect(matrixTotals(undefined).missingOffer).toBe(0);
  });
});

describe("summary", () => {
  const settings = { vatDivisor: 1.12, taxRate: 0.06, retentionRate: 0.01, itrRate: 0.08, itrAllowance: 250000 };

  /** One Tender Line at the given Final Offer (and ABC), with Components carrying the given Final Acquire totals. */
  const matrix = ({ offer, abc, acquires = [], costRows = [], money } = {}) => ({
    tenderLines: [
      {
        quantity: 1,
        final_offer_unit: offer,
        abc_unit: abc,
        components: acquires.map((final_acquire_unit) => ({ quantity: 1, final_acquire_unit })),
      },
    ],
    costRows,
    money,
  });

  it("works the sheet's figures to the centavo when Final Acquire is blank (#213)", () => {
    const s = summary(matrix({ offer: 2980000, acquires: [null] }), settings);
    expect(s).toMatchObject({
      finalOfferTotal: 2980000,
      vatExclusive: 2660714.29,
      tax: 178800,
      retention: 29800,
      collected: 2771400,
      itr: 218400,
      operationalExpenses: null,
      revenue: null,
    });
    expect(s.incomplete).toMatchObject({ missingCost: 1, missingOffer: 0 });
  });

  it("works Collected, ITR and Revenue once every cost is in (#213)", () => {
    const s = summary(matrix({ offer: 3930715, acquires: [1156780] }), settings);
    expect(s).toMatchObject({
      tax: 235842.9,
      retention: 39307.15,
      collected: 3655564.95,
      itr: 294457.2,
      operationalExpenses: 1156780,
      revenue: 2479477.8,
    });
    expect(s.incomplete).toMatchObject({ missingCost: 0, missingOffer: 0 });
  });

  it("matches the #229 sample: Revenue 423,100.00 at 93.1% of a 3,200,000 ABC", () => {
    const s = summary(matrix({ offer: 2980000, abc: 3200000, acquires: [2338500] }), settings);
    expect(s.revenue).toBe(423100);
    expect(s.percentOfAbc.toFixed(1)).toBe("93.1");
    expect(s.overAbc).toBe(false);
  });

  it("adds Components of every line and the cost-only rows into Operational Expenses", () => {
    const s = summary(
      {
        tenderLines: [
          { quantity: 2, final_offer_unit: 500000, components: [{ quantity: 2, final_acquire_unit: 100000 }, { quantity: 1, final_acquire_unit: 50000 }] },
          { quantity: 1, final_offer_unit: 2000000, components: [{ quantity: 1, final_acquire_unit: 900000 }] },
        ],
        costRows: [{ quantity: 1, final_acquire_unit: 25000.5 }],
      },
      settings,
    );
    expect(s.finalOfferTotal).toBe(3000000);
    expect(s.operationalExpenses).toBe(1175000.5);
    // (3,000,000 - 1,175,000.50) - (2,750,000 x 8%) = 1,824,999.50 - 220,000
    expect(s.revenue).toBe(1604999.5);
  });

  it("changes every figure with a rate", () => {
    const changed = summary(matrix({ offer: 2980000, acquires: [2338500] }), { ...settings, taxRate: 0.05, itrAllowance: 0, vatDivisor: 1.1 });
    expect(changed).toMatchObject({ vatExclusive: 2709090.91, tax: 149000, itr: 238400, revenue: 403100 });
  });

  it("marks the offer figures incomplete while a Tender Line has no Final Offer, and never treats it as zero", () => {
    const s = summary(
      {
        tenderLines: [
          { quantity: 1, final_offer_unit: 1000000, components: [{ quantity: 1, final_acquire_unit: 400000 }] },
          { quantity: 1, final_offer_unit: null, components: [] },
          { quantity: 1, components: [] },
        ],
        costRows: [],
      },
      settings,
    );
    expect(s.incomplete.missingOffer).toBe(2);
    for (const figure of ["finalOfferTotal", "vatExclusive", "tax", "retention", "collected", "itr", "revenue"]) expect(s[figure], figure).toBeNull();
    // The cost side does not need the offer.
    expect(s.operationalExpenses).toBe(400000);
  });

  it("counts a Component or cost-only row with no Final Acquire, and keeps Operational Expenses blank", () => {
    const s = summary(matrix({ offer: 1000000, acquires: [100, null], costRows: [{ quantity: 1, final_acquire_unit: null }] }), settings);
    expect(s.incomplete.missingCost).toBe(2);
    expect(s.operationalExpenses).toBeNull();
    expect(s.revenue).toBeNull();
    expect(s.tax).toBe(60000);
  });

  it("charges no ITR below the allowance, so ITR never adds to Revenue", () => {
    const s = summary(matrix({ offer: 100000, acquires: [40000] }), settings);
    // The sheet's (100,000 - 250,000) x 8% would be -12,000 and lift Revenue to 72,000.
    expect(s.itr).toBe(0);
    expect(s.revenue).toBe(60000);
  });

  it("charges no ITR on an offer exactly at the allowance, and taxes one centavo above it", () => {
    expect(summary(matrix({ offer: 250000, acquires: [40000] }), settings).itr).toBe(0);
    // 0.01 x 8% = 0.0008, which rounds to 0.00
    expect(summary(matrix({ offer: 250000.01, acquires: [40000] }), settings).itr).toBe(0);
    expect(summary(matrix({ offer: 250100, acquires: [40000] }), settings).itr).toBe(8);
  });

  it("rounds half away from zero once, on return", () => {
    // 1,000,000.01 / 1.12 = 892,857.1517857... -> 892,857.15
    expect(summary(matrix({ offer: 1000000.01, acquires: [1] }), settings).vatExclusive).toBe(892857.15);
    // 0.5 centavo of tax rounds up: 1,000.25 x 6% = 60.015
    expect(summary(matrix({ offer: 1000.25, acquires: [1] }), settings).tax).toBe(60.02);
  });

  it("says an empty matrix has nothing to add up rather than reading as zero", () => {
    const s = summary({ tenderLines: [], costRows: [] }, settings);
    expect(s.incomplete).toMatchObject({ noTenderLines: true, noCostRows: true, missingOffer: 0, missingCost: 0 });
    expect(s.finalOfferTotal).toBeNull();
    expect(s.revenue).toBeNull();
    const noRows = summary(matrix({ offer: 1000000 }), settings);
    expect(noRows.incomplete.noCostRows).toBe(true);
    expect(noRows.revenue).toBeNull();
  });

  it("checks the matrix against the ABC only when every Tender Line has one", () => {
    const partial = summary(
      {
        tenderLines: [
          { quantity: 1, final_offer_unit: 900, abc_unit: 1000, components: [] },
          { quantity: 1, final_offer_unit: 900, components: [] },
        ],
        costRows: [],
      },
      settings,
    );
    expect(partial.abcTotal).toBeNull();
    expect(partial.percentOfAbc).toBeNull();
    expect(partial.overAbc).toBe(false);
    expect(summary(matrix({ offer: 1100, abc: 1000, acquires: [1] }), settings).overAbc).toBe(true);
  });

  it("carries Marketing and OPEX as typed, blank staying blank", () => {
    expect(summary(matrix({ offer: 1000, acquires: [1], money: { marketing: "12000.50", opex: null } }), settings)).toMatchObject({ marketing: 12000.5, opex: null });
    expect(summary(matrix({ offer: 1000, acquires: [1] }), settings)).toMatchObject({ marketing: null, opex: null });
  });

  it("reads rates that arrive as text, as PostgREST sends numeric columns", () => {
    const text = { vatDivisor: "1.120000", taxRate: "0.060000", retentionRate: "0.010000", itrRate: "0.080000", itrAllowance: "250000.00" };
    expect(summary(matrix({ offer: 3930715, acquires: [1156780] }), text).revenue).toBe(2479477.8);
  });
});

describe("finalAcquireTotal", () => {
  it("adds Final Acquire x quantity, and stays blank while any row has none", () => {
    expect(finalAcquireTotal([{ quantity: 2, final_acquire_unit: 100.25 }, { quantity: 1, final_acquire_unit: 50 }])).toBe(250.5);
    expect(finalAcquireTotal([{ quantity: 2, final_acquire_unit: 100 }, { quantity: 1 }])).toBeNull();
    expect(finalAcquireTotal([])).toBeNull();
    expect(finalAcquireTotal(undefined)).toBeNull();
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

describe("Planned and Actual Revenue (#605)", () => {
  const settings = { vatDivisor: 1.12, taxRate: 0.06, retentionRate: 0.01, itrRate: 0.08, itrAllowance: 250000 };
  const landed = (total, mark = "final") => ({ total, unit: total, mark, blankReason: null });
  const notBought = { total: null, unit: null, mark: null, blankReason: "not_ordered" };

  /** The #229 sample (Final Offer 2,980,000; Final Acquire 2,338,500 -> Revenue 423,100) over two Components and a cost-only row. */
  const sample = ({ a, b, ipasShort } = {}) => ({
    matrix: {
      tenderLines: [
        {
          quantity: 1,
          final_offer_unit: 2980000,
          components: [
            { quantity: 1, final_acquire_unit: 1000000, landed_cost: a },
            { quantity: 2, final_acquire_unit: 500000, landed_cost: b },
          ],
        },
      ],
      costRows: [{ quantity: 1, final_acquire_unit: 338500 }],
    },
    ipasShort,
  });
  const work = (args) => {
    const { matrix, ipasShort } = sample(args);
    return { totals: revenueInputs(matrix, { ipasShort }), result: revenueComparison(revenueInputs(matrix, { ipasShort }), settings) };
  };

  it("Planned Revenue is exactly the summary's Revenue", () => {
    const { matrix } = sample({ a: landed(900000), b: notBought });
    expect(revenueComparison(revenueInputs(matrix), settings).planned).toBe(summary(matrix, settings).revenue);
    expect(summary(matrix, settings).revenue).toBe(423100);
  });

  it("an item nobody has bought counts at Final Acquire, so Actual equals Planned and the count says so", () => {
    const { totals, result } = work({ a: notBought, b: notBought });
    expect(totals).toMatchObject({ finalAcquireTotal: 2338500, landedCostTotal: 0, boughtFinalAcquireTotal: 0, itemsBought: 0, itemsTotal: 2 });
    expect(result).toMatchObject({ planned: 423100, actual: 423100, difference: 0, actualLower: false, estimate: false, itemsBought: 0, notBought: 2 });
    expect(result.actualCost).toBe(2338500);
  });

  it("a bought item takes its Landed Cost in place of its Final Acquire, the rest stays at Final Acquire", () => {
    // A: Landed 900,000 instead of 1,000,000. B (1,000,000 at Final Acquire) and the cost-only row (338,500) stay.
    const { totals, result } = work({ a: landed(900000), b: notBought });
    expect(totals).toMatchObject({ landedCostTotal: 900000, boughtFinalAcquireTotal: 1000000, itemsBought: 1, itemsTotal: 2 });
    expect(result).toMatchObject({ actualCost: 2238500, actual: 523100, planned: 423100, difference: 100000, actualLower: false, notBought: 1 });
  });

  it("highlights when buying cost more than planned: Actual is lower and the difference is negative", () => {
    const { result } = work({ a: landed(1100000), b: landed(1000000) });
    // Landed 2,100,000 against Final Acquire 2,000,000 on the two Components; the 338,500 row is unchanged.
    expect(result).toMatchObject({ actualCost: 2438500, actual: 323100, difference: -100000, actualLower: true, notBought: 0 });
  });

  it("is an estimate while any IPAS is short of LC Odoo Done, and final once none is", () => {
    expect(work({ a: landed(900000), b: notBought, ipasShort: true }).result.estimate).toBe(true);
    expect(work({ a: landed(900000), b: notBought, ipasShort: false }).result.estimate).toBe(false);
  });

  it("a provisional Landed Cost is itself proof of a short IPAS", () => {
    expect(work({ a: landed(900000, "provisional"), b: notBought }).result.estimate).toBe(true);
    expect(work({ a: landed(900000, "final"), b: landed(1000000, "final") }).result.estimate).toBe(false);
  });

  it("never reads a blank as zero: a missing Final Acquire or Final Offer blanks both, a bought item with no Final Acquire blanks Actual", () => {
    const missingCost = { tenderLines: [{ quantity: 1, final_offer_unit: 1000, components: [{ quantity: 1, final_acquire_unit: null }] }] };
    expect(revenueComparison(revenueInputs(missingCost), settings)).toMatchObject({ planned: null, actual: null, difference: null, actualLower: false });
    const noOffer = { tenderLines: [{ quantity: 1, final_offer_unit: null, components: [{ quantity: 1, final_acquire_unit: 5 }] }] };
    expect(revenueComparison(revenueInputs(noOffer), settings)).toMatchObject({ planned: null, actual: null });
    const boughtNoAcquire = {
      tenderLines: [
        {
          quantity: 1,
          final_offer_unit: 3000000,
          components: [
            { quantity: 1, final_acquire_unit: null, landed_cost: landed(10) },
            { quantity: 1, final_acquire_unit: 5 },
          ],
        },
      ],
    };
    const result = revenueComparison(revenueInputs(boughtNoAcquire), settings);
    expect(result.actual).toBeNull();
    expect(result.difference).toBeNull();
  });

  it("works from per-SOR totals alone, so a database row gives the same answer as the shaped matrix", () => {
    const fromRow = revenueComparison(
      { finalOfferTotal: 2980000, finalAcquireTotal: 2338500, landedCostTotal: 900000, boughtFinalAcquireTotal: 1000000, itemsBought: 1, itemsTotal: 2, ipasShort: true },
      settings,
    );
    expect(fromRow).toEqual(work({ a: landed(900000), b: notBought, ipasShort: true }).result);
  });

  it("a blank total in a row is blank in the answer, not zero", () => {
    expect(revenueComparison({ finalOfferTotal: 2980000, finalAcquireTotal: 2338500 }, settings).actual).toBeNull();
    expect(revenueComparison({}, settings)).toMatchObject({ planned: null, actual: null, difference: null, itemsBought: 0, itemsTotal: 0, notBought: 0 });
  });
});
