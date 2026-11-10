import { describe, it, expect } from "vitest";
import { componentMarkup, effectiveFactor, lineMarkup, markupPrice, markupPriceUnit, matrixMarkup, percentOver } from "./costingMath";

/**
 * Markup (#269): Markup Price per Component and cost-only row, each Tender Line's sum, and the
 * achieved markup per line and overall. A blank Acquire leaves a figure blank, never zero.
 */

// The Government sheet: the vehicle bundle at x1.47, the Delivery Charge at x1.00.
const vehicle = (extra = {}) => ({ quantity: 1, acquire_unit: 2160500, markup_factor: 1.47, ...extra });
const delivery = (extra = {}) => ({ quantity: 1, acquire_unit: 100000, markup_factor: 1, ...extra });
const withMarkup = (row, defaultFactor = 1.35) => ({ ...row, markup: componentMarkup(row, defaultFactor) });

describe("markupPrice", () => {
  it("prices the vehicle at x1.47 and the Delivery Charge at x1.00", () => {
    expect(markupPrice(2160500, 1, 1.47)).toBe(3175935);
    expect(markupPrice(100000, 1, 1)).toBe(100000);
    expect(markupPriceUnit(2160500, 1.47)).toBe(3175935);
  });

  it("multiplies the per-unit price, already to the centavo, by the quantity", () => {
    expect(markupPrice(100.01, 3, 1.35)).toBe(405.03); // 135.01 x 3, not 135.0135 x 3
    expect(markupPriceUnit(100.01, 1.35)).toBe(135.01);
  });

  it("rounds half up to the centavo, without float drift", () => {
    expect(markupPriceUnit(0.1, 1.05)).toBe(0.11); // 0.105
    expect(markupPriceUnit(1.15, 1.1)).toBe(1.27); // 1.265
    expect(markupPriceUnit("2.50", "1.3500")).toBe(3.38); // 3.375
  });

  it("is null while Acquire, the factor or the quantity is blank, never zero", () => {
    expect(markupPrice(null, 1, 1.35)).toBeNull();
    expect(markupPrice(undefined, 1, 1.35)).toBeNull();
    expect(markupPrice("", 1, 1.35)).toBeNull();
    expect(markupPrice(100, 1, null)).toBeNull();
    expect(markupPrice(100, null, 1.35)).toBeNull();
    expect(markupPriceUnit(null, 1.35)).toBeNull();
    // a free item is zero, not blank
    expect(markupPrice(0, 2, 1.35)).toBe(0);
  });
});

describe("effectiveFactor and componentMarkup", () => {
  it("takes the row's own factor, else the matrix default, and x1.00 for a cost-only row", () => {
    expect(effectiveFactor({ markup_factor: 1.47 }, 1.35)).toBe(1.47);
    expect(effectiveFactor({ markup_factor: null }, 1.35)).toBe(1.35);
    expect(effectiveFactor({}, 1.35)).toBe(1.35);
    expect(effectiveFactor({ markup_factor: null }, 1.35, { costOnly: true })).toBe(1);
    expect(effectiveFactor({ markup_factor: 1.2 }, 1.35, { costOnly: true })).toBe(1.2);
    expect(effectiveFactor({}, null)).toBeNull();
    expect(effectiveFactor({}, undefined)).toBeNull();
  });

  it("works the Markup Price out from Acquire when the tier has it", () => {
    expect(componentMarkup(vehicle({ quantity: 2 }), 1.35)).toEqual({ factor: 1.47, priceUnit: 3175935, priceTotal: 6351870 });
    expect(componentMarkup({ quantity: 1, acquire_unit: 100 }, 1.35)).toEqual({ factor: 1.35, priceUnit: 135, priceTotal: 135 });
  });

  it("keeps Markup Price blank while Acquire is blank or no factor is known", () => {
    expect(componentMarkup({ quantity: 1, acquire_unit: null, markup_factor: 1.35 }, 1.35)).toEqual({ factor: 1.35, priceUnit: null, priceTotal: null });
    expect(componentMarkup({ quantity: 1, acquire_unit: 100 }, null)).toEqual({ factor: null, priceUnit: null, priceTotal: null });
  });

  it("uses the database's Markup Price when the tier received it, without ever needing the factor", () => {
    // The price tier: markup_price_unit present, no acquire_unit, no markup_factor.
    expect(componentMarkup({ quantity: 3, markup_price_unit: 135.01 }, undefined)).toEqual({ factor: null, priceUnit: 135.01, priceTotal: 405.03 });
    // The database said blank (Acquire blank): it stays blank.
    expect(componentMarkup({ quantity: 3, markup_price_unit: null }, undefined)).toEqual({ factor: null, priceUnit: null, priceTotal: null });
  });
});

