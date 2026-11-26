import { describe, expect, it } from "vitest";
import { NO_EDITS, applyEdits, groupTotals, parseTyped, reportSummary } from "./opexReport";

// Hand edits over an Odoo read (#1245). Made-up figures only.
const read = {
  lines: [
    { lineId: 1, p0: "P1", quantity: 2, sharePercent: 50, pesos: 0, countedPesos: 0, marks: ["zero price"] },
    { lineId: 2, p0: "P2", quantity: 1, sharePercent: 100, pesos: 100, countedPesos: 100, marks: [] },
  ],
  expenses: [
    { analyticLineId: 10, amount: 40, group: "operation_admin" },
    { analyticLineId: 11, amount: 60, group: "marketing" },
  ],
};

describe("applyEdits", () => {
  it("counts a typed price as unit price x quantity x share and marks it typed", () => {
    const view = applyEdits(read, { ...NO_EDITS, linePrices: [{ id: "a", odoo_line_id: 1, unit_price: 30 }] });
    expect(view.lines[0].countedPesos).toBe(30);
    expect(view.lines[0].marks).toEqual(["typed"]);
    expect(groupTotals(view).productCost).toBe(130);
  });

  it("leaves an expense on the list but out of the totals", () => {
    const view = applyEdits(read, { ...NO_EDITS, leftOut: [{ id: "a", analytic_line_id: 10, note: "x" }] });
    expect(view.expenses[0].leftOut).toBe(true);
    expect(groupTotals(view).operationAdmin).toBe(0);
    expect(groupTotals(view).marketing).toBe(60);
  });

  it("files a Typed cost under its group", () => {
    const view = applyEdits(read, {
      ...NO_EDITS,
      typedCosts: [
        { id: "a", amount: "25.5", cost_group: "operation_admin" },
        { id: "b", amount: 5, cost_group: "product" },
      ],
    });
    expect(groupTotals(view)).toEqual({ productCost: 105, operationAdmin: 65.5, marketing: 60 });
  });

  it("returns an edit for a line Odoo no longer has as an orphan that never counts", () => {
    const view = applyEdits(read, {
      ...NO_EDITS,
      linePrices: [{ id: "a", odoo_line_id: 99, unit_price: 5 }],
      leftOut: [{ id: "b", analytic_line_id: 98 }],
      handP0s: [
        { id: "c", p0_number: "P2" },
        { id: "d", p0_number: "P404" },
      ],
    });
    expect(view.orphans.linePrices).toHaveLength(1);
    expect(view.orphans.leftOut).toHaveLength(1);
    expect(view.handP0s.map((h) => h.missing)).toEqual([false, true]);
    expect(groupTotals(view).productCost).toBe(100);
  });
});

describe("reportSummary with typed figures", () => {
  const settings = { vatDivisor: 1.12, taxRate: 0.06, retentionRate: 0.01, itrRate: 0.08, itrAllowance: 250000 };
  const odoo = { odooContractPrice: 100000, lines: [], expenses: [] };

  it("keeps a typed zero retention apart from a blank one", () => {
    expect(reportSummary(odoo, { retention: 0 }, settings).retention).toBe(0);
    expect(reportSummary(odoo, { retention: null }, settings).retention).toBe(1000);
  });

  it("uses a typed Contract price over Odoo's, and Odoo's again when cleared", () => {
    expect(reportSummary(odoo, { contract_price: 50000, retention: null }, settings).retention).toBe(500);
    expect(reportSummary(odoo, { contract_price: null, retention: null }, settings).retention).toBe(1000);
  });
});

describe("parseTyped", () => {
  it("reads blank as null and zero as zero", () => {
    expect(parseTyped("")).toBeNull();
    expect(parseTyped("0")).toBe(0);
    expect(parseTyped("1,250.50")).toBe(1250.5);
    expect(Number.isNaN(parseTyped("abc"))).toBe(true);
  });
});
