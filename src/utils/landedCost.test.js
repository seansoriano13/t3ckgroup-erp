import { describe, expect, it } from "vitest"
import { blendedRate, isLandedCostEstimate, landedCostEstimateNote, landedCostMarkLabel, paymentRate, pesosFromRate } from "./landedCost"

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

describe("the rate of a payment, and the blend of several (#708)", () => {
  // P01714: a down payment at 58.73 and a full payment at 60.70.
  const p01714 = [
    { amount: 11038.3, forex_rate: 58.73 },
    { amount: 4730.7, forex_rate: 60.7 },
  ]

  it("blends P01714's two rates by how much each payment paid", () => {
    const pesos = 11038.3 * 58.73 + 4730.7 * 60.7
    expect(blendedRate(p01714)).toBeCloseTo(pesos / 15769, 8)
    expect(blendedRate(p01714)).toBeCloseTo(59.32, 2)
    // Not the plain average of the two rates.
    expect(blendedRate(p01714)).not.toBeCloseTo((58.73 + 60.7) / 2, 2)
  })

  it("works an old payment's rate out from its pesos, and leaves out a payment with none", () => {
    expect(paymentRate({ amount: 640, php_debited: 36160 })).toBe(56.5)
    expect(paymentRate({ amount: 640, php_debited: null })).toBeNull()
    expect(blendedRate([...p01714, { amount: 100, php_debited: null }])).toBeCloseTo(blendedRate(p01714), 10)
    expect(blendedRate([])).toBeNull()
  })

  it("works pesos out as amount x rate, to the centavo", () => {
    expect(pesosFromRate(11038.3, 58.73)).toBe(648279.36)
    expect(pesosFromRate(100, null)).toBeNull()
  })
})
