import { describe, expect, it } from "vitest"
import { isLandedCostEstimate, landedCostEstimateNote, landedCostMarkLabel } from "./landedCost"

// What `ipas_landed_cost` returns, trimmed to what the marks read (#604).
const provisional = { status: "provisional", estimate: false, estimates: [] }
const estimate = (count = 1) => ({
  status: "provisional",
  estimate: true,
  estimates: Array.from({ length: count }, (_, i) => ({ paymentId: `p${i}` })),
})
const final = { status: "final", estimate: false, estimates: [] }
const unavailable = { status: "unavailable", estimate: false, reason: "no_payments" }

describe("the mark Landed Cost carries", () => {
  it("is an estimate only while a payment's pesos taken from the bank are blank", () => {
    expect(isLandedCostEstimate(estimate())).toBe(true)
    expect(isLandedCostEstimate(provisional)).toBe(false)
    expect(isLandedCostEstimate(final)).toBe(false)
    expect(isLandedCostEstimate(null)).toBe(false)
  })

  it("is never an estimate when it isn't available, whatever the flag says", () => {
    expect(isLandedCostEstimate({ ...unavailable, estimate: true })).toBe(false)
  })

  it("reads Estimate, Provisional, Final or Not available", () => {
    expect(landedCostMarkLabel(estimate())).toBe("Estimate")
    expect(landedCostMarkLabel(provisional)).toBe("Provisional")
    expect(landedCostMarkLabel(final)).toBe("Final")
    expect(landedCostMarkLabel(unavailable)).toBe("Not available")
    expect(landedCostMarkLabel(undefined)).toBe("Not available")
  })

  it("explains an estimate in one sentence that counts the payments, and says nothing of a final figure", () => {
    expect(landedCostEstimateNote(estimate(1))).toMatch(/^Estimate: A payment is taken at the Reference Rate of its payment date/)
    expect(landedCostEstimateNote(estimate(3))).toMatch(/^Estimate: 3 payments are taken at the Reference Rate/)
    expect(landedCostEstimateNote(estimate())).toMatch(/becomes final when they are\.$/)
    expect(landedCostEstimateNote(final)).toBeNull()
    expect(landedCostEstimateNote(provisional)).toBeNull()
  })
})
