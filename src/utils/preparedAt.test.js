import { describe, expect, it } from "vitest";
import { formatPreparedAt } from "./preparedAt";

describe("formatPreparedAt", () => {
  it("shows a 5 PM slip as 5 PM in Manila, not 8 AM", () => {
    expect(formatPreparedAt("2026-10-15T09:00:00+00:00")).toBe("Oct 15, 2026, 5:00 PM");
  });

  it("crosses into the next Manila day when UTC is still the day before", () => {
    expect(formatPreparedAt("2026-10-15T20:30:00Z")).toBe("Oct 16, 2026, 4:30 AM");
  });

  it("shows an old slip (midnight Manila) as just its day", () => {
    expect(formatPreparedAt("2026-10-14T16:00:00+00:00")).toBe("Oct 15, 2026");
  });

  it("reads a bare date as that day", () => {
    expect(formatPreparedAt("2026-10-01")).toBe("Oct 1, 2026");
  });

  it("can always give the day alone", () => {
    expect(formatPreparedAt("2026-10-15T09:00:00Z", { dayOnly: true })).toBe("Oct 15, 2026");
  });

  it("is empty with no value", () => {
    expect(formatPreparedAt(null)).toBe("");
  });
});
