import { describe, it, expect } from "vitest";
import { summaryLineShown } from "../constants/costing";
import { opexIncomplete, revenueIncomplete, resolveCost, lineCost, abcSettingOf, offerSettingOf, offerTotalCentavos, applyPercentRows, percentOfAbcAmount, projectExpensesTotal, usualRowsToAdd, complianceRollup, componentTotals, costRowsTotals, costRowTotals, describeComplianceRollup, extended, finalAcquireByRule, costUnit, finalAcquireTotal, lineTotals, matrixTotals, offerVsAbc, offersNotEntered, percentOf, revenueComparison, revenueInputs, summary } from "./costingMath";

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
  const matrix = ({ offer, abc, acquires = [], costRows = [{ quantity: 1, final_acquire_unit: 0 }], money = { marketing: 0 } } = {}) => ({
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
      tax: 159642.86,
      retention: 29800,
      collected: 2790557.14,
      itr: 218400,
      landedCost: null,
      opex: null,
      revenue: null,
    });
    expect(s.incomplete).toMatchObject({ missingCost: 1, missingOffer: 0 });
  });

  it("works Collected, ITR and Revenue once every cost is in (#213)", () => {
    const s = summary(matrix({ offer: 3930715, acquires: [1156780] }), settings);
    expect(s).toMatchObject({
      tax: 210574.02,
      retention: 39307.15,
      collected: 3680833.83,
      itr: 294457.2,
      landedCost: 1156780,
      opex: 1196087.15,
      revenue: 2019022.61,
    });
    expect(s.incomplete).toMatchObject({ missingCost: 0, missingOffer: 0 });
  });

  it("matches the #229 sample's ABC check: 93.1% of a 3,200,000 ABC", () => {
    const s = summary(matrix({ offer: 2980000, abc: 3200000, acquires: [2338500] }), settings);
    expect(s.revenue).toBe(74014.29);
    expect(s.percentOfAbc.toFixed(1)).toBe("93.1");
    expect(s.overAbc).toBe(false);
  });

  it("adds the Components of every line into the Landed Cost, and the Other costs rows into Project expenses", () => {
    const s = summary(
      {
        tenderLines: [
          { quantity: 2, final_offer_unit: 500000, components: [{ quantity: 2, final_acquire_unit: 100000 }, { quantity: 1, final_acquire_unit: 50000 }] },
          { quantity: 1, final_offer_unit: 2000000, components: [{ quantity: 1, final_acquire_unit: 900000 }] },
        ],
        costRows: [{ quantity: 1, final_acquire_unit: 25000.5 }],
        money: { marketing: 0 },
      },
      settings,
    );
    expect(s.finalOfferTotal).toBe(3000000);
    expect(s.landedCost).toBe(1150000);
    expect(s.projectExpenses).toBe(25000.5);
    // VAT-exclusive 2,678,571.43 - OPEX (30,000 + 1,150,000 + 25,000.50 + 0) - ITR (2,750,000 x 8% = 220,000)
    expect(s.opex).toBe(1205000.5);
    expect(s.revenue).toBe(1253570.93);
  });

  it("changes every figure with a rate", () => {
    const changed = summary(matrix({ offer: 2980000, acquires: [2338500] }), { ...settings, taxRate: 0.05, itrAllowance: 0, vatDivisor: 1.1 });
    expect(changed).toMatchObject({ vatExclusive: 2709090.91, tax: 135454.55, itr: 238400, revenue: 102390.91 });
  });

  it("works Final VAT from the configured rate on the VAT-exclusive figure (#705)", () => {
    const s = summary(matrix({ offer: 1120000, acquires: [500000] }), { ...settings, vatDivisor: 1.12, finalVatRate: 0.1 });
    expect(s.vatExclusive).toBe(1000000);
    expect(s.finalVat).toBe(100000);
  });

  it("summaryLineShown follows the configured hidden lines (#705)", () => {
    expect(summaryLineShown({ hiddenLines: ["itr"] }, "itr")).toBe(false);
    expect(summaryLineShown({ hiddenLines: ["itr"] }, "tax")).toBe(true);
    expect(summaryLineShown({}, "finalVat")).toBe(false);
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
    expect(s.landedCost).toBe(400000);
  });

  it("counts a Component with no Final Acquire, and keeps the Landed Cost and OPEX blank", () => {
    const s = summary(matrix({ offer: 1000000, acquires: [100, null] }), settings);
    expect(s.incomplete.missingCost).toBe(1);
    expect(s.landedCost).toBeNull();
    expect(s.opex).toBeNull();
    expect(s.revenue).toBeNull();
    expect(s.tax).toBe(53571.43);
  });

  it("charges no ITR below the allowance, so ITR never adds to Revenue", () => {
    const s = summary(matrix({ offer: 100000, acquires: [40000] }), settings);
    // The sheet's (100,000 - 250,000) x 8% would be -12,000 and lift Revenue to 72,000.
    expect(s.itr).toBe(0);
    expect(s.revenue).toBe(48285.71);
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
    // 0.5 centavo of tax rounds up: 1,120.28 / 1.12 x 6% = 60.015
    expect(summary(matrix({ offer: 1120.28, acquires: [1] }), settings).tax).toBe(60.02);
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

  it("carries Marketing as typed, and a blank Marketing blanks OPEX and Revenue with its reason (#964)", () => {
    expect(summary(matrix({ offer: 1000, acquires: [1], money: { marketing: "12000.50" } }), settings)).toMatchObject({ marketing: 12000.5, opex: 12011.5 });
    const blank = summary(matrix({ offer: 1000, acquires: [1], money: { marketing: null } }), settings);
    expect(blank).toMatchObject({ marketing: null, opex: null, revenue: null, revenuePercent: null, underGoLine: false });
    expect(blank.incomplete.noMarketing).toBe(true);
    expect(opexIncomplete(blank.incomplete)).toBe("Incomplete — Marketing not typed");
  });

  it("ignores the old typed OPEX: OPEX is worked out (#964)", () => {
    expect(summary(matrix({ offer: 1000, acquires: [1], money: { marketing: 0, opex: 999999 } }), settings).opex).toBe(11);
  });

  it("a blank Project expenses (no Other costs rows, or one with no amount worked) blanks OPEX and says why (#964)", () => {
    const none = summary(matrix({ offer: 1000000, acquires: [100], costRows: [] }), settings);
    expect(none).toMatchObject({ projectExpenses: null, opex: null, revenue: null });
    expect(none.incomplete.noExpenses).toBe(true);
    expect(revenueIncomplete(none.incomplete)).toBe("Incomplete — no project expenses worked yet");
    const noAmount = summary(matrix({ offer: 1000000, acquires: [100], costRows: [{ quantity: 1, abc_pct: 10, abcMissing: true }] }), settings);
    expect(noAmount.projectExpenses).toBeNull();
    expect(noAmount.revenue).toBeNull();
  });

  describe("the sheet's summary as one case (#964, spec #955)", () => {
    // ABC 371,500; Final Offer 370,000; Final Acquire total 125,104; project expenses 89,160; Marketing 0.
    const sheet = () =>
      summary(
        {
          tenderLines: [{ quantity: 1, final_offer_unit: 370000, abc_unit: 371500, components: [{ quantity: 1, final_acquire_unit: 125104 }] }],
          costRows: [
            { quantity: 1, final_acquire_unit: 60000 },
            { quantity: 1, final_acquire_unit: 29160 },
          ],
          money: { marketing: 0 },
        },
        settings,
      );

    it("gives every line of the sheet's table", () => {
      expect(sheet()).toMatchObject({
        vatExclusive: 330357.14,
        tax: 19821.43,
        retention: 3700,
        collected: 346478.57,
        landedCost: 125104,
        projectExpenses: 89160,
        marketing: 0,
        opex: 217964,
        itr: 9600,
        revenue: 102793.14,
        revenuePercent: 27.78,
      });
    });

    it("sits above the 20% Go line, and a higher line puts it under (a warning only)", () => {
      expect(sheet()).toMatchObject({ goLinePercent: 20, underGoLine: false });
      const m = {
        tenderLines: [{ quantity: 1, final_offer_unit: 370000, components: [{ quantity: 1, final_acquire_unit: 125104 }] }],
        costRows: [{ quantity: 1, final_acquire_unit: 89160 }],
        money: { marketing: 0 },
      };
      expect(summary(m, { ...settings, goLinePercent: 30 })).toMatchObject({ goLinePercent: 30, underGoLine: true });
      expect(summary(m, { ...settings, goLinePercent: 27.78 }).underGoLine).toBe(false);
    });

    it("Planned Revenue is the same figure, and Actual swaps in the Landed Cost of what was bought", () => {
      const m = {
        tenderLines: [{ quantity: 1, final_offer_unit: 370000, components: [{ quantity: 1, final_acquire_unit: 125104, landed_cost: { total: 130104, unit: 130104, mark: "final" } }] }],
        costRows: [{ quantity: 1, final_acquire_unit: 89160 }],
        money: { marketing: 0 },
      };
      const result = revenueComparison(revenueInputs(m), settings);
      expect(result).toMatchObject({ planned: 102793.14, actual: 97793.14, difference: -5000, plannedPercent: 27.78, plannedCost: 125104, actualCost: 130104 });
    });
  });

  it("reads rates that arrive as text, as PostgREST sends numeric columns", () => {
    const text = { vatDivisor: "1.120000", taxRate: "0.060000", retentionRate: "0.010000", itrRate: "0.080000", itrAllowance: "250000.00" };
    expect(summary(matrix({ offer: 3930715, acquires: [1156780] }), text).revenue).toBe(2019022.61);
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

describe("offersNotEntered (#906)", () => {
  it("lists each Component whose We offer is blank, in line order, with its number and name", () => {
    const tenderLines = [
      {
        tender_specification: "Rescue tripod",
        components: [
          { id: "c1", number: "1.1", name: "Tripod", offer_specification: "Tripod 3 m" },
          { id: "c2", number: "1.2", name: "Bag", offer_specification: null },
        ],
      },
      { tender_specification: "Stretcher", components: [{ id: "c3", number: "2.1", name: "", offer_specification: "Stretcher 200 kg" }, { id: "c4", number: "2.2", name: "", offer_specification: "" }] },
    ];
    expect(offersNotEntered(tenderLines)).toEqual([
      { id: "c2", number: "1.2", label: "Bag" },
      { id: "c4", number: "2.2", label: "Stretcher" },
    ]);
  });

  it("counts spaces only as not entered", () => {
    const tenderLines = [{ tender_specification: "Harness", components: [{ id: "c1", number: "1.1", name: "Harness", offer_specification: "   \n " }] }];
    expect(offersNotEntered(tenderLines)).toEqual([{ id: "c1", number: "1.1", label: "Harness" }]);
  });

  it("lists nothing when every Component has a We offer", () => {
    expect(offersNotEntered([{ components: [{ id: "c1", number: "1.1", offer_specification: "Full body" }] }])).toEqual([]);
  });

  it("does not list a line that has no Components", () => {
    expect(offersNotEntered([{ tender_specification: "Empty line", components: [] }])).toEqual([]);
  });

  it("is empty for no lines", () => {
    expect(offersNotEntered([])).toEqual([]);
    expect(offersNotEntered(undefined)).toEqual([]);
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
      money: { marketing: 0 },
    },
    ipasShort,
  });
  it("counts a Component with a Purchased or Received line as bought, though it has no Landed Cost (#791)", () => {
    const matrix = {
      tenderLines: [
        {
          quantity: 1,
          final_offer_unit: 100,
          components: [
            { quantity: 1, final_acquire_unit: 10, landed_cost: notBought, purchases: { requests: [{ status: "received" }] } },
            { quantity: 1, final_acquire_unit: 10, landed_cost: notBought, purchases: { requests: [{ status: "purchased" }] } },
            { quantity: 1, final_acquire_unit: 10, landed_cost: notBought, purchases: { requests: [{ status: "still_canvassing" }] } },
          ],
        },
      ],
      costRows: [],
    };
    const totals = revenueInputs(matrix);
    expect(totals.itemsBought).toBe(2);
    expect(totals.itemsTotal).toBe(3);
    expect(totals.landedCostTotal).toBe(0);
  });

  const work = (args) => {
    const { matrix, ipasShort } = sample(args);
    return { totals: revenueInputs(matrix, { ipasShort }), result: revenueComparison(revenueInputs(matrix, { ipasShort }), settings) };
  };

  it("Planned Revenue is exactly the summary's Revenue", () => {
    const { matrix } = sample({ a: landed(900000), b: notBought });
    expect(revenueComparison(revenueInputs(matrix), settings).planned).toBe(summary(matrix, settings).revenue);
    expect(summary(matrix, settings).revenue).toBe(74014.29);
  });

  it("an item nobody has bought counts at Final Acquire, so Actual equals Planned and the count says so", () => {
    const { totals, result } = work({ a: notBought, b: notBought });
    expect(totals).toMatchObject({ finalAcquireTotal: 2000000, projectExpensesTotal: 338500, marketing: 0, landedCostTotal: 0, boughtFinalAcquireTotal: 0, itemsBought: 0, itemsTotal: 2 });
    expect(result).toMatchObject({ planned: 74014.29, actual: 74014.29, difference: 0, actualLower: false, estimate: false, itemsBought: 0, notBought: 2 });
    expect(result.actualCost).toBe(2000000);
  });

  it("a bought item takes its Landed Cost in place of its Final Acquire, the rest stays at Final Acquire", () => {
    // A: Landed 900,000 instead of 1,000,000. B (1,000,000 at Final Acquire) stays; Project expenses (338,500) are the same for both.
    const { totals, result } = work({ a: landed(900000), b: notBought });
    expect(totals).toMatchObject({ landedCostTotal: 900000, boughtFinalAcquireTotal: 1000000, itemsBought: 1, itemsTotal: 2 });
    expect(result).toMatchObject({ actualCost: 1900000, actual: 174014.29, planned: 74014.29, difference: 100000, actualLower: false, notBought: 1 });
  });

  it("highlights when buying cost more than planned: Actual is lower and the difference is negative", () => {
    const { result } = work({ a: landed(1100000), b: landed(1000000) });
    // Landed 2,100,000 against Final Acquire 2,000,000 on the two Components; Project expenses are unchanged.
    expect(result).toMatchObject({ actualCost: 2100000, actual: -25985.71, difference: -100000, actualLower: true, notBought: 0 });
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
      { finalOfferTotal: 2980000, finalAcquireTotal: 2000000, projectExpensesTotal: 338500, marketing: 0, landedCostTotal: 900000, boughtFinalAcquireTotal: 1000000, itemsBought: 1, itemsTotal: 2, ipasShort: true },
      settings,
    );
    expect(fromRow).toEqual(work({ a: landed(900000), b: notBought, ipasShort: true }).result);
  });

  it("a blank total in a row is blank in the answer, not zero", () => {
    expect(revenueComparison({ finalOfferTotal: 2980000, finalAcquireTotal: 2000000, projectExpensesTotal: 338500, marketing: 0 }, settings).actual).toBeNull();
    expect(revenueComparison({}, settings)).toMatchObject({ planned: null, actual: null, difference: null, itemsBought: 0, itemsTotal: 0, notBought: 0 });
  });
});

describe("the Actual cost wins in the totals (#686)", () => {
  it("uses the P0 price when there is one, else Acquire, and leaves Acquire as typed", () => {
    const component = { quantity: 2, acquire_unit: 100, p0_unit_price: 120 };
    expect(componentTotals(component).acquireTotal).toBe(240);
    expect(component.acquire_unit).toBe(100);
    expect(componentTotals({ quantity: 2, acquire_unit: 100, p0_unit_price: null }).acquireTotal).toBe(200);
    expect(componentTotals({ quantity: 2, p0_unit_price: 50 }).acquireTotal).toBe(100);
    expect(lineTotals({ quantity: 1 }, [component, { quantity: 1, acquire_unit: 10 }]).acquireTotal).toBe(250);
  });
});

describe("offerVsAbc (#942)", () => {
  it("is low when the offer total is under 50% of the ABC total, and lists the low lines", () => {
    const r = offerVsAbc([
      { id: "a", number: "1", tender_specification: "Pump", quantity: 2, abc_unit: 1000, final_offer_unit: 200 },
      { id: "b", number: "2", tender_specification: "Hose", quantity: 1, abc_unit: 100, final_offer_unit: 90 },
    ]);
    expect(r.low).toBe(true);
    expect(r.percent).toBe(23);
    expect(r.lines).toEqual([{ id: "a", number: "1", name: "Pump", percent: 20 }]);
  });

  it("is not low at exactly 50%, and lists no line at 50%", () => {
    const r = offerVsAbc([{ id: "a", quantity: 1, abc_unit: 1000, final_offer_unit: 500 }]);
    expect(r.low).toBe(false);
    expect(r.lines).toEqual([]);
  });

  it("does not warn on totals while an ABC is blank, but still lists lines it can judge", () => {
    const r = offerVsAbc([
      { id: "a", quantity: 1, abc_unit: 1000, final_offer_unit: 100 },
      { id: "b", quantity: 1, abc_unit: null, final_offer_unit: 100 },
    ]);
    expect(r.low).toBe(false);
    expect(r.lines.map((l) => l.id)).toEqual(["a"]);
    expect(offerVsAbc([]).low).toBe(false);
  });
});

describe("a row costed by Acquire only (#787)", () => {
  const matrix = {
    tenderLines: [{ quantity: 1, final_offer_unit: "100.00", components: [{ quantity: 2, acquire_unit: "10.00", final_acquire_unit: null }] }],
    costRows: [{ quantity: 1, acquire_unit: "5.00" }],
  };
  it("counts as costed in the summary, not as missing", () => {
    const { incomplete } = summary(matrix, {});
    expect(incomplete.missingCost).toBe(0);
    expect(incomplete.noCostRows).toBe(false);
  });
  it("still prefers an old deal's Final Acquire", () => {
    const m = { ...matrix, costRows: [{ quantity: 1, acquire_unit: "5.00", final_acquire_unit: "7.00" }] };
    expect(finalAcquireTotal(m.costRows)).toBe(finalAcquireTotal([{ quantity: 1, final_acquire_unit: "7.00" }]));
  });
});

describe("the Odoo SRP is a figure, never a cost (#961)", () => {
  it("totals SRP unit x quantity per Component and sums a line and the Other costs", () => {
    expect(componentTotals({ quantity: 3, odoo_unit: 1250.5 }).odooTotal).toBe(3751.5);
    expect(costRowsTotals([{ quantity: 2, odoo_unit: 100 }, { quantity: 1, odoo_unit: 50.25 }]).odooTotal).toBe(250.25);
  });

  it("keeps a blank SRP blank, never zero", () => {
    expect(componentTotals({ quantity: 3, odoo_unit: null }).odooTotal).toBeNull();
    expect(costRowsTotals([{ quantity: 2, odoo_unit: 100 }, { quantity: 1 }]).odooTotal).toBeNull();
  });

  it("resolveCost does not fall back to the SRP", () => {
    expect(resolveCost({ odoo_unit: 500 })).toBeNull();
    expect(resolveCost({ acquire_unit: null, odoo_unit: 500, acquire_source: "odoo" })).toBeNull();
  });

  it("resolveCost still reads an Acquire filled from Odoo's cost, not the SRP", () => {
    expect(resolveCost({ acquire_unit: 400, acquire_source: "odoo", odoo_unit: 500 })).toMatchObject({ source: "odoo", pesos: 400 });
  });

  it("lineCost is null while a part has only an SRP", () => {
    expect(lineCost({ quantity: 1, components: [{ quantity: 1, odoo_unit: 500 }] })).toBeNull();
    expect(lineCost({ quantity: 1, components: [{ quantity: 1, acquire_unit: 400, acquire_source: "typed", odoo_unit: 500 }] })).toMatchObject({ pesos: 400 });
  });
});

describe("ABC typed as one total (#960)", () => {
  const lines = [
    { id: "a", quantity: 2, abc_unit: 1000, final_offer_unit: 400 },
    { id: "b", quantity: 1, abc_unit: 500, final_offer_unit: 100 },
  ];
  const totalOnly = (total) => ({ mode: "total_only", total });

  it("By line is unchanged and ignores a typed total", () => {
    const t = matrixTotals(lines, { mode: "by_line", total: 99 });
    expect(t).toMatchObject({ abcTotal: 2500, missingAbc: 0, overAbc: false });
    expect(matrixTotals(lines, null)).toEqual(matrixTotals(lines));
  });

  it("Total only uses the typed total, not the lines", () => {
    const t = matrixTotals(lines, totalOnly(800));
    expect(t.abcTotal).toBe(800);
    expect(t.finalOfferTotal).toBe(900);
    expect(t.overAbc).toBe(true);
    expect(t.percentOfAbc).toBe(112.5);
    expect(t.missingAbc).toBe(0);
  });

  it("Total only needs no per-line ABC", () => {
    const bare = lines.map(({ abc_unit: _a, ...rest }) => rest);
    expect(matrixTotals(bare, totalOnly(10000)).abcTotal).toBe(10000);
    expect(matrixTotals(bare).abcTotal).toBeNull();
  });

  it("is over the ABC at one centavo", () => {
    expect(matrixTotals(lines, totalOnly(900)).overAbc).toBe(false);
    expect(matrixTotals(lines, totalOnly(899.99)).overAbc).toBe(true);
  });

  it("a blank total is never zero", () => {
    for (const blank of [null, undefined, ""]) {
      const t = matrixTotals(lines, totalOnly(blank));
      expect(t.abcTotal).toBeNull();
      expect(t.overAbc).toBe(false);
      expect(t.percentOfAbc).toBeNull();
      expect(t.missingAbc).toBe(1);
    }
    expect(matrixTotals(lines, totalOnly(0)).abcTotal).toBe(0);
  });

  it("the summary and the whole-offer warning use the typed total; the per-line warning is hidden", () => {
    const farBelow = [{ id: "a", number: 1, quantity: 1, abc_unit: 1000, final_offer_unit: 100 }];
    const byLine = offerVsAbc(farBelow);
    expect(byLine.lines).toHaveLength(1);
    const typed = offerVsAbc(farBelow, totalOnly(1000));
    expect(typed.lines).toEqual([]);
    expect(typed.low).toBe(true);
    expect(typed.percent).toBe(10);
    expect(offerVsAbc(farBelow, totalOnly(null)).low).toBe(false);

    const s = summary({ tenderLines: lines, costRows: [], abc: totalOnly(800) }, { vatDivisor: 1.12 });
    expect(s.abcTotal).toBe(800);
    expect(s.overAbc).toBe(true);
  });

  it("reads the setting off a matrix row", () => {
    expect(abcSettingOf({ abc_mode: "total_only", abc_total: "1500.50" })).toEqual({ mode: "total_only", total: 1500.5 });
    expect(abcSettingOf({ abc_mode: "by_line", abc_total: null })).toEqual({ mode: "by_line", total: null });
    expect(abcSettingOf({ id: 1 })).toBeNull();
    expect(abcSettingOf(null)).toBeNull();
  });
});

describe("project expenses as a percent of the ABC (#963)", () => {
  const abc = 371500;
  const row = (category, pct, extra = {}) => ({ category_key: category, quantity: 1, abc_pct: pct, acquire_unit: null, ...extra });
  const sheet = [row("labor", 10), row("logistics", 7), row("permits", 2), row("overhead", 5)];

  it("works a percent as a share of the ABC, to the centavo", () => {
    expect(percentOfAbcAmount(10, abc)).toBe(37150);
    expect(percentOfAbcAmount(7, abc)).toBe(26005);
    expect(percentOfAbcAmount(2, abc)).toBe(7430);
    expect(percentOfAbcAmount(5, abc)).toBe(18575);
    expect(percentOfAbcAmount(0.01, 1)).toBe(0);
    expect(percentOfAbcAmount(33.33, 100.5)).toBe(33.5);
  });

  it("totals the sheet's figures to 89,160", () => {
    const rows = applyPercentRows(sheet, abc);
    expect(rows.map((r) => r.abcAmount)).toEqual([37150, 26005, 7430, 18575]);
    expect(projectExpensesTotal(rows)).toBe(89160);
  });

  it("counts Equipment & Tools in the total", () => {
    const rows = applyPercentRows([...sheet, row("equipment", 3)], abc);
    expect(projectExpensesTotal(rows)).toBe(89160 + 11145);
  });

  it("adds a peso row typed by hand beside the percent rows", () => {
    const rows = applyPercentRows([...sheet, row("equipment", null, { acquire_unit: 500, quantity: 2 })], abc);
    expect(projectExpensesTotal(rows)).toBe(89160 + 1000);
  });

  it("follows the ABC when it changes", () => {
    expect(projectExpensesTotal(applyPercentRows(sheet, 400000))).toBe(96000);
  });

  it("a blank ABC leaves a percent row blank, never zero, and the total unknown", () => {
    for (const unknown of [null, undefined, ""]) {
      const rows = applyPercentRows(sheet, unknown);
      expect(rows.every((r) => r.abcAmount === null && r.abcMissing === true && r.acquire_unit === null)).toBe(true);
      expect(projectExpensesTotal(rows)).toBeNull();
    }
  });

  it("skips a row with nothing typed, and leaves a row without a percent untouched", () => {
    const blank = row("labor", null);
    const typed = row("overhead", null, { acquire_unit: 250 });
    const rows = applyPercentRows([blank, typed], abc);
    expect(rows[0]).toBe(blank);
    expect(rows[1]).toBe(typed);
    expect(projectExpensesTotal(rows)).toBe(250);
    expect(projectExpensesTotal([])).toBeNull();
  });

  it("a percent row counts its worked amount, not a Final cost left on it", () => {
    const rows = applyPercentRows([row("labor", 10, { final_acquire_unit: 1 })], abc);
    expect(rows[0].final_acquire_unit).toBeNull();
    expect(projectExpensesTotal(rows)).toBe(37150);
  });

  it("names the usual categories no row has yet", () => {
    const keys = ["labor", "logistics", "equipment", "permits", "overhead"];
    expect(usualRowsToAdd([], keys)).toEqual(keys);
    expect(usualRowsToAdd([{ category_key: "labor" }, { category_key: "overhead" }], keys)).toEqual(["logistics", "equipment", "permits"]);
    expect(usualRowsToAdd([{ category_key: "labor" }], ["labor"])).toEqual([]);
  });
});

describe("Final Acquire by the rule (#962)", () => {
  const stock = (odoo, extra = {}) => ({ tender_line_id: "t", status: "stockable", odoo_unit: odoo, quantity: 1, ...extra });

  it("works the sheet's rows: Odoo x 0.8 on a Stockable line", () => {
    expect(finalAcquireByRule(stock(49800))).toBe(39840);
    expect(finalAcquireByRule(stock(9980))).toBe(7984);
    const rows = [stock(49800), stock(9980, { quantity: 3 }), stock(76640)];
    for (const row of rows) row.final_acquire_unit = finalAcquireByRule(row);
    expect(extended(rows[1].final_acquire_unit, 3)).toBe(23952);
    expect(finalAcquireTotal(rows)).toBe(125104);
  });

  it("takes the line's own percent over the evaluation's, and the evaluation's over the starting -20", () => {
    expect(finalAcquireByRule(stock(1000), -10)).toBe(900);
    expect(finalAcquireByRule(stock(1000, { final_acquire_percent: 5 }), -10)).toBe(1050);
    expect(finalAcquireByRule(stock(1000, { final_acquire_percent: "0" }), -10)).toBe(1000);
    expect(finalAcquireByRule(stock(1000, { final_acquire_percent: null }))).toBe(800);
  });

  it("rounds half away from zero to the centavo", () => {
    expect(finalAcquireByRule(stock(0.05), -50)).toBe(0.03);
    expect(finalAcquireByRule(stock(33.33), -20)).toBe(26.66);
    expect(finalAcquireByRule(stock(10.01), 12.5)).toBe(11.26);
  });

  it("gives a Source Out line its Acquire as is, with no percent, the attached P0's price first", () => {
    const out = { status: "source_out", odoo_unit: 5000, acquire_unit: 4000, final_acquire_percent: -50 };
    expect(finalAcquireByRule(out, -20)).toBe(4000);
    expect(finalAcquireByRule({ ...out, p0_unit_price: 3900.5 }, -20)).toBe(3900.5);
  });

  it("is blank, never zero, while an input is blank or the Status is not picked", () => {
    expect(finalAcquireByRule({ odoo_unit: 49800 })).toBeNull();
    expect(finalAcquireByRule({ status: null, odoo_unit: 49800, acquire_unit: 100 })).toBeNull();
    expect(finalAcquireByRule(stock(null))).toBeNull();
    expect(finalAcquireByRule(stock(""))).toBeNull();
    expect(finalAcquireByRule({ status: "source_out", odoo_unit: 5000 })).toBeNull();
    expect(finalAcquireByRule(stock(0))).toBe(0);
  });

  it("counts a typed value as it stands, and never moves it when the inputs move", () => {
    // A typed value is the stored one; the rule is only what the database fills when nothing was typed.
    const typed = stock(49800, { final_acquire_unit: 41000, final_acquire_typed: true });
    expect(costUnit(typed)).toBe(41000);
    expect(finalAcquireByRule({ ...typed, odoo_unit: 60000 })).toBe(48000);
    expect(costUnit({ ...typed, odoo_unit: 60000 })).toBe(41000);
  });

  it("makes the total unknown, never smaller, when any Component has no Final Acquire", () => {
    const filled = stock(49800, { final_acquire_unit: 39840 });
    const blank = stock(1000, { acquire_unit: 900, final_acquire_unit: null });
    expect(finalAcquireTotal([filled])).toBe(39840);
    expect(finalAcquireTotal([filled, blank])).toBeNull();
    expect(costUnit(blank)).toBeNull();
  });

  it("lets a cost-only row (no Status) keep its Acquire when it has no Final Acquire", () => {
    expect(costUnit({ matrix_id: "m", acquire_unit: 900, final_acquire_unit: null })).toBe(900);
    expect(finalAcquireTotal([{ matrix_id: "m", quantity: 2, acquire_unit: 900 }])).toBe(1800);
  });
});

describe("the Final Offer as one total (the sheet's way)", () => {
  // The sheet (docs/gsheet/…FloridaBlanca…): every line's own offer is 0.00 and Y14 = 370,000 is typed once.
  const part = (q, fa) => ({ tender_line_id: "t", quantity: q, final_acquire_unit: fa });
  const lines = [
    { quantity: 1, abc_unit: null, final_offer_unit: null, components: [part(1, 39840), part(3, 7984), part(1, 5344), part(1, 7040)] },
    { quantity: 2, abc_unit: null, final_offer_unit: null, components: [part(2, 13440), part(2, 7984), part(2, 3040)] },
  ];
  const abc = { mode: "total_only", total: 371500 };
  const offer = { mode: "total_only", total: 370000 };
  const settings = { vatDivisor: 1.12, taxRate: 0.06, retentionRate: 0.01, itrRate: 0.08, itrAllowance: 250000, goLinePercent: 20 };

  it("reads the setting from the matrix row, or nothing when the tier was not sent it", () => {
    expect(offerSettingOf({ offer_mode: "total_only", offer_total: "370000.00" })).toEqual(offer);
    expect(offerSettingOf({ offer_mode: "by_line", offer_total: null })).toEqual({ mode: "by_line", total: null });
    expect(offerSettingOf({ abc_mode: "by_line" })).toBeNull();
  });

  it("takes the typed total and sets the lines' own offers aside; a blank total is one thing missing", () => {
    expect(offerTotalCentavos(lines, offer)).toEqual({ offer: 37000000n, missing: 0 });
    expect(offerTotalCentavos(lines, { mode: "total_only", total: null })).toEqual({ offer: null, missing: 1 });
    expect(offerTotalCentavos([], offer)).toEqual({ offer: null, missing: 0 });
    // By line, as before: a blank line offer blanks the total.
    expect(offerTotalCentavos(lines, null)).toEqual({ offer: null, missing: 2 });
  });

  it("gives matrixTotals the typed offer against the typed ABC", () => {
    const totals = matrixTotals(lines, abc, offer);
    expect(totals.finalOfferTotal).toBe(370000);
    expect(totals.missingOffer).toBe(0);
    expect(totals.overAbc).toBe(false);
    expect(totals.percentOfAbc).toBeCloseTo(99.6, 1);
    expect(matrixTotals(lines, abc, { mode: "total_only", total: 380000 }).overAbc).toBe(true);
  });

  it("works the sheet's summary to the centavo: Revenue 102,793.14, 27.78%", () => {
    const costRows = [{ quantity: 1, acquire_unit: 37150 }, { quantity: 1, acquire_unit: 26005 }, { quantity: 1, acquire_unit: 7430 }, { quantity: 1, acquire_unit: 18575 }];
    const s = summary({ tenderLines: lines, costRows, money: { marketing: 0 }, abc, offer }, settings);
    expect(s.finalOfferTotal).toBe(370000);
    expect(s.vatExclusive).toBe(330357.14);
    expect(s.landedCost).toBe(125104);
    expect(s.projectExpenses).toBe(89160);
    expect(s.opex).toBe(217964);
    expect(s.itr).toBe(9600);
    expect(s.revenue).toBe(102793.14);
    expect(s.revenuePercent).toBeCloseTo(27.78, 2);
    expect(s.incomplete.missingOffer).toBe(0);
  });

  it("drops the per-line low-offer warning when the offer is one total", () => {
    const byLine = [{ id: "a", number: 1, quantity: 1, abc_unit: 1000, final_offer_unit: 100 }];
    expect(offerVsAbc(byLine, null, null).lines).toHaveLength(1);
    expect(offerVsAbc(byLine, null, { mode: "total_only", total: 900 }).lines).toHaveLength(0);
  });
});
