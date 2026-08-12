import { describe, expect, it } from "vitest"
import {
  getStatusColorAlpha,
  getStatusDotColor,
  getStatusTheme,
  STATUS_THEME,
  TASK_STATUS,
} from "./status"

/**
 * Status theming is the only thing standing between a magic string and a
 * mislabelled task on every employee's dashboard, so the mapping is pinned
 * here — including the fallbacks that quietly absorb an unknown status.
 */
describe("getStatusTheme", () => {
  it("themes each task status", () => {
    expect(getStatusTheme(TASK_STATUS.COMPLETE)).toBe(STATUS_THEME.GREEN)
    expect(getStatusTheme(TASK_STATUS.INCOMPLETE)).toBe(STATUS_THEME.AMBER)
    expect(getStatusTheme(TASK_STATUS.AWAITING_APPROVAL)).toBe(STATUS_THEME.BLUE)
    expect(getStatusTheme(TASK_STATUS.NOT_APPROVED)).toBe(STATUS_THEME.RED)
    expect(getStatusTheme(TASK_STATUS.DELETED)).toBe(STATUS_THEME.MAUVE)
  })

  it("themes the opportunity pipeline", () => {
    expect(getStatusTheme("LEAD")).toBe(STATUS_THEME.MAUVE)
    expect(getStatusTheme("NEGOTIATION")).toBe(STATUS_THEME.VIOLET)
    expect(getStatusTheme("AWARDED")).toBe(STATUS_THEME.GREEN)
    expect(getStatusTheme("COLLECTION")).toBe(STATUS_THEME.ORANGE)
    expect(getStatusTheme("CLOSED_LOST")).toBe(STATUS_THEME.RED)
  })

  it("is case-insensitive so a lower-cased database value still themes", () => {
    expect(getStatusTheme("completed")).toBe(STATUS_THEME.GREEN)
    expect(getStatusTheme("awaiting approval")).toBe(STATUS_THEME.BLUE)
  })

  it("keeps the legacy sales vocabulary working", () => {
    expect(getStatusTheme("WON")).toBe(STATUS_THEME.GREEN)
    expect(getStatusTheme("DRAFT")).toBe(STATUS_THEME.AMBER)
    expect(getStatusTheme("SUBMITTED")).toBe(STATUS_THEME.BLUE)
    expect(getStatusTheme("ACTIVE")).toBe(STATUS_THEME.BLUE)
    expect(getStatusTheme("CANCELLED")).toBe(STATUS_THEME.RED)
  })

  it("falls back to neutral for an unknown or missing status", () => {
    expect(getStatusTheme("SOMETHING_NEW")).toBe(STATUS_THEME.MAUVE)
    expect(getStatusTheme(null)).toBe(STATUS_THEME.MAUVE)
    expect(getStatusTheme(undefined)).toBe(STATUS_THEME.MAUVE)
    expect(getStatusTheme("")).toBe(STATUS_THEME.MAUVE)
  })

  it("does not recognise the pre-migration spelling of COMPLETED", () => {
    // "COMPLETE" was migrated to "COMPLETED"; any row still holding the old
    // value themes as neutral rather than green.
    expect(getStatusTheme("COMPLETE")).toBe(STATUS_THEME.MAUVE)
  })

  it("does not crash on a non-string status", () => {
    expect(getStatusTheme(42)).toBe(STATUS_THEME.MAUVE)
    expect(getStatusTheme({})).toBe(STATUS_THEME.MAUVE)
  })
})

describe("status colour classes", () => {
  it("derives the dot colour from the status", () => {
    expect(getStatusDotColor(TASK_STATUS.COMPLETE)).toContain("bg-green-9")
    expect(getStatusDotColor(TASK_STATUS.NOT_APPROVED)).toContain("bg-red-9")
    expect(getStatusDotColor("UNKNOWN")).toContain("bg-mauve-9")
  })

  it("derives the translucent background from the theme", () => {
    expect(getStatusColorAlpha(STATUS_THEME.VIOLET)).toBe("bg-violet-a7 shadow-violet-5")
    expect(getStatusColorAlpha("not-a-theme")).toBe("bg-mauve-a7 shadow-mauve-5")
  })
})
