import { describe, expect, it } from "vitest";
import { DEFAULT_COSTING_SETTINGS } from "../constants/costing";
import { isS0Number, linesFromOdoo, normalizeS0, shapeStandalonePage } from "./standaloneEvaluation";

describe("the S0 number", () => {
  it("is S0 and digits, tidied", () => {
    expect(normalizeS0("  s01237 ")).toBe("S01237");
    expect(isS0Number(" s01237")).toBe(true);
    for (const bad of ["", "S1237", "SOR-1", "S0", "S0 12", "12345", null, undefined, 5]) expect(isS0Number(bad), String(bad)).toBe(false);
  });
});

describe("lines from Odoo", () => {
  it("keeps the product and line ids, defaults a missing quantity, and drops a nameless line", () => {
    expect(
      linesFromOdoo([
        { product_name: " Rescue vehicle ", quantity: 2, unit: "Unit", odoo_product_id: 4242, odoo_line_id: 91001 },
        { product_name: "Hose", quantity: 0, unit: "", odoo_product_id: null, odoo_line_id: 91002 },
        { product_name: "  ", quantity: 3 },
      ]),
    ).toEqual([
      { name: "Rescue vehicle", quantity: 2, unit: "Unit", odoo_product_id: 4242, odoo_line_id: 91001 },
      { name: "Hose", quantity: 1, unit: null, odoo_product_id: null, odoo_line_id: 91002 },
    ]);
    expect(linesFromOdoo(undefined)).toEqual([]);
  });
});

describe("the standalone rows of the list", () => {
  const settings = DEFAULT_COSTING_SETTINGS;

  it("works the Closed Book's planned Revenue and leaves Actual blank", () => {
    const [row] = shapeStandalonePage(
      [{ matrix_id: "m1", s0_number: "S01", tier: "closed_book", line_count: 1, final_offer_total: "370000", final_acquire_total: "125104", project_expenses_total: "89160", marketing: "0" }],
      settings,
    );
    expect(row).toMatchObject({ standalone: true, matrixId: "m1", soNumber: "S01", finalOffer: 370000 });
    expect(row.comparison.planned).toBe(102793.14);
    expect(row.comparison.actual).toBeNull();
  });

  it("shows no Revenue to a tier that does not hold every figure", () => {
    const [row] = shapeStandalonePage([{ matrix_id: "m2", s0_number: "S02", tier: "price", line_count: 2, final_offer_total: "1000", final_acquire_total: null }], settings);
    expect(row.finalOffer).toBe(1000);
    expect(row.comparison.planned).toBeNull();
  });
});
