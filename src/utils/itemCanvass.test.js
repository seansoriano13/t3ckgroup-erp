import { describe, expect, it } from "vitest"
import { boughtWithoutCanvass, canvassBlockedReason, canvassLine } from "./itemCanvass"

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
  it("says the number and how many of three suppliers quoted the line", () => {
    expect(canvassLine({ number: "CNV_0007", supplierCount: 2 })).toBe("Canvass CNV_0007 · 2 of 3 suppliers")
  })

  it("names the winner once one is picked (#898)", () => {
    expect(canvassLine({ number: "CNV_0007", supplierCount: 3, winnerName: "Redleaf Inc." })).toBe(
      "Canvass CNV_0007 · 3 of 3 suppliers · Winner Redleaf Inc.",
    )
  })

  it("is empty when there is no Canvass", () => {
    expect(canvassLine(null)).toBeNull()
  })
})

describe("boughtWithoutCanvass", () => {
  it.each(["purchased", "received"])("is true for a %s line nobody quoted", (status) => {
    expect(boughtWithoutCanvass(status, false)).toBe(true)
    expect(boughtWithoutCanvass(status, true)).toBe(false)
  })

  it.each(["to_purchase", "still_canvassing", "cancelled"])("is false for a %s line", (status) => {
    expect(boughtWithoutCanvass(status, false)).toBe(false)
  })
})
