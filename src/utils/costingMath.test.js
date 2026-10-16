import { describe, it, expect } from "vitest";
import { componentTotals, costRowsTotals, costRowTotals, extended, lineTotals, matrixTotals, percentOf, summary } from "./costingMath";

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
      finalAcquireTotal: null,
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
      finalAcquireTotal: null,
    });
    expect(lineTotals({ quantity: 2, abc_unit: null, final_offer_unit: 5 })).toEqual({
      abcTotal: null,
      finalOfferTotal: 10,
      overAbc: false,
      percentOfAbc: null,
      acquireTotal: null,
      odooTotal: null,
      finalAcquireTotal: null,
    });
    expect(lineTotals({ quantity: 2 })).toEqual({
      abcTotal: null,
      finalOfferTotal: null,
      overAbc: false,
      percentOfAbc: null,
      acquireTotal: null,
      odooTotal: null,
      finalAcquireTotal: null,
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
    expect(componentTotals({ quantity: 4, acquire_unit: 25.5, odoo_unit: 30 })).toEqual({ acquireTotal: 102, odooTotal: 120, finalAcquireTotal: null });
    expect(costRowTotals({ quantity: 1, acquire_unit: 100000 })).toEqual({ acquireTotal: 100000, odooTotal: null, finalAcquireTotal: null });
    expect(componentTotals(undefined)).toEqual({ acquireTotal: null, odooTotal: null, finalAcquireTotal: null });
  });

  it("keeps cost-only rows out of a Tender Line's totals and adds them up on their own", () => {
    const rows = [
      { quantity: 1, acquire_unit: 100000, odoo_unit: 110000 },
      { quantity: 2, acquire_unit: 5000, odoo_unit: 6000 },
    ];
    expect(costRowsTotals(rows)).toEqual({ acquireTotal: 110000, odooTotal: 122000, finalAcquireTotal: null });
    expect(costRowsTotals([...rows, { quantity: 1, odoo_unit: 1 }]).acquireTotal).toBeNull();
    expect(costRowsTotals([])).toEqual({ acquireTotal: null, odooTotal: null, finalAcquireTotal: null });
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

  it("follows the sheet's ITR literally: negative below the allowance", () => {
    const s = summary(matrix({ offer: 100000, acquires: [40000] }), settings);
    // (100,000 - 250,000) x 8% = -12,000, and Revenue is (100,000 - 40,000) - (-12,000)
    expect(s.itr).toBe(-12000);
    expect(s.revenue).toBe(72000);
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
