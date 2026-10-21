import { describe, expect, it } from "vitest"
import { IPAS_AMOUNT_SOURCE, IPAS_BILL_CHECK, ipasFigures, odooPoTotal } from "./ipasFigures"

const line = (subtotal) => ({ line_id: 1, name: "Item", quantity: 1, price_unit: subtotal, price_subtotal: subtotal })

// A shaped IPAS as the list reads it: the Odoo copy, the typed P.I/QT Amount and its payments.
const ipas = ({ total = 11200, untaxed = 10000, lines, copyOver, ...over } = {}) => ({
  state: "open",
  currency: "Php",
  pi_qt_amount: null,
  payments: [],
  odoo_copy: {
    po: { name: "P02552", currency: "Php", amount_untaxed: untaxed, amount_tax: total - untaxed, amount_total: total },
    lines: lines ?? [line(untaxed)],
    ...copyOver,
  },
  ...over,
})

const pay = (kind, amount, methodLabel, over = {}) => ({ kind, amount, methodLabel, ...over })

describe("ipasFigures: Amount", () => {
  it.each([
    ["the P.I/QT Amount when it is typed", { pi_qt_amount: 10800 }, 10800, IPAS_AMOUNT_SOURCE.PI_QT],
    ["the Odoo PO total (tax included) when it is not", {}, 11200, IPAS_AMOUNT_SOURCE.ODOO_PO],
    ["the Odoo PO total when the typed amount is blank text", { pi_qt_amount: "" }, 11200, IPAS_AMOUNT_SOURCE.ODOO_PO],
    ["the typed amount even when it is 0", { pi_qt_amount: 0 }, 0, IPAS_AMOUNT_SOURCE.PI_QT],
    ["a typed amount that arrives as a string from the database", { pi_qt_amount: "10800.00" }, 10800, IPAS_AMOUNT_SOURCE.PI_QT],
  ])("is %s", (_name, over, amount, source) => {
    const figures = ipasFigures(ipas(over))
    expect(figures.amount).toBe(amount)
    expect(figures.amountSource).toBe(source)
    expect(figures.amountBeforeTax).toBe(false)
  })

  it("falls back to the sum of the lines, marked before tax, for an old copy without totals", () => {
    const figures = ipasFigures(
      ipas({ copyOver: { po: { name: "P02552", currency: "Php" }, lines: [line(7500), line(2500.5)] } }),
    )
    expect(figures.poTotal).toBe(10000.5)
    expect(figures.poTotalBeforeTax).toBe(true)
    expect(figures.amount).toBe(10000.5)
    expect(figures.amountSource).toBe(IPAS_AMOUNT_SOURCE.ODOO_PO)
    expect(figures.amountBeforeTax).toBe(true)
  })

  it("has no Amount when nothing is typed and the copy has neither a total nor lines", () => {
    const figures = ipasFigures(ipas({ copyOver: { po: { name: "P02552" }, lines: [] } }))
    expect(figures.amount).toBeNull()
    expect(figures.amountSource).toBeNull()
    expect(figures.remainingBalance).toBeNull()
  })

  it("does not choke on an IPAS with no copy at all", () => {
    expect(ipasFigures({ state: "open", payments: [] }).amount).toBeNull()
    expect(ipasFigures(null).paymentMethods).toEqual([])
  })

  it("reads the PO's stated total before its lines", () => {
    expect(odooPoTotal({ po: { amount_total: 5600 }, lines: [line(1)] })).toEqual({ total: 5600, beforeTax: false })
    expect(odooPoTotal({ po: {}, lines: [line(1), line(2)] })).toEqual({ total: 3, beforeTax: true })
    expect(odooPoTotal({ po: {}, lines: [] })).toBeNull()
  })
})

