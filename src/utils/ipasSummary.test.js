import { describe, expect, it } from "vitest"
import { IPAS_SUMMARY_KEYS, shapeIpasSummaries, shapeIpasSummary, shortDay, signoffProgress } from "./ipasSummary"

const row = (over = {}) => ({
  ipas_id: "ipas-1",
  number: "TGIPAS_049",
  po_number: "P02552",
  supplier: "Scorpe Technologies",
  purpose: "project",
  state: "open",
  status: "ordered",
  status_reached_on: "2026-11-10",
  on_hold: false,
  direct_delivery: false,
  computation_status: "encoded",
  signoffs: {
    1: { prepared: true, approved: false },
    3: { prepared: false, approved: false },
    7: { received: false, noted: false, checked: false, approved: false },
  },
  ...over,
})

describe("IPAS_SUMMARY_KEYS", () => {
  it("names no payment or bank column; Landed Cost's total and mark are the only money (#283)", () => {
    const text = IPAS_SUMMARY_KEYS.filter((key) => !["landed_cost_total_php", "landed_cost_mark"].includes(key)).join(" ")
    for (const word of ["amount", "payment", "charge", "bank", "account", "landed", "cost", "price", "total", "proof"]) {
      expect(text).not.toContain(word)
    }
  })
})

describe("shapeIpasSummary: Landed Cost (#283)", () => {
  it("reads the total and its mark for a money reader, and nothing for anyone else", () => {
    expect(shapeIpasSummary(row({ landed_cost_total_php: "7580.00", landed_cost_mark: "provisional" })).landedCost).toEqual({ total: 7580, mark: "provisional" })
    expect(shapeIpasSummary(row({ landed_cost_total_php: null, landed_cost_mark: "unavailable" })).landedCost).toEqual({ total: null, mark: "unavailable" })
    expect(shapeIpasSummary(row({ landed_cost_total_php: null, landed_cost_mark: null })).landedCost).toBeNull()
  })
})

describe("shapeIpasSummary", () => {
  it("reads a row the way the SOR section does", () => {
    const summary = shapeIpasSummary(row())

    expect(summary).toMatchObject({
      id: "ipas-1",
      number: "TGIPAS_049",
      poNumber: "P02552",
      supplier: "Scorpe Technologies",
      purpose: "project",
      state: "open",
      status: "ordered",
      statusReachedOn: "2026-11-10",
      computationStatus: "encoded",
      computationLabel: "Encoded",
      isFiled: false,
      isCancelled: false,
    })
    expect(summary).not.toHaveProperty("buyerTrack")
  })

  it("counts section sign-offs and calls section 7's Approved 'Filed'", () => {
    const summary = shapeIpasSummary(
      row({ state: "filed", signoffs: { 1: { prepared: true, approved: true }, 7: { received: true, approved: true } } }),
    )

    expect(summary.isFiled).toBe(true)
    expect(summary.signoffs.map((s) => [s.section, s.done, s.total])).toEqual([
      [1, 2, 2],
      [3, 0, 2],
      [6, 0, 2],
      [7, 2, 4],
    ])
    expect(summary.signoffs[3].steps.map((s) => s.label)).toEqual(["Received", "Noted", "Checked", "Filed"])
  })

  it("never throws on a half-formed row", () => {
    expect(shapeIpasSummary(null)).toBeNull()
    expect(shapeIpasSummary({})).toBeNull()
    const odd = shapeIpasSummary(row({ signoffs: [1, 2], supplier: "", computation_status: "weird" }))
    expect(odd.supplier).toBeNull()
    expect(odd.computationLabel).toBe("Encoding")
    expect(odd.signoffs.every((s) => s.done === 0)).toBe(true)
  })
})

describe("shapeIpasSummaries / signoffProgress", () => {
  it("keeps the database's order and drops unusable rows", () => {
    const list = shapeIpasSummaries([row({ ipas_id: "a" }), null, row({ ipas_id: "b" })])
    expect(list.map((s) => s.id)).toEqual(["a", "b"])
    expect(shapeIpasSummaries(undefined)).toEqual([])
  })

  it("lists stored sections 1, 3, 6 and 7", () => {
    expect(signoffProgress(undefined).map((s) => s.section)).toEqual([1, 3, 6, 7])
  })
})

describe("shapeIpasSummary: the IPAS Status (#1157)", () => {
  it("reads the status, the day it was reached, On-Hold and Direct delivery", () => {
    const summary = shapeIpasSummary(row({ status: "in_transit", status_reached_on: "2026-11-18", on_hold: true, direct_delivery: false }))

    expect(summary).toMatchObject({ status: "in_transit", statusReachedOn: "2026-11-18", onHold: true, directDelivery: false })
  })

  it("reads an unknown or missing status as none", () => {
    expect(shapeIpasSummary(row({ status: "nonsense" })).status).toBeNull()
    expect(shapeIpasSummary(row({ status: undefined })).status).toBeNull()
  })

  it("writes a day short, with the year only when it is not this year's", () => {
    const today = new Date(2026, 10, 20)
    expect(shortDay("2026-11-18", today)).toBe("Nov 18")
    expect(shortDay("2025-12-02", today)).toBe("Dec 2, 2025")
    expect(shortDay(null, today)).toBe("")
  })
})
