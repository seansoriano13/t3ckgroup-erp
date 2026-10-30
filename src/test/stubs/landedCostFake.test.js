import { describe, expect, it } from "vitest"
import { allocate, computeLandedCost, paidRate } from "./landedCostFake"
import { isPhpCurrency, paymentPhp } from "@/utils/landedCost"
import { IPAS_LANDED_COST_REASON, IPAS_LANDED_COST_STATUS } from "@/constants/ipas"

const line = (id, quantity, price_unit, over = {}) => ({
  line_id: id,
  name: `Item ${id}`,
  quantity,
  unit: "Unit",
  price_unit,
  price_subtotal: quantity * price_unit,
  ...over,
})

const copy = (currency, lines) => ({ po: { name: "P02552", currency }, lines })

const pay = (kind, amount, over = {}) => ({
  kind,
  amount,
  php_debited: null,
  charge_fee_php: 0,
  ...over,
})

const charge = (amount_php) => ({ amount_php })

describe("computeLandedCost", () => {
  describe("a peso PO", () => {
    it("takes the unit price from the P0 line, not from the PHP 8,325 paid (sample P02552: 6 x 1,250)", () => {
      // 7,500 + 12% VAT - 1% withholding = 8,325 is what left the bank.
      const result = computeLandedCost({
        copy: copy("Php", [line(11400, 6, 1250, { price_subtotal: 7500 })]),
        payments: [pay("full_payment", 8325)],
      })

      expect(result.status).toBe(IPAS_LANDED_COST_STATUS.PROVISIONAL)
      expect(result.rate).toBeNull()
      expect(result.lines).toHaveLength(1)
      expect(result.lines[0]).toMatchObject({
        lineId: 11400,
        quantity: 6,
        unitPricePhp: 1250,
        goodsPhp: 7500,
        spreadPhp: 0,
        landedPhp: 7500,
        landedPerUnitPhp: 1250,
      })
      expect(result.totals.landedPhp).toBe(7500)
    })

    it("needs no payment at all: a PHP PO is available from the PO's own prices", () => {
      const result = computeLandedCost({ copy: copy("PHP", [line(1, 2, 100)]) })
      expect(result.status).toBe(IPAS_LANDED_COST_STATUS.PROVISIONAL)
      expect(result.lines[0].landedPhp).toBe(200)
    })

    // Three lines, 700 of goods, 700 of charges, fees and shipping to spread:
    //   L1 2 x 100 = 200,  L2 8 x 50 = 400,  L3 10 x 10 = 100
    //   pool = charges 500 + charge fee 100 + shipping fee 100 = 700
    const fixture = {
      copy: copy("Php", [line(1, 2, 100), line(2, 8, 50), line(3, 10, 10)]),
      payments: [pay("payment", 1000, { charge_fee_php: 100 }), pay("shipping_fee", 100)],
      charges: [charge(300), charge(200)],
    }

    const landed = (split) => {
      const result = computeLandedCost({ ...fixture, split })
      return result.lines.map((l) => [l.spreadPhp, l.landedPhp, l.landedPerUnitPhp])
    }

    it("spreads by value (the default), matching a literal fixture", () => {
      expect(landed("value")).toEqual([
        [200, 400, 200],
        [400, 800, 100],
        [100, 200, 20],
      ])
      expect(computeLandedCost(fixture).lines.map((l) => l.landedPhp)).toEqual([400, 800, 200])
    })

    it("spreads by quantity, matching a literal fixture", () => {
      expect(landed("quantity")).toEqual([
        [70, 270, 135],
        [280, 680, 85],
        [350, 450, 45],
      ])
    })

    it("spreads equally, to the centavo, matching a literal fixture", () => {
      // 700 / 3 = 233.33...: the spare centavo goes to the first line.
      expect(landed("equal")).toEqual([
        [233.34, 433.34, 216.67],
        [233.33, 633.33, 79.17],
        [233.33, 333.33, 33.33],
      ])
    })

    it("always hands out exactly the pool, whatever the split", () => {
      for (const split of ["value", "quantity", "equal"]) {
        const result = computeLandedCost({ ...fixture, split })
        const shared = Math.round(result.lines.reduce((sum, l) => sum + l.spreadPhp, 0) * 100) / 100
        expect(shared, split).toBe(700)
        expect(result.totals).toMatchObject({
          goodsPhp: 700,
          chargesPhp: 500,
          chargeFeesPhp: 100,
          shippingFeesPhp: 100,
          spreadPhp: 700,
          landedPhp: 1400,
        })
      }
    })

    it("counts every charge, charge fee and shipping fee, none excluded", () => {
      const result = computeLandedCost({
        copy: copy("Php", [line(1, 1, 1000)]),
        payments: [pay("down_payment", 500, { charge_fee_php: 25 }), pay("shipping_fee", 75, { charge_fee_php: 10 })],
        charges: [charge(100), charge(40)],
      })
      expect(result.totals).toMatchObject({ chargesPhp: 140, chargeFeesPhp: 35, shippingFeesPhp: 75, spreadPhp: 250 })
      expect(result.lines[0].landedPhp).toBe(1250)
    })

    it("falls back to an equal spread, and says so, when nothing is priced to spread by value", () => {
      const result = computeLandedCost({
        copy: copy("Php", [line(1, 1, 0), line(2, 3, 0)]),
        charges: [charge(100)],
        split: "value",
      })
      expect(result.split).toBe("value")
      expect(result.usedSplit).toBe("equal")
      expect(result.lines.map((l) => l.spreadPhp)).toEqual([50, 50])
    })

    it("skips lines that buy nothing and says there is nothing to cost when none are left", () => {
      const result = computeLandedCost({ copy: copy("Php", [line(1, 0, 100)]) })
      expect(result.status).toBe(IPAS_LANDED_COST_STATUS.UNAVAILABLE)
      expect(result.reason).toBe(IPAS_LANDED_COST_REASON.NO_LINES)
    })
  })

  describe("a foreign-currency PO", () => {
    // Two lines, USD 200 each. Payments: USD 150 for PHP 8,400 and USD 250 for
    // PHP 14,350: 22,750 / 400 = 56.875 PHP to the dollar.
    const usd = {
      copy: copy("USD", [line(1, 10, 20), line(2, 5, 40)]),
      payments: [
        pay("down_payment", 150, { php_debited: 8400, charge_fee_php: 300 }),
        pay("full_payment", 250, { php_debited: 14350, charge_fee_php: 200 }),
      ],
      charges: [charge(1000), charge(2000)],
    }

    it("converts at their combined PHP debited / combined USD", () => {
      const result = computeLandedCost(usd)

      expect(result.isForeign).toBe(true)
      expect(result.rate.rate).toBeCloseTo(56.875, 10)
      expect(result.rate).toMatchObject({ phpDebited: 22750, foreignPaid: 400, payments: 2 })
      expect(result.lines.map((l) => [l.unitPricePhp, l.goodsPhp])).toEqual([
        [1137.5, 11375],
        [2275, 11375],
      ])
      // Pool 1,000 + 2,000 + 300 + 200 = 3,500, by value: 1,750 each.
      expect(result.lines.map((l) => [l.spreadPhp, l.landedPhp, l.landedPerUnitPhp])).toEqual([
        [1750, 13125, 1312.5],
        [1750, 13125, 2625],
      ])
    })

    it("is not available with no payments, never guessed from a rate", () => {
      const result = computeLandedCost({ ...usd, payments: [] })
      expect(result.status).toBe(IPAS_LANDED_COST_STATUS.UNAVAILABLE)
      expect(result.reason).toBe(IPAS_LANDED_COST_REASON.NO_PAYMENTS)
      expect(result.lines).toEqual([])
      expect(result.totals).toBeNull()
      expect(result.rate).toBeNull()
    })

    it("is not available while a payment's pesos are blank and no Reference Rate can stand in", () => {
      const result = computeLandedCost({ ...usd, payments: [pay("payment", 400, { paid_on: "2026-10-01" })] })
      expect(result.status).toBe(IPAS_LANDED_COST_STATUS.UNAVAILABLE)
      expect(result.reason).toBe(IPAS_LANDED_COST_REASON.NO_REFERENCE_RATE)
    })

    describe("an estimate, while a payment's pesos taken from the bank are blank (#604)", () => {
      const rates = [
        { currency: "USD", rate_date: "2026-09-28", php_per_unit: 55 },
        { currency: "USD", rate_date: "2026-10-02", php_per_unit: 99 },
        { currency: "EUR", rate_date: "2026-09-28", php_per_unit: 66 },
      ]
      // 200 x 1 USD of goods, so Landed Cost is the pesos of the payments.
      const oneUsd = copy("USD", [line(1, 200, 1)])
      const final = { computationStatus: "lc_odoo_done" }

      it("takes the blank payment at the Reference Rate of its payment date: the latest on or before it", () => {
        const result = computeLandedCost({
          copy: oneUsd,
          payments: [pay("payment", 200, { paid_on: "2026-10-01" })],
          referenceRates: rates,
        })
        expect(result.estimate).toBe(true)
        expect(result.status).toBe(IPAS_LANDED_COST_STATUS.PROVISIONAL)
        expect(result.rate).toMatchObject({ rate: 55, phpDebited: 11000, foreignPaid: 200, payments: 1, estimatedPayments: 1, estimatedPhp: 11000 })
        expect(result.estimates).toEqual([
          { paymentId: null, kind: "payment", paidOn: "2026-10-01", amount: 200, referenceRate: 55, rateDate: "2026-09-28", php: 11000 },
        ])
        expect(result.totals.landedPhp).toBe(11000)
      })

      it("mixes what was actually paid with the Reference Rate for the rest", () => {
        const result = computeLandedCost({
          copy: oneUsd,
          payments: [
            pay("down_payment", 100, { paid_on: "2026-09-30", php_debited: 6000 }),
            pay("payment", 100, { paid_on: "2026-10-01" }),
          ],
          referenceRates: rates,
        })
        // 6,000 paid + 100 x 55 estimated = 11,500 over 200: 57.5 a dollar.
        expect(result.estimate).toBe(true)
        expect(result.rate).toMatchObject({ phpDebited: 11500, foreignPaid: 200, payments: 2, estimatedPayments: 1, estimatedPhp: 5500 })
        expect(result.rate.rate).toBe(57.5)
        expect(result.totals.landedPhp).toBe(11500)
      })

      it("is never final, even at LC Odoo Done or filed", () => {
        const payments = [pay("payment", 200, { paid_on: "2026-10-01" })]
        expect(computeLandedCost({ copy: oneUsd, payments, referenceRates: rates, ...final }).status).toBe(IPAS_LANDED_COST_STATUS.PROVISIONAL)
        expect(computeLandedCost({ copy: oneUsd, payments, referenceRates: rates, filed: true }).status).toBe(IPAS_LANDED_COST_STATUS.PROVISIONAL)
      })

      it("is the final figure at the rate actually paid once the pesos are in", () => {
        const payments = [pay("payment", 200, { paid_on: "2026-10-01", php_debited: 11400 })]
        const estimate = computeLandedCost({ copy: oneUsd, payments: [pay("payment", 200, { paid_on: "2026-10-01" })], referenceRates: rates })
        const actual = computeLandedCost({ copy: oneUsd, payments, referenceRates: rates, ...final })
        expect(estimate.estimate).toBe(true)
        expect(estimate.totals.landedPhp).toBe(11000)
        expect(actual.estimate).toBe(false)
        expect(actual.estimates).toEqual([])
        expect(actual.status).toBe(IPAS_LANDED_COST_STATUS.FINAL)
        expect(actual.rate.rate).toBe(57)
        expect(actual.totals.landedPhp).toBe(11400)
      })

      it("takes a blank shipping fee at its estimated pesos too", () => {
        const result = computeLandedCost({
          copy: copy("USD", [line(1, 100, 1)]),
          payments: [
            pay("payment", 100, { paid_on: "2026-10-01", php_debited: 5500 }),
            pay("shipping_fee", 10, { paid_on: "2026-10-01" }),
          ],
          referenceRates: rates,
        })
        expect(result.totals.shippingFeesPhp).toBe(550)
        expect(result.estimate).toBe(true)
      })

      it("looks at the PO's own currency, and a peso PO has no estimate at all", () => {
        const eur = computeLandedCost({ copy: copy("EUR", [line(1, 10, 1)]), payments: [pay("payment", 10, { paid_on: "2026-10-01" })], referenceRates: rates })
        expect(eur.rate.rate).toBe(66)
        const php = computeLandedCost({ copy: copy("PHP", [line(1, 10, 1)]), payments: [pay("payment", 10)], referenceRates: rates })
        expect(php.estimate).toBe(false)
        expect(php.estimates).toEqual([])
      })

      it("is not available when the blank payment is older than every Reference Rate", () => {
        const result = computeLandedCost({ copy: oneUsd, payments: [pay("payment", 200, { paid_on: "2026-01-01" })], referenceRates: rates })
        expect(result.status).toBe(IPAS_LANDED_COST_STATUS.UNAVAILABLE)
        expect(result.reason).toBe(IPAS_LANDED_COST_REASON.NO_REFERENCE_RATE)
      })
    })

    it("takes a shipping fee's PHP from its own PHP debited", () => {
      // The shipping fee counts in the rate, as a payment: 6,200 / 110.
      const result = computeLandedCost({
        copy: copy("USD", [line(1, 1, 100)]),
        payments: [
          pay("payment", 100, { php_debited: 5600 }),
          pay("shipping_fee", 10, { php_debited: 600 }),
        ],
      })
      expect(result.rate.rate).toBeCloseTo(6200 / 110, 10)
      expect(result.totals).toMatchObject({ shippingFeesPhp: 600, goodsPhp: 5636.36, landedPhp: 6236.36 })
    })

    it("treats an unknown or missing currency as foreign", () => {
      const result = computeLandedCost({ copy: copy(null, [line(1, 1, 10)]) })
      expect(result.status).toBe(IPAS_LANDED_COST_STATUS.UNAVAILABLE)
      expect(result.isForeign).toBe(true)
    })
  })

  describe("provisional and final", () => {
    const base = { copy: copy("Php", [line(1, 1, 100)]) }

    it.each([
      ["encoding", IPAS_LANDED_COST_STATUS.PROVISIONAL],
      ["encoded", IPAS_LANDED_COST_STATUS.PROVISIONAL],
      ["lc_odoo_done", IPAS_LANDED_COST_STATUS.FINAL],
    ])("reads %s as %s", (computationStatus, status) => {
      expect(computeLandedCost({ ...base, computationStatus }).status).toBe(status)
    })

    it("reads a filed IPAS as final whatever its status", () => {
      expect(computeLandedCost({ ...base, computationStatus: "encoded", filed: true }).status).toBe(
        IPAS_LANDED_COST_STATUS.FINAL,
      )
    })

    it("stays unavailable at Costs complete rather than reading final", () => {
      const result = computeLandedCost({ copy: copy("USD", [line(1, 1, 100)]), computationStatus: "lc_odoo_done" })
      expect(result.status).toBe(IPAS_LANDED_COST_STATUS.UNAVAILABLE)
    })
  })

  it("never throws on a copy, rows or figures that are missing or malformed", () => {
    const inputs = [
      undefined,
      {},
      { copy: null },
      { copy: { po: null, lines: "nope" } },
      { copy: copy("Php", [{ quantity: "abc", price_unit: "x" }, null, line(1, "2", "50")]), payments: [null, {}], charges: [{ amount_php: "x" }] },
      { copy: copy("Php", [line(1, 1, 10)]), split: "weird", computationStatus: "???" },
    ]
    for (const input of inputs) {
      expect(() => computeLandedCost(input)).not.toThrow()
    }
    const sloppy = computeLandedCost(inputs[4])
    expect(sloppy.lines.map((l) => l.landedPhp)).toEqual([100])
  })
})

