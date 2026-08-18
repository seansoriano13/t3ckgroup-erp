import { describe, expect, it } from "vitest"
import {
  PROCUREMENT_OUTCOME,
  REQUEST_UNITS,
  buildRequisitionTitle,
  countResolved,
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

describe("requisition title", () => {
  it("leads with the Sales Reference, which is the only key shared with Odoo", () => {
    expect(
      buildRequisitionTitle({
        salesReference: "S01237",
        clientName: "ACME Corp",
        itemCount: 3,
      }),
    ).toBe("[PR] S01237 — ACME Corp — 3 items to source")
  })

  it("names an unquoted deal by client, since it has no S-number yet", () => {
    expect(
      buildRequisitionTitle({ salesReference: null, clientName: "ACME Corp", itemCount: 1 }),
    ).toBe("[PR] ACME Corp — 1 item to source")
  })

  it("says 'item' for one and 'items' for the rest", () => {
    const one = buildRequisitionTitle({ salesReference: "S1", clientName: "C", itemCount: 1 })
    const two = buildRequisitionTitle({ salesReference: "S1", clientName: "C", itemCount: 2 })
    expect(one).toContain("1 item to source")
    expect(two).toContain("2 items to source")
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
