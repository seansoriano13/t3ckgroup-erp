import { describe, expect, it } from "vitest"
import { canvassBlockedReason, canvassLine } from "./itemCanvass"

describe("canvassBlockedReason", () => {
  it.each([
    ["cancelled", "This line is cancelled."],
    ["purchased", "This line is already bought."],
    ["received", "This line is already bought."],
    ["still_canvassing", "A Canvass is already running."],
  ])("shuts a %s line with its reason", (status, reason) => {
    expect(canvassBlockedReason({ status })).toBe(reason)
  })

  it.each(["not_checked", "available", "to_purchase", "cannot_source"])("leaves a %s line open", (status) => {
    expect(canvassBlockedReason({ status })).toBeNull()
  })
})

describe("canvassLine", () => {
  it("says the number and how many of three offers are in", () => {
    expect(canvassLine({ number: "CNV_0007", offers: [{}, {}] })).toBe("Canvass CNV_0007 · 2 of 3 offers")
  })

  it("counts a No other supplier note as a covered slot (#795 A9)", () => {
    expect(canvassLine({ number: "CNV_0007", offers: [{}, {}], slotsCovered: 3 })).toBe("Canvass CNV_0007 · 3 of 3 slots")
  })

  it("says a replaced line's Canvass was stopped", () => {
    expect(canvassLine({ number: "CNV_0007", stopped_reason: "Stopped · replaced by B" })).toBe("Canvass CNV_0007 · Stopped · replaced by B")
  })

  it("is empty when there is no Canvass", () => {
    expect(canvassLine(null)).toBeNull()
  })
})