describe("computeLandedCost freight (#709)", () => {
  const oneLine = copy("USD", [line(1, 10, 100)])
  const paid = [pay("full_payment", 1000, { php_debited: 59320 })]

  it("converts freight in the PO's currency at the blended rate", () => {
    const result = computeLandedCost({ copy: oneLine, payments: paid, freight: { amount: 470, currency: "USD" } })
    expect(result.totals.freightPhp).toBe(27880.4)
    expect(result.totals.landedPhp).toBe(59320 + 27880.4)
  })

  it("does not add freight the supplier billed again", () => {
    const result = computeLandedCost({
      copy: oneLine,
      payments: paid,
      freight: { amount: 470, currency: "USD", billedBySupplier: true },
    })
    expect(result.totals.freightPhp).toBe(0)
    expect(result.totals.landedPhp).toBe(59320)
  })

  it("takes a peso freight as it is", () => {
    const result = computeLandedCost({ copy: oneLine, payments: paid, freight: { amount: 1500, currency: "PHP" } })
    expect(result.totals.freightPhp).toBe(1500)
  })

  it("counts a typed freight once: the older shipping-fee payments stop counting (review fix)", () => {
    const withShipping = [...paid, pay("shipping_fee", 100, { php_debited: 5900 })]
    const old = computeLandedCost({ copy: oneLine, payments: withShipping })
    expect(old.totals.shippingFeesPhp).toBe(5900)
    const typed = computeLandedCost({ copy: oneLine, payments: withShipping, freight: { amount: 1500, currency: "PHP" } })
    expect(typed.totals.shippingFeesPhp).toBe(0)
    expect(typed.totals.freightPhp).toBe(1500)
    const billed = computeLandedCost({ copy: oneLine, payments: withShipping, freight: { amount: 1500, currency: "PHP", billedBySupplier: true } })
    expect(billed.totals.spreadPhp).toBe(0)
  })

  it("says Landed Cost is unavailable for freight in a third currency, rather than dropping it", () => {
    const result = computeLandedCost({ copy: oneLine, payments: paid, freight: { amount: 20, currency: "EUR" } })
    expect(result.status).toBe(IPAS_LANDED_COST_STATUS.UNAVAILABLE)
    expect(result.reason).toBe(IPAS_LANDED_COST_REASON.FREIGHT_CURRENCY)
  })

  it("reads a payment's pesos as amount x forex rate, not the separately-written php_debited", () => {
    const result = computeLandedCost({ copy: oneLine, payments: [pay("full_payment", 1000, { forex_rate: 60, php_debited: 1 })] })
    expect(result.rate.rate).toBe(60)
    expect(result.totals.goodsPhp).toBe(60000)
  })

  it("counts a blank charge as nothing", () => {
    const result = computeLandedCost({ copy: oneLine, payments: paid, charges: [{ amount_php: null }, charge(200)] })
    expect(result.totals.chargesPhp).toBe(200)
  })
})

