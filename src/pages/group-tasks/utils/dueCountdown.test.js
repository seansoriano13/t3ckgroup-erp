import { describe, it, expect } from "vitest";
import { getDueCountdown, dueDateInputValue } from "./dueCountdown";

const now = new Date("2026-10-28T08:00:00Z");

describe("getDueCountdown", () => {
  it("returns null without a due date", () => {
    expect(getDueCountdown(null, now)).toBeNull();
    expect(getDueCountdown("nope", now)).toBeNull();
  });
  it("shows days left", () => {
    expect(getDueCountdown("2026-11-02T08:00:00Z", now)).toEqual({ label: "5 days left", overdue: false });
    expect(getDueCountdown("2026-10-29T09:00:00Z", now)).toEqual({ label: "1 day left", overdue: false });
  });
  it("shows hours under a day", () => {
    expect(getDueCountdown("2026-10-28T13:00:00Z", now)).toEqual({ label: "5 hours left", overdue: false });
    expect(getDueCountdown("2026-10-28T08:10:00Z", now)).toEqual({ label: "1 hour left", overdue: false });
  });
  it("shows overdue by days", () => {
    expect(getDueCountdown("2026-10-25T08:00:00Z", now)).toEqual({ label: "Overdue by 3 days", overdue: true });
    expect(getDueCountdown("2026-10-28T07:00:00Z", now)).toEqual({ label: "Overdue by 1 day", overdue: true });
  });
});

describe("dueDateInputValue", () => {
  it("gives the local calendar day, not the UTC one", () => {
    // 7:52 AM local on Oct 26 is still Oct 25 in UTC for anyone ahead of it.
    const iso = new Date(2026, 9, 26, 7, 52).toISOString();
    expect(dueDateInputValue(iso)).toBe("2026-10-26");
  });

  it("is blank for no or a bad date", () => {
    expect(dueDateInputValue(null)).toBe("");
    expect(dueDateInputValue("nope")).toBe("");
  });
});
