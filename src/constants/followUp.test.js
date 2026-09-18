import { describe, it, expect } from "vitest"
import { nextFollowUpDue } from "./followUp"

describe("nextFollowUpDue", () => {
  const enteredAt = "2026-01-01T00:00:00.000Z"

  it("returns null when there is no cadence config", () => {
    expect(nextFollowUpDue({})).toBeNull()
    expect(nextFollowUpDue({ enteredAt, everyDays: 0 })).toBeNull()
  })

  it("no follow-up logged: due everyDays after entering the Stage", () => {
    expect(nextFollowUpDue({ enteredAt, everyDays: 5 })).toBe("2026-01-06T00:00:00.000Z")
  })

  it("a follow-up logged: due everyDays after the log, not entry", () => {
    const lastLoggedAt = "2026-01-03T00:00:00.000Z"
    expect(nextFollowUpDue({ enteredAt, lastLoggedAt, everyDays: 5 })).toBe("2026-01-08T00:00:00.000Z")
  })

  it("repeated silence: due everyDays after the latest reminder, not the log", () => {
    const lastLoggedAt = "2026-01-03T00:00:00.000Z"
    const lastReminderAt = "2026-01-08T00:00:00.000Z"
    expect(nextFollowUpDue({ enteredAt, lastLoggedAt, lastReminderAt, everyDays: 5 })).toBe(
      "2026-01-13T00:00:00.000Z"
    )
  })

  it("a visit that has ended never has a next reminder", () => {
    expect(nextFollowUpDue({ enteredAt, everyDays: 5, leftAt: "2026-01-02T00:00:00.000Z" })).toBeNull()
  })
})