describe("allocate", () => {
  it("shares whole centavos in proportion and sums exactly to the total", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(allocate(70000, [200, 400, 100])).toEqual([20000, 40000, 10000])
    expect(allocate(5, [0, 0])).toEqual([0, 0])
    expect(allocate(5, [])).toEqual([])
  })

  it("gives leftover centavos to the largest remainders, earlier line first on a tie", () => {
    expect(allocate(10, [1, 1, 1, 1, 1, 1])).toEqual([2, 2, 2, 2, 1, 1])
    expect(allocate(7, [5, 1, 1])).toEqual([5, 1, 1])
  })
})

describe("paidRate and paymentPhp", () => {
  it("is the PHP debited over the foreign paid, or null with nothing to go on", () => {
    expect(paidRate([{ amount: 100, php_debited: 5000 }, { amount: 100, php_debited: 6000 }]).rate).toBe(55)
    expect(paidRate([])).toBeNull()
    expect(paidRate([{ amount: 100, php_debited: null }])).toBeNull()
    expect(paidRate([{ amount: "100", php_debited: "5600" }]).rate).toBe(56)
  })

  it("reads a peso payment's PHP as its amount, and a foreign one's as its PHP debited", () => {
    expect(paymentPhp({ amount: 500, php_debited: 9 }, true)).toBe(500)
    expect(paymentPhp({ amount: 500, php_debited: 28000 }, false)).toBe(28000)
    expect(paymentPhp({ amount: 500, php_debited: null }, false)).toBeNull()
  })

  it("recognises the peso whatever the case", () => {
    expect(["PHP", "php", " Php "].every(isPhpCurrency)).toBe(true)
    expect(["USD", "", null, undefined].some(isPhpCurrency)).toBe(false)
  })
})
