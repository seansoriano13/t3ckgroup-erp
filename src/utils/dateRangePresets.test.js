import { describe, it, expect } from "vitest";
import {
  DATE_PRESETS,
  getPresetDateRange,
  getSalesCycleRange,
  getSalesCycleStartYear,
  toLocalIsoDate,
} from "./dateRangePresets";

// The suite runs pinned to Asia/Manila (UTC+8) — see vitest.config.js. That
// is the whole point of these cases: a UTC round-trip is invisible in UTC and
// wrong by a day here.
describe("toLocalIsoDate", () => {
  it("reads the local calendar day, not the UTC one", () => {
    // Midnight local on 1 Aug is 31 Jul 16:00 UTC.
    expect(toLocalIsoDate(new Date(2026, 7, 1, 0, 0, 0))).toBe("2026-08-01");
    // 06:00 local on 22 Aug is still 21 Aug in UTC.
    expect(toLocalIsoDate(new Date(2026, 7, 22, 6, 0, 0))).toBe("2026-08-22");
    // Late evening local is already the next day in some zones, but not here.
    expect(toLocalIsoDate(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31");
  });
});

describe("getPresetDateRange", () => {
  const noonAug22 = new Date(2026, 7, 22, 12, 0, 0);
  const earlyAug22 = new Date(2026, 7, 22, 6, 0, 0);

  it("covers exactly the current calendar month", () => {
    expect(getPresetDateRange("THIS_MONTH", noonAug22)).toEqual({
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
  });

  it("covers exactly the previous calendar month", () => {
    expect(getPresetDateRange("LAST_MONTH", noonAug22)).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });
  });

  it("ends Year-To-Date on today even before 08:00 local", () => {
    // Before 08:00 Manila the UTC date is still yesterday; YTD must not be.
    expect(getPresetDateRange("YTD", earlyAug22)).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-08-22",
    });
  });

  it("handles a month boundary in January without slipping to the prior year", () => {
    const jan15 = new Date(2026, 0, 15, 6, 0, 0);
    expect(getPresetDateRange("THIS_MONTH", jan15)).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    expect(getPresetDateRange("LAST_MONTH", jan15)).toEqual({
      startDate: "2025-12-01",
      endDate: "2025-12-31",
    });
  });

  it("spans a leap February end to end", () => {
    const feb10 = new Date(2028, 1, 10, 6, 0, 0);
    expect(getPresetDateRange("THIS_MONTH", feb10)).toEqual({
      startDate: "2028-02-01",
      endDate: "2028-02-29",
    });
  });

  it("returns fixed quarter bounds for the current year", () => {
    expect(getPresetDateRange("Q1", noonAug22)).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-03-31",
    });
    expect(getPresetDateRange("Q4", noonAug22)).toEqual({
      startDate: "2026-10-01",
      endDate: "2026-12-31",
    });
  });

  it("returns null for All Time and unknown presets", () => {
    expect(getPresetDateRange("ALL", noonAug22)).toBeNull();
    expect(getPresetDateRange("NOT_A_PRESET", noonAug22)).toBeNull();
  });

  it("resolves a range for every preset it offers except All Time", () => {
    for (const { value } of DATE_PRESETS) {
      const range = getPresetDateRange(value, noonAug22);
      if (value === "ALL") {
        expect(range).toBeNull();
        continue;
      }
      expect(range, `preset ${value}`).not.toBeNull();
      expect(range.startDate <= range.endDate, `preset ${value} is inverted`).toBe(true);
    }
  });
});

