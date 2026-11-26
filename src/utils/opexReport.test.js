import { describe, expect, it } from "vitest";
import { summary } from "./costingMath";
import { contractPriceOf, groupTotals, normalizeS0, reportSummary } from "./opexReport";

// Made-up figures only.
const settings = { vatDivisor: 1.12, taxRate: 0.06, retentionRate: 0.01, itrRate: 0.08, itrAllowance: 250000 };

const read = {
  odooContractPrice: 1_000_000,
  lines: [
    { countedPesos: 300_000 },
    { countedPesos: 0 },
    { countedPesos: 100_000.5 },
  ],
  expenses: [
    { amount: 10_000, group: "operation_admin" },
    { amount: 5_000.25, group: "operation_admin" },
    { amount: 2_000, group: "marketing" },
  ],
};

describe("groupTotals", () => {
  it("adds counted P0 pesos and the two expense groups", () => {
    expect(groupTotals(read)).toEqual({ productCost: 400_000.5, operationAdmin: 15_000.25, marketing: 2_000 });
  });
});

describe("reportSummary", () => {
  it("matches the S0 Evaluation's maths for the same figures", () => {
    const { productCost, operationAdmin, marketing } = groupTotals(read);
    const plan = summary(
      {
        tenderLines: [{ quantity: 1, final_offer_unit: 1_000_000, components: [{ quantity: 1, final_acquire_unit: productCost }] }],
        costRows: [{ quantity: 1, final_acquire_unit: operationAdmin }],
        money: { marketing },
      },
      settings,
    );
    const actual = reportSummary(read, null, settings);
    expect(actual).toMatchObject({
      vatExclusive: plan.vatExclusive,
      tax: plan.tax,
      retention: plan.retention,
      collected: plan.collected,
      itr: plan.itr,
      actualOpex: plan.opex,
      revenue: plan.revenue,
      revenuePercent: plan.revenuePercent,
    });
  });

  it("uses Finance's typed Contract price and retention when set", () => {
    const out = reportSummary(read, { contract_price: 2_000_000, retention: 500 }, settings);
    expect(out.contractPrice).toBe(2_000_000);
    expect(out.retention).toBe(500);
    expect(out.actualOpex).toBe(500 + 400_000.5 + 15_000.25 + 2_000);
  });

  it("never turns a blank into zero", () => {
    const blank = reportSummary({ ...read, odooContractPrice: null }, null, settings);
    expect(blank.contractPrice).toBeNull();
    expect(blank.revenue).toBeNull();
    expect(blank.revenuePercent).toBeNull();
    expect(contractPriceOf({ odooContractPrice: null }, null)).toBeNull();
  });
});

describe("normalizeS0", () => {
  it("reads a typed S0", () => {
    expect(normalizeS0(" s06637 ")).toBe("S06637");
    expect(normalizeS0("P02079")).toBeNull();
    expect(normalizeS0("")).toBeNull();
  });
});
