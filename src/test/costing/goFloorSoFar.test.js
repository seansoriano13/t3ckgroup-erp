import { describe, expect, it } from "vitest";
import { goFloor, goFloorSoFar } from "../../components/costing/desk/corridor/goFloor";

const rates = { vatDivisor: 1.12, retentionRate: 0.01, itrRate: 0.08, itrAllowance: 0, goLinePercent: 20 };
const lot = (amount) => ({ acquire_unit: amount, quantity: 1 });
const unworked = { abc_pct: 5, acquire_unit: null, quantity: 1 };

describe("goFloorSoFar (#1036)", () => {
  it("with Other costs blank counts what is known and says how many are missing", () => {
    const r = goFloorSoFar({ productCost: 100000, costRows: [], missingUsual: 5, marketing: null, rates });
    expect(r.partial).toBe(true);
    expect(r.uncounted).toBe(6);
    expect(r.floor).toBe(goFloor(100000, rates));
  });

  it("a row that cannot be worked does not drop the other typed costs", () => {
    const withUnworked = goFloorSoFar({ productCost: 100000, costRows: [lot(5000), unworked], missingUsual: 0, marketing: 1000, rates });
    expect(withUnworked.uncounted).toBe(1);
    expect(withUnworked.floor).toBe(goFloor(106000, rates));
  });

  it("is complete when every cost is known", () => {
    const r = goFloorSoFar({ productCost: 100000, costRows: [lot(5000), lot(2000)], missingUsual: 0, marketing: 0, rates });
    expect(r).toEqual({ floor: goFloor(107000, rates), uncounted: 0, partial: false });
  });

  it("has no floor while the product cost is unknown", () => {
    expect(goFloorSoFar({ productCost: null, costRows: [], missingUsual: 0, marketing: 0, rates }).floor).toBeNull();
  });
});