// CCPR-2026-001: the Sales Cycle runs 1 April to 31 March, and its two halves
// are the commission release periods — the November Release covers 1 Apr to
// 30 Sep (First Cycle, target PHP 99M), the May Release covers 1 Oct to
// 31 Mar (Second Cycle, target PHP 121M).
describe("getSalesCycleStartYear", () => {
  it("treats April as the start of a new cycle", () => {
    expect(getSalesCycleStartYear(new Date(2026, 3, 1))).toBe(2026);
    expect(getSalesCycleStartYear(new Date(2026, 7, 22))).toBe(2026);
    expect(getSalesCycleStartYear(new Date(2026, 11, 31))).toBe(2026);
  });

  it("puts January through March in the cycle that opened the previous April", () => {
    expect(getSalesCycleStartYear(new Date(2027, 0, 1))).toBe(2026);
    expect(getSalesCycleStartYear(new Date(2027, 2, 31))).toBe(2026);
  });

  it("rolls over on 1 April, not 1 January", () => {
    expect(getSalesCycleStartYear(new Date(2027, 2, 31))).toBe(2026);
    expect(getSalesCycleStartYear(new Date(2027, 3, 1))).toBe(2027);
  });
});

describe("getSalesCycleRange", () => {
  it("spans April to the following March", () => {
    expect(getSalesCycleRange(2026)).toEqual({
      startDate: "2026-04-01",
      endDate: "2027-03-31",
    });
  });

  it("splits into the two release-coverage halves", () => {
    expect(getSalesCycleRange(2026, "FIRST")).toEqual({
      startDate: "2026-04-01",
      endDate: "2026-09-30",
    });
    expect(getSalesCycleRange(2026, "SECOND")).toEqual({
      startDate: "2026-10-01",
      endDate: "2027-03-31",
    });
  });

  it("covers the whole cycle with the two halves, back to back and without overlap", () => {
    const full = getSalesCycleRange(2026);
    const first = getSalesCycleRange(2026, "FIRST");
    const second = getSalesCycleRange(2026, "SECOND");

    expect(first.startDate).toBe(full.startDate);
    expect(second.endDate).toBe(full.endDate);
    // 30 Sep then 1 Oct: no gap, no shared day.
    expect(new Date(second.startDate) - new Date(first.endDate)).toBe(86_400_000);
  });
});

describe("getPresetDateRange — Sales Cycle presets", () => {
  const inAugust = new Date(2026, 7, 22); // first half of the 2026 cycle
  const inFebruary = new Date(2027, 1, 10); // second half of the same cycle

  it("resolves the current cycle from a date in its first half", () => {
    expect(getPresetDateRange("CYCLE", inAugust)).toEqual({
      startDate: "2026-04-01",
      endDate: "2027-03-31",
    });
  });

  it("resolves the same cycle from a date in its second half", () => {
    // February 2027 belongs to the cycle that opened April 2026 — not to a
    // 2027 calendar year.
    expect(getPresetDateRange("CYCLE", inFebruary)).toEqual({
      startDate: "2026-04-01",
      endDate: "2027-03-31",
    });
  });

  it("resolves each half independently of which half today falls in", () => {
    for (const now of [inAugust, inFebruary]) {
      expect(getPresetDateRange("CYCLE_FIRST", now)).toEqual({
        startDate: "2026-04-01",
        endDate: "2026-09-30",
      });
      expect(getPresetDateRange("CYCLE_SECOND", now)).toEqual({
        startDate: "2026-10-01",
        endDate: "2027-03-31",
      });
    }
  });

  it("resolves the previous cycle", () => {
    expect(getPresetDateRange("PREV_CYCLE", inAugust)).toEqual({
      startDate: "2025-04-01",
      endDate: "2026-03-31",
    });
    expect(getPresetDateRange("PREV_CYCLE", inFebruary)).toEqual({
      startDate: "2025-04-01",
      endDate: "2026-03-31",
    });
  });

  it("offers a cycle preset for every cycle option it lists", () => {
    const cyclePresets = DATE_PRESETS.filter((p) => p.value.includes("CYCLE"));
    expect(cyclePresets.map((p) => p.value)).toEqual([
      "CYCLE",
      "CYCLE_FIRST",
      "CYCLE_SECOND",
      "PREV_CYCLE",
    ]);
  });
});