describe("lineMarkup", () => {
  it("sums the Components' Markup Prices and gives Final Offer over Acquire as the achieved markup", () => {
    const line = { quantity: 1, final_offer_unit: 3300000 };
    expect(lineMarkup(line, [withMarkup(vehicle())], 1.35)).toEqual({ priceTotal: 3175935, targetFactor: 1.47, achievedFactor: 1.5274 });
  });

  it("blends mixed factors into the target", () => {
    const components = [withMarkup({ quantity: 1, acquire_unit: 1000, markup_factor: 1.5 }), withMarkup({ quantity: 1, acquire_unit: 1000, markup_factor: 1.3 })];
    expect(lineMarkup({ quantity: 1, final_offer_unit: 2800 }, components, 1.35)).toEqual({ priceTotal: 2800, targetFactor: 1.4, achievedFactor: 1.4 });
  });

  it("leaves Markup Price and achieved markup null while an Acquire is blank, never zero", () => {
    const components = [withMarkup(vehicle()), withMarkup({ quantity: 1, acquire_unit: null })];
    const result = lineMarkup({ quantity: 1, final_offer_unit: 3300000 }, components, 1.35);
    expect(result.priceTotal).toBeNull();
    expect(result.achievedFactor).toBeNull();
  });

  it("has no achieved markup without a Final Offer, and none for a line with no Component", () => {
    expect(lineMarkup({ quantity: 1 }, [withMarkup(vehicle())], 1.35).achievedFactor).toBeNull();
    expect(lineMarkup({ quantity: 1, final_offer_unit: 5000 }, [], 1.35)).toEqual({ priceTotal: null, targetFactor: null, achievedFactor: null });
  });

  it("gives the price tier the Markup Price sum and no achieved markup, since it never receives Acquire", () => {
    const components = [{ quantity: 1, markup_price_unit: 3175935 }, { quantity: 2, markup_price_unit: 50.5 }].map((c) => ({
      ...c,
      markup: componentMarkup(c, undefined),
    }));
    const result = lineMarkup({ quantity: 1, final_offer_unit: 3300000 }, components, undefined);
    expect(result.priceTotal).toBe(3176036);
    expect(result.achievedFactor).toBeNull();
    expect(result.targetFactor).toBeNull();
  });
});

describe("matrixMarkup", () => {
  const build = () => {
    const vehicleRow = vehicle();
    const line = { quantity: 1, final_offer_unit: 3300000, components: [{ ...vehicleRow, markup: componentMarkup(vehicleRow, 1.35) }] };
    line.markup = lineMarkup(line, line.components, 1.35);
    const costRow = delivery();
    return { line, costRow: { ...costRow, markup: componentMarkup(costRow, 1.35, { costOnly: true }) } };
  };

  it("counts cost-only rows in the overall achieved markup but not in a line's", () => {
    const { line, costRow } = build();
    expect(line.markup.achievedFactor).toBe(1.5274); // 3,300,000 / 2,160,500
    expect(matrixMarkup([line], [], 1.35).achievedFactor).toBe(1.5274);
    // 3,300,000 / (2,160,500 + 100,000)
    expect(matrixMarkup([line], [costRow], 1.35).achievedFactor).toBe(1.4599);
    expect(matrixMarkup([line], [costRow], 1.35).priceTotal).toBe(3175935);
    // the line's own figure did not move
    expect(line.markup.achievedFactor).toBe(1.5274);
  });

  it("targets the blend over the Components and the x1.00 cost-only rows", () => {
    const { line, costRow } = build();
    // (3,175,935 + 100,000) / (2,160,500 + 100,000)
    expect(matrixMarkup([line], [costRow], 1.35).targetFactor).toBe(1.4492);
  });

  it("is null while a cost-only row's Acquire is blank, a line has no Final Offer, or a line has no Component", () => {
    const { line, costRow } = build();
    const blankRow = { ...costRow, acquire_unit: null, markup: componentMarkup({ ...costRow, acquire_unit: null }, 1.35, { costOnly: true }) };
    expect(matrixMarkup([line], [blankRow], 1.35).achievedFactor).toBeNull();
    const noOffer = { ...line, final_offer_unit: null };
    expect(matrixMarkup([noOffer], [costRow], 1.35).achievedFactor).toBeNull();
    const bare = { quantity: 1, final_offer_unit: 100, components: [], markup: lineMarkup({ quantity: 1 }, [], 1.35) };
    expect(matrixMarkup([line, bare], [], 1.35).achievedFactor).toBeNull();
    expect(matrixMarkup([], [], 1.35)).toEqual({ priceTotal: null, targetFactor: null, achievedFactor: null });
  });
});

describe("percentOver", () => {
  it("shows a factor as the percentage over cost", () => {
    expect(percentOver(1.35)).toBe(35);
    expect(percentOver(1)).toBe(0);
    expect(percentOver(2.0644)).toBe(106.44);
    expect(percentOver(0.9)).toBe(-10);
    expect(percentOver(null)).toBeNull();
  });
});
