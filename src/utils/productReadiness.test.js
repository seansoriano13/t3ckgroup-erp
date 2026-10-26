import { describe, expect, it } from "vitest"
import { isFolded, summarize } from "./productReadiness"

describe("isFolded (#680)", () => {
  it("folds Available, Received and Cancelled lines", () => {
    for (const status of ["available", "received", "cancelled"]) expect(isFolded({ status })).toBe(true)
  })
  it("never folds a line still in progress", () => {
    for (const status of ["not_checked", "to_purchase", "still_canvassing", "purchased", "cannot_source"]) {
      expect(isFolded({ status })).toBe(false)
    }
  })
  it("keeps a finished line open when it carries a warning someone must act on", () => {
    for (const flag of ["now_free", "s0_still_lists", "new_on_s0"]) {
      expect(isFolded({ status: "available", [flag]: true })).toBe(false)
    }
  })
  it("does not hold a finished line open for Removed from S0 alone", () => {
    expect(isFolded({ status: "received", removed_from_s0: true })).toBe(true)
  })
})

describe("summarize (#680)", () => {
  it("counts ready lines and leaves Cancelled out of the total", () => {
    const s = summarize([{ status: "available" }, { status: "received" }, { status: "cancelled" }, { status: "not_checked" }])
    expect(s).toMatchObject({ ready: 2, total: 3 })
    expect(s.sentence).toBe("2 are in the warehouse. 1 has not been checked yet.")
  })
  it("says which P0 the one purchased line is on", () => {
    expect(summarize([{ status: "purchased", po_number: "P0100" }]).sentence).toBe(
      "0 are in the warehouse. 1 needs buying: 1 is on P0100 and not here yet.",
    )
  })
})
