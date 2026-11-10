import { describe, expect, it } from "vitest"
import {
  PROCUREMENT_OUTCOME,
  REQUEST_UNITS,
  countResolved,
  daysWaiting,
  isValidPoNumber,
  normalizePoNumber,
  openRequests,
  outcomeRequiresPo,
} from "./procurement"

describe("PO number", () => {
  it("accepts an Odoo purchase order number", () => {
    expect(isValidPoNumber("P01234")).toBe(true)
    expect(isValidPoNumber(" p01234 ")).toBe(true)
  })

  it("rejects anything that is not one", () => {
    // S0#### is the *sales* order. Accepting it here would record a quotation
    // number as proof of a purchase.
    expect(isValidPoNumber("S01237")).toBe(false)
    expect(isValidPoNumber("PO-1234")).toBe(false)
    expect(isValidPoNumber("")).toBe(false)
    expect(isValidPoNumber(null)).toBe(false)
  })

  it("normalises a missing value rather than throwing", () => {
    expect(normalizePoNumber(null)).toBe("")
    expect(normalizePoNumber(undefined)).toBe("")
  })
})

describe("outcomes", () => {
  it("demands a PO only for the outcomes that imply a buy", () => {
    expect(outcomeRequiresPo(PROCUREMENT_OUTCOME.PURCHASED)).toBe(true)
    expect(outcomeRequiresPo(PROCUREMENT_OUTCOME.DELIVERED)).toBe(true)
    expect(outcomeRequiresPo(PROCUREMENT_OUTCOME.SUBSTITUTED)).toBe(true)
    // Nothing was bought or in-progress only, so demanding a PO would force
    // the buyer to invent one.
    expect(outcomeRequiresPo(PROCUREMENT_OUTCOME.IN_PROGRESS)).toBe(false)
    expect(outcomeRequiresPo(PROCUREMENT_OUTCOME.ALREADY_EXISTS)).toBe(false)
    expect(outcomeRequiresPo(PROCUREMENT_OUTCOME.UNAVAILABLE)).toBe(false)
  })

  it("counts a request as resolved once it carries a definitive outcome", () => {
    const requests = [
      { outcome: PROCUREMENT_OUTCOME.PURCHASED },
      { outcome: null },
      { outcome: PROCUREMENT_OUTCOME.IN_PROGRESS },
      { outcome: PROCUREMENT_OUTCOME.UNAVAILABLE },
    ]
    expect(countResolved(requests)).toEqual({ total: 4, resolved: 2 })
    expect(openRequests(requests)).toHaveLength(2)
  })
})

describe("request units", () => {
  it("offers 'unit' first, since that is the common case", () => {
    expect(REQUEST_UNITS[0]).toBe("unit")
  })

  it("has no duplicates", () => {
    expect(new Set(REQUEST_UNITS).size).toBe(REQUEST_UNITS.length)
  })
})

describe("daysWaiting", () => {
  const NOW = Date.parse("2026-08-27T09:00:00.000Z")

  it("counts whole days a request has been waiting", () => {
    expect(daysWaiting({ created_at: "2026-08-20T09:00:00.000Z" }, NOW)).toBe(7)
  })

  it("reads a request raised earlier today as 0 days, not 1", () => {
    expect(daysWaiting({ created_at: "2026-08-27T01:00:00.000Z" }, NOW)).toBe(0)
  })

  // A missing timestamp is not "raised today". Rendering it as 0 would tell a
  // purchaser the oldest thing on the queue is the newest.
  it("has no answer when there is nothing to measure from", () => {
    expect(daysWaiting({}, NOW)).toBeNull()
    expect(daysWaiting({ created_at: "not a date" }, NOW)).toBeNull()
  })

  it("does not go negative on a clock that disagrees", () => {
    expect(daysWaiting({ created_at: "2026-09-01T00:00:00.000Z" }, NOW)).toBe(0)
  })
})