describe("ipasFigures: bill check", () => {
  it.each([
    ["missing when the P.I/QT Amount is blank", { pi_qt_amount: null }, IPAS_BILL_CHECK.MISSING, null],
    ["matches when the P.I equals the Odoo total", { pi_qt_amount: 11200 }, IPAS_BILL_CHECK.MATCHES, 0],
    ["differs, P.I higher, with a signed difference", { pi_qt_amount: 16200 }, IPAS_BILL_CHECK.DIFFERS, 5000],
    ["differs, P.I lower, with a negative difference", { pi_qt_amount: 6200 }, IPAS_BILL_CHECK.DIFFERS, -5000],
    ["differs by a single cent (compared to the cent)", { pi_qt_amount: 11200.01 }, IPAS_BILL_CHECK.DIFFERS, 0.01],
  ])("is %s", (_name, over, status, difference) => {
    const check = ipasFigures(ipas(over)).billCheck
    expect(check.status).toBe(status)
    expect(check.difference).toBe(difference)
    expect(check.poBeforeTax).toBe(false)
  })

  it("is not fooled by floating point (0.1 + 0.2 against 0.3)", () => {
    const check = ipasFigures(ipas({ pi_qt_amount: 0.3, copyOver: { po: { amount_total: 0.1 + 0.2 }, lines: [] } })).billCheck
    expect(check.status).toBe(IPAS_BILL_CHECK.MATCHES)
  })

  it("says the Odoo side is before tax for an old copy instead of reporting it as the PO total", () => {
    const check = ipasFigures(
      ipas({ pi_qt_amount: 11200, copyOver: { po: { name: "P02552" }, lines: [line(10000)] } }),
    ).billCheck
    expect(check.poBeforeTax).toBe(true)
    expect(check.difference).toBe(1200)
  })

  it("is missing when the Odoo side has no figure at all", () => {
    const figures = ipasFigures(ipas({ pi_qt_amount: 500, copyOver: { po: {}, lines: [] } }))
    expect(figures.billCheck.status).toBe(IPAS_BILL_CHECK.MISSING)
    expect(figures.amount).toBe(500)
  })
})

describe("ipasFigures: payments", () => {
  it("adds up DP and FP by kind, and Paid across every kind", () => {
    const figures = ipasFigures(
      ipas({
        payments: [
          pay("down_payment", 3000, "Bank TT"),
          pay("down_payment", 1000.5, "Bank TT"),
          pay("payment", 500, "Cash"),
          pay("shipping_fee", 100, "Cash"),
        ],
      }),
    )
    expect(figures.downPayment).toBe(4000.5)
    expect(figures.fullPayment).toBe(0)
    expect(figures.hasFullPayment).toBe(false)
    expect(figures.paid).toBe(4600.5)
  })

  it("lists each method once, in the order first used", () => {
    const figures = ipasFigures(
      ipas({
        payments: [
          pay("down_payment", 100, "Bank TT", { paid_on: "2026-10-01" }),
          pay("payment", 100, "Cash", { paid_on: "2026-10-02" }),
          pay("payment", 100, "Bank TT", { paid_on: "2026-10-03" }),
          pay("full_payment", 100, "Cash", { paid_on: "2026-10-04" }),
        ],
      }),
    )
    expect(figures.paymentMethods).toEqual(["Bank TT", "Cash"])
    expect(figures.paymentScheme).toBe("Bank TT + Cash")
  })

  it("orders first use by the day paid, not by the order the rows arrive in", () => {
    const figures = ipasFigures(
      ipas({
        payments: [
          pay("payment", 100, "Cash", { paid_on: "2026-10-05" }),
          pay("down_payment", 100, "Bank TT", { paid_on: "2026-10-01" }),
        ],
      }),
    )
    expect(figures.paymentScheme).toBe("Bank TT + Cash")
  })

  it("reads a method off the payment's method row, and skips a payment with no method", () => {
    const figures = ipasFigures(
      ipas({ payments: [{ kind: "payment", amount: 1, method: { label: "Petnet" } }, { kind: "payment", amount: 1, methodLabel: null }] }),
    )
    expect(figures.paymentMethods).toEqual(["Petnet"])
  })

  it("has a blank Payment scheme and zero figures with no payments", () => {
    const figures = ipasFigures(ipas())
    expect(figures.paymentMethods).toEqual([])
    expect(figures.paymentScheme).toBe("")
    expect([figures.downPayment, figures.fullPayment, figures.paid]).toEqual([0, 0, 0])
  })

  it("adds cents without drifting", () => {
    const figures = ipasFigures(ipas({ payments: [pay("payment", 0.1, "Cash"), pay("payment", 0.2, "Cash")] }))
    expect(figures.paid).toBe(0.3)
  })
})

