import { describe, it, expect } from "vitest";
import { sorCodeOf, matchesSorCode } from "./sorCode";

describe("sorCodeOf", () => {
  it("reads the stored sor_code", () => {
    expect(sorCodeOf({ sor_code: "SOR-357", serial_no: 357 })).toBe("SOR-357");
  });

  it("falls back to serial_no for a row fetched before the column existed", () => {
    expect(sorCodeOf({ serial_no: 357 })).toBe("SOR-357");
  });

  it("is empty when there is nothing to name", () => {
    expect(sorCodeOf(null)).toBe("");
    expect(sorCodeOf({})).toBe("");
  });
});

describe("matchesSorCode", () => {
  const opp = { sor_code: "SOR-357", serial_no: 357 };

  it.each(["SOR-357", "sor357", "SOR 357", "sor-357", "357", "35"])("matches %s", (q) => {
    expect(matchesSorCode(opp, q)).toBe(true);
  });

  it.each(["SOR-358", "S07189", ""])("does not match %s", (q) => {
    expect(matchesSorCode(opp, q)).toBe(false);
  });
});
