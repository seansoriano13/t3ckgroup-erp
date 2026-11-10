import { describe, expect, it } from "vitest";
import { DEADLINE_MARK, DEFAULT_NEAR_DAYS, deadlineMark, earliestDueAt, isValidNearDays } from "./deliveryDeadline";

/** The client's delivery deadline (#467): none, ok, near, late. Manila days. */

const today = new Date("2026-11-10T04:00:00Z"); // 12:00 in Manila
const due = (days) => new Date(today.getTime() + days * 86_400_000).toISOString();

describe("deadlineMark", () => {
  it("defaults N to 5", () => {
    expect(DEFAULT_NEAR_DAYS).toBe(5);
    expect(deadlineMark({ dueAt: due(5), today }).mark).toBe(DEADLINE_MARK.NEAR);
    expect(deadlineMark({ dueAt: due(6), today }).mark).toBe(DEADLINE_MARK.OK);
  });

  it("marks none for an SOR with no deadline", () => {
    expect(deadlineMark({ dueAt: null, today })).toEqual({ mark: DEADLINE_MARK.NONE, dueAt: null, daysLeft: null });
    expect(deadlineMark({ today }).mark).toBe(DEADLINE_MARK.NONE);
  });

  it("marks near within N days, the due date itself included", () => {
    expect(deadlineMark({ dueAt: due(0), nearDays: 3, today })).toMatchObject({ mark: DEADLINE_MARK.NEAR, daysLeft: 0 });
    expect(deadlineMark({ dueAt: due(3), nearDays: 3, today }).mark).toBe(DEADLINE_MARK.NEAR);
    expect(deadlineMark({ dueAt: due(4), nearDays: 3, today }).mark).toBe(DEADLINE_MARK.OK);
  });

  it("marks late the day after the due date", () => {
    expect(deadlineMark({ dueAt: due(-1), today })).toMatchObject({ mark: DEADLINE_MARK.LATE, daysLeft: -1 });
    expect(deadlineMark({ dueAt: due(-20), today }).mark).toBe(DEADLINE_MARK.LATE);
  });

  it("marks nothing once the order is Received in Odoo, but keeps the date", () => {
    const result = deadlineMark({ dueAt: due(-2), receivedInOdoo: true, today });
    expect(result.mark).toBe(DEADLINE_MARK.NONE);
    expect(result.dueAt).toBe(due(-2));
  });
});

describe("earliestDueAt", () => {
  it("takes the earliest deadline among an order's SORs, and null with none", () => {
    const deadlines = new Map([
      ["a", { dueAt: due(9) }],
      ["b", { dueAt: due(2) }],
    ]);
    expect(earliestDueAt(["a", "b", "c"], deadlines)).toBe(due(2));
    expect(earliestDueAt(["c"], deadlines)).toBeNull();
    expect(earliestDueAt([], deadlines)).toBeNull();
  });
});

describe("isValidNearDays", () => {
  it("accepts whole numbers above zero only", () => {
    expect(isValidNearDays(5)).toBe(true);
    expect(isValidNearDays(0)).toBe(false);
    expect(isValidNearDays(2.5)).toBe(false);
    expect(isValidNearDays(NaN)).toBe(false);
    expect(isValidNearDays(null)).toBe(false);
  });
});
