import { describe, expect, it } from "vitest"
import { estimateLanded, lineLanded } from "./costingMath"

/** Landed / unit on the Costing sheet (#702): the estimate on the peso price, then the real IPAS figure. */
const ADDONS = { import: 18, local: 0 }

const foreign = (pesos) => ({ components: [{ quantity: 2, p0_unit_price: pesos, p0_quoted_unit_price: 10, p0_currency: "USD" }], quantity: 2 })
const local = (pesos, extra = {}) => ({ components: [{ quantity: 2, acquire_unit: pesos, acquire_source: "typed", ...extra }], quantity: 2 })

describe("estimateLanded", () => {
  it("adds the percent to the peso price, to the centavo", () => {
    expect(estimateLanded(100, 18)).toBe(118)
    expect(estimateLanded(33.33, 18)).toBe(39.33)
    expect(estimateLanded(100, 0)).toBe(100)
  })

  it("is blank while the price is blank", () => {
    expect(estimateLanded(null, 18)).toBeNull()
  })
})

describe("lineLanded", () => {
  it("estimates a foreign-currency row with the Import add-on", () => {
    expect(lineLanded(foreign(1000), ADDONS)).toEqual({ kind: "estimate", unit: 1180, percent: 18, local: false })
  })

  it("changing the add-on changes every estimate", () => {
    const rows = [foreign(1000), foreign(500)]
    expect(rows.map((row) => lineLanded(row, { import: 10, local: 0 }).unit)).toEqual([1100, 550])
  })

  it("gives a local row no add-on unless the Local default is above zero", () => {
    expect(lineLanded(local(200), ADDONS)).toEqual({ kind: "estimate", unit: 200, percent: 0, local: true })
    expect(lineLanded(local(200), { import: 18, local: 5 }).unit).toBe(210)
  })

  it("switches to the IPAS's real Landed Cost once the item has one", () => {
    const row = local(200, { landed_cost: { total: 500, unit: 250, mark: "provisional" } })
    expect(lineLanded(row, ADDONS)).toEqual({ kind: "real", unit: 250, mark: "provisional" })
    const done = local(200, { landed_cost: { total: 500, unit: 250, mark: "final" } })
    expect(lineLanded(done, ADDONS).mark).toBe("final")
  })

  it("keeps estimating while the Landed Cost is blank", () => {
    const row = local(200, { landed_cost: { total: null, unit: null, mark: null, blankReason: "not_ordered" } })
    expect(lineLanded(row, ADDONS).kind).toBe("estimate")
  })

  it("is blank with no cost", () => {
    expect(lineLanded({ components: [], quantity: 1 }, ADDONS)).toBeNull()
  })
})
