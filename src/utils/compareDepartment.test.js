import { describe, it, expect } from "vitest";
import { sameDepartment } from "./compareDepartment";

describe("sameDepartment", () => {
  it("matches identical strings", () => {
    expect(sameDepartment("Engineering", "Engineering")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(sameDepartment("Engineering", "ENGINEERING")).toBe(true);
    expect(sameDepartment("operations", "OPERATIONS")).toBe(true);
  });

  it("trims leading and trailing whitespace", () => {
    expect(sameDepartment("  Engineering", "Engineering  ")).toBe(true);
    expect(sameDepartment("\tSales\n", "Sales")).toBe(true);
  });

  it("combines casing and whitespace differences", () => {
    expect(sameDepartment("  engineering ", "ENGINEERING")).toBe(true);
  });

  it("returns false for genuinely different departments", () => {
    expect(sameDepartment("Engineering", "Sales")).toBe(false);
  });

  it("returns false when either side is an empty string", () => {
    expect(sameDepartment("", "Engineering")).toBe(false);
    expect(sameDepartment("Engineering", "")).toBe(false);
    expect(sameDepartment("", "")).toBe(false);
  });

  it("returns false when either side is null or undefined", () => {
    expect(sameDepartment(null, "Engineering")).toBe(false);
    expect(sameDepartment("Engineering", null)).toBe(false);
    expect(sameDepartment(undefined, undefined)).toBe(false);
  });
});
