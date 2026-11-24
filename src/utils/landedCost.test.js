import { describe, expect, it } from "vitest"
import { blendedRate, forexRate, isLandedCostEstimate, landedCostEstimateNote, landedCostMarkLabel, paymentRate, pesosFromRate } from "./landedCost"

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

describe("forexRate (#1212)", () => {
  const two = [
    { amount: 300, forex_rate: 50, php_debited: 15000 },
    { amount: 700, forex_rate: 51, php_debited: 35700 },
  ]
  it("shows the blended rate: 300 at 50 and 700 at 51 is 50.70", () => {
    expect(forexRate(two, "USD")).toMatchObject({ text: "50.70", estimate: false })
  })
  it("marks an estimate while a payment has blank pesos", () => {
    const blank = [two[0], { amount: 700, forex_rate: null, php_debited: null }]
    expect(forexRate(blank, "USD")).toMatchObject({ estimate: true, text: "50.00 (estimate)" })
  })
  it("marks an estimate when a rate is typed but the bank pesos are still blank", () => {
    const typed = [two[0], { amount: 700, forex_rate: 51, php_debited: null }]
    expect(forexRate(typed, "USD")).toMatchObject({ estimate: true, text: "50.70 (estimate)" })
    expect(forexRate([{ amount: 700, forex_rate: 51, php_debited: "" }], "USD")).toMatchObject({ estimate: true })
  })
  it("shows none for a PHP IPAS or without a rate", () => {
    expect(forexRate(two, "PHP")).toBeNull()
    expect(forexRate([], "USD")).toBeNull()
  })
})
