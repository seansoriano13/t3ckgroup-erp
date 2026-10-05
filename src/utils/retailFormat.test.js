import { describe, it, expect } from "vitest";
import { BLANK, formatCount, formatDateOrDash, formatPHPOrDash } from "./retailFormat";

describe("retailFormat", () => {
  it("formatPHPOrDash dashes a missing figure but formats a zero", () => {
    expect(formatPHPOrDash(null)).toBe(BLANK);
    expect(formatPHPOrDash(undefined)).toBe(BLANK);
    expect(formatPHPOrDash(0)).toBe("₱0.00");
    expect(formatPHPOrDash(1234.5)).toBe("₱1,234.50");
  });

  it("formatDateOrDash dashes a missing date and reads one in en-PH", () => {
    expect(formatDateOrDash(null)).toBe(BLANK);
    expect(formatDateOrDash("")).toBe(BLANK);
    expect(formatDateOrDash("2026-09-02T03:04:05Z")).toBe(new Date("2026-09-02T03:04:05Z").toLocaleDateString("en-PH"));
  });

  it("formatCount groups thousands", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(0)).toBe("0");
  });
});
