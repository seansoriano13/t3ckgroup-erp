import { describe, it, expect } from "vitest";
import { formatRateDay, formatReferenceRate } from "./referenceRate";

const ref = { currency: "USD", rate_date: "2026-09-17", php_per_unit: 58.2, divergence_pct: 2 };

describe("formatReferenceRate", () => {
  it("always says the day the rate is for", () => {
    expect(formatReferenceRate(ref, "2026-09-17")).toBe("USD 1 = ₱58.20 · 17 Sep");
  });

  it("adds the year when the rate is from another year", () => {
    expect(formatReferenceRate(ref, "2027-01-03")).toBe("USD 1 = ₱58.20 · 17 Sep 2026");
  });

  it("keeps up to four decimals the feed gave", () => {
    expect(formatReferenceRate({ ...ref, php_per_unit: 62.968 }, "2026-09-17")).toBe("USD 1 = ₱62.968 · 17 Sep");
  });

  it("is blank when there is no rate", () => {
    expect(formatReferenceRate(null)).toBe("");
  });
});

describe("formatRateDay", () => {
  it("reads a date-only value without shifting a day", () => {
    expect(formatRateDay("2026-09-01", "2026-09-01")).toBe("1 Sep");
  });
});
