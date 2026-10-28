import { describe, expect, it } from "vitest";

import { lineMultiplier, lineSheetMarkup } from "./costingMath";

const part = (extra = {}) => ({ quantity: 1, acquire_unit: 1000, acquire_source: "typed", ...extra });
const line = (extra = {}) => ({ quantity: 1, components: [part()], ...extra });
const landedOf = (l) => l.components[0]?.acquire_unit ?? null;

describe("lineMultiplier", () => {
  it("uses the row's own multiplier when its parts carry one", () => {
    expect(lineMultiplier(line({ components: [part({ markup_factor: 1.5 })] }), 1.2)).toEqual({ factor: 1.5, own: true });
  });
  it("falls back to the matrix default", () => {
    expect(lineMultiplier(line(), 1.2)).toEqual({ factor: 1.2, own: false });
  });
  it("is unknown when neither is known", () => {
    expect(lineMultiplier(line(), undefined).factor).toBeNull();
  });
});

describe("lineSheetMarkup", () => {
  it("prices the bare peso price times the multiplier, not the landed cost", () => {
    const row = line();
    // Landed is higher than the peso price; the suggested price must ignore it.
    const out = lineSheetMarkup(row, [], 1.3, () => 1100);
    expect(out.suggested).toBe(1300);
    expect(out.margin).toBe(200);
    expect(out.percent).toBe(15.4);
  });

  it("uses an own multiplier over the default", () => {
    const out = lineSheetMarkup(line({ components: [part({ markup_factor: 2 })] }), [], 1.3, landedOf);
    expect(out.suggested).toBe(2000);
    expect(out.own).toBe(true);
  });

  it("counts the cost of included items toward the parent's margin", () => {
    const tower = line({ quantity: 2 });
    const kid = line({ quantity: 4, components: [part({ acquire_unit: 50 })] });
    // Parent unit cost 1000, included cost 50 x 4 = 200 over 2 units = 100 per unit.
    const out = lineSheetMarkup(tower, [kid], 1.5, landedOf);
    expect(out.suggested).toBe(1500);
    expect(out.cost).toBe(1100);
    expect(out.margin).toBe(400);
    expect(out.included).toBe(1);
  });

  it("is blank while an included item has no cost", () => {
    const kid = line({ components: [] });
    const out = lineSheetMarkup(line(), [kid], 1.5, landedOf);
    expect(out.suggested).toBe(1500);
    expect(out.margin).toBeNull();
  });

  it("is blank while the multiplier is unknown", () => {
    expect(lineSheetMarkup(line(), [], undefined, landedOf).suggested).toBeNull();
  });
});
