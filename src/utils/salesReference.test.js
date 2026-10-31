import { describe, expect, it } from "vitest";
import { lineToRow, normalizeS0, outcomeFromAnswer } from "../../supabase/functions/_shared/salesReference.ts";

const line = (extra = {}) => ({ odoo_line_id: 11, odoo_product_id: 5, product_name: "Pump", unit: "Unit", quantity: 2, unit_price: 100, ...extra });

describe("normalizeS0", () => {
  it("upper-cases, trims and reads SO123 as S123", () => {
    expect(normalizeS0(" s01237 ")).toBe("S01237");
    expect(normalizeS0("so123")).toBe("S123");
  });
  it("returns null for anything that is not an S0", () => {
    expect(normalizeS0("")).toBeNull();
    expect(normalizeS0(null)).toBeNull();
    expect(normalizeS0("ABC1")).toBeNull();
  });
});

describe("outcomeFromAnswer", () => {
  it("found: passes the lines to pull and uses Odoo's order name as the S0", () => {
    const out = outcomeFromAnswer("S01", { kind: "found", name: "S01237", items: [line()] });
    expect(out.odoo).toBe("found");
    expect(out.salesReference).toBe("S01237");
    expect(out.items).toEqual([lineToRow(line())]);
  });

  it("found with no lines: pulls nothing, so a Product List is never emptied", () => {
    expect(outcomeFromAnswer("S01237", { kind: "found", name: "S01237", items: [] }).items).toBeNull();
    expect(outcomeFromAnswer("S01237", { kind: "found", name: "S01237", items: [line({ product_name: "" })] }).items).toBeNull();
  });

  it("found with an odd order name keeps what was typed", () => {
    expect(outcomeFromAnswer("S01237", { kind: "found", name: "Quote 7", items: [] }).salesReference).toBe("S01237");
  });

  it("not found: tells the save step so, with no lines", () => {
    expect(outcomeFromAnswer("S01237", { kind: "not_found" })).toEqual({ odoo: "not_found", salesReference: "S01237", items: null });
  });

  it("unreachable: saves as not checked, with no lines", () => {
    expect(outcomeFromAnswer("S01237", { kind: "unreachable" })).toEqual({ odoo: "unreachable", salesReference: "S01237", items: null });
  });
});

describe("lineToRow", () => {
  it("maps an Odoo line like the app's own Product List row", () => {
    expect(lineToRow({ product_name: "Pump", odoo_line_id: 3 })).toEqual({
      product_name: "Pump",
      unit: "",
      quantity: 1,
      unit_price: "",
      odoo_product_id: null,
      odoo_line_id: 3,
      removed_from_s0: false,
    });
  });
});