describe("ipasFigures: Remaining balance", () => {
  it("is the Amount less every payment recorded", () => {
    const figures = ipasFigures(
      ipas({ pi_qt_amount: 10000, payments: [pay("down_payment", 3000, "Bank TT"), pay("payment", 2000, "Bank TT"), pay("shipping_fee", 500, "Cash")] }),
    )
    expect(figures.remainingBalance).toBe(4500)
  })

  it("is the whole Amount before anything is paid", () => {
    expect(ipasFigures(ipas({ pi_qt_amount: 10000 })).remainingBalance).toBe(10000)
    expect(ipasFigures(ipas()).remainingBalance).toBe(11200)
  })

  it("keeps an owing balance when withholding leaves the payments short, until a full payment settles it", () => {
    const down = pay("down_payment", 5000, "Bank TT")
    const short = pay("payment", 4500, "Bank TT")
    expect(ipasFigures(ipas({ pi_qt_amount: 10000, payments: [down, short] })).remainingBalance).toBe(500)

    // Tax withheld: the full payment is 450 short of the Amount, yet nothing is owed (ADR 0035).
    const full = pay("full_payment", 4550, "Bank TT")
    const settled = ipasFigures(ipas({ pi_qt_amount: 10000, payments: [down, full] }))
    expect(settled.paid).toBe(9550)
    expect(settled.remainingBalance).toBe(0)
  })

  it("is 0 once the IPAS is filed, whatever was paid", () => {
    expect(ipasFigures(ipas({ state: "filed", pi_qt_amount: 10000, payments: [pay("payment", 1000, "Cash")] })).remainingBalance).toBe(0)
    expect(ipasFigures(ipas({ state: "filed", pi_qt_amount: 10000 })).remainingBalance).toBe(0)
  })

  it("still counts down for a cancelled IPAS (the status, not the balance, hides it)", () => {
    expect(ipasFigures(ipas({ state: "cancelled", pi_qt_amount: 10000, payments: [pay("payment", 1000, "Cash")] })).remainingBalance).toBe(9000)
  })

  it("shows an overpayment as a negative balance rather than hiding it", () => {
    expect(ipasFigures(ipas({ pi_qt_amount: 1000, payments: [pay("payment", 1200, "Cash")] })).remainingBalance).toBe(-200)
  })
})

describe("ipasFigures: currencies", () => {
  it("reports each IPAS in its own PO's currency and never converts", () => {
    const usd = ipasFigures(
      ipas({ currency: "USD", pi_qt_amount: 1500, payments: [pay("down_payment", 500, "Bank TT")], copyOver: { po: { currency: "USD", amount_total: 1500 } } }),
    )
    const php = ipasFigures(ipas({ payments: [pay("down_payment", 500, "Cash")] }))
    expect(usd.currency).toBe("USD")
    expect(usd.remainingBalance).toBe(1000)
    expect(php.currency).toBe("Php")
    expect(php.remainingBalance).toBe(10700)
  })

  it("takes the currency from the copy when the IPAS is not shaped yet", () => {
    expect(ipasFigures({ odoo_copy: { po: { currency: "EUR", amount_total: 10 } }, payments: [] }).currency).toBe("EUR")
  })
})
