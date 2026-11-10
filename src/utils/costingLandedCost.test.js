import { describe, it, expect } from "vitest";
import { landedCostRollup, lineTotals, matrixTotals } from "./costingMath";

const final = (total) => ({ quantity: 1, landed_cost: { total, unit: total, mark: "final", blankReason: null } });
const provisional = (total) => ({ quantity: 1, landed_cost: { total, unit: total, mark: "provisional", blankReason: null } });
const blank = (reason) => ({ quantity: 1, landed_cost: { total: null, unit: null, mark: null, blankReason: reason } });

describe("landedCostRollup", () => {
  it("adds up its Components, final when every one is", () => {
    expect(landedCostRollup([final(100.1), final(200.2)])).toEqual({ total: 300.3, mark: "final" });
  });

  it("is provisional while any Component is", () => {
    expect(landedCostRollup([final(100), provisional(50)])).toEqual({ total: 150, mark: "provisional" });
  });

  it("is blank while any Component is blank, never a partial sum", () => {
    expect(landedCostRollup([final(100), blank("po_line_not_picked")])).toBeNull();
  });

  it("is blank with no Components, or when the tier never received Landed Cost", () => {
    expect(landedCostRollup([])).toBeNull();
    expect(landedCostRollup([{ quantity: 1 }])).toBeNull();
  });
});

describe("lineTotals and matrixTotals carry Landed Cost", () => {
  it("rolls a Tender Line up from its Components", () => {
    expect(lineTotals({ quantity: 1 }, [final(10), provisional(5)]).landedCost).toEqual({ total: 15, mark: "provisional" });
    expect(lineTotals({ quantity: 1 }, [final(10), blank("not_ordered")]).landedCost).toBeNull();
  });

  it("rolls the matrix up from every Tender Line's Components", () => {
    const lines = [{ quantity: 1, components: [final(10)] }, { quantity: 1, components: [final(20)] }];
    expect(matrixTotals(lines).landedCost).toEqual({ total: 30, mark: "final" });
    expect(matrixTotals([...lines, { quantity: 1, components: [] }]).landedCost).toBeNull();
    lines[1].components.push(blank("line_removed"));
    expect(matrixTotals(lines).landedCost).toBeNull();
  });

  it("leaves a participant's totals with no Landed Cost", () => {
    expect(lineTotals({ quantity: 1 }, [{ quantity: 1, acquire_unit: 5 }]).landedCost).toBeNull();
  });
});
