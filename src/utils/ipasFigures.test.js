import { describe, expect, it } from "vitest"
import { IPAS_AMOUNT_SOURCE, IPAS_BILL_CHECK, ipasFigures, ipasTotalsByCurrency, odooPoTotal, paidLeftText } from "./ipasFigures"
import { IPAS_PAYMENT_STATUS_LABELS } from "../constants/ipas"

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

describe("ipasFigures: overpaid (spec #1123, A2)", () => {
  it("reads how far the payments pass the order amount, and 0 when they do not", () => {
    expect(ipasFigures(ipas({ payments: [pay("full_payment", 12000, "Bank TT")] })).overpaidBy).toBe(800)
    expect(ipasFigures(ipas({ payments: [pay("full_payment", 11200, "Bank TT")] })).overpaidBy).toBe(0)
    expect(ipasFigures(ipas({ payments: [] })).overpaidBy).toBe(0)
  })

  it("still reads 0 remaining once a full payment settles it, but says how much it is over", () => {
    const figures = ipasFigures(ipas({ payments: [pay("full_payment", 12000, "Bank TT")] }))
    expect(figures.remainingBalance).toBe(0)
    expect(figures.overpaidBy).toBe(800)
  })
})

describe("ipasFigures: Amount", () => {
  it.each([
    ["the P.I/QT Amount when it is typed", { pi_qt_amount: 10800 }, 10800, IPAS_AMOUNT_SOURCE.PI_QT],
    ["the Odoo P0 total (tax included) when it is not", {}, 11200, IPAS_AMOUNT_SOURCE.ODOO_PO],
    ["the Odoo P0 total when the typed amount is blank text", { pi_qt_amount: "" }, 11200, IPAS_AMOUNT_SOURCE.ODOO_PO],
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

  it("reads the P0's stated total before its lines", () => {
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

  it("says the Odoo side is before tax for an old copy instead of reporting it as the P0 total", () => {
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

    // Tax withheld: the full payment is 450 short of the Amount, yet nothing is owed (ADR 0036).
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
  it("reports each IPAS in its own P0's currency and never converts", () => {
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

describe("ipasFigures: IPAS Status (#1154, ADR 0054)", () => {
  const full = pay("full_payment", 11200, "Bank TT")
  const down = pay("down_payment", 3000, "Bank TT")
  const statusOf = (over) => ipasFigures(ipas(over)).status

  // The status is stored and set by hand: the figures pass it through, and a cancelled IPAS has none.
  it.each([
    ["the stored step, as it is", { status: "in_transit" }, "in_transit"],
    ["Order-Draft on a new IPAS", { status: "order_draft" }, "order_draft"],
    ["Done once filed", { state: "filed", status: "done" }, "done"],
    ["none: nothing stored", {}, null],
    ["none: cancelled, whatever was stored", { state: "cancelled", status: "ordered" }, null],
  ])("%s", (_name, over, expected) => {
    expect(statusOf(over)).toBe(expected)
  })

  it("is not worked out from payments, sign-offs or work done", () => {
    expect(statusOf({ payments: [down, full], section1Started: true, workedOn: true })).toBeNull()
    expect(statusOf({ status: "ordered", payments: [down, full] })).toBe("ordered")
  })

  it("reads the On-Hold flag and its note beside the step; the note only shows while on hold", () => {
    const held = ipasFigures(ipas({ status: "in_transit", on_hold: true, on_hold_note: "Supplier issue" }))
    expect(held.status).toBe("in_transit")
    expect(held.onHold).toBe(true)
    expect(held.onHoldNote).toBe("Supplier issue")
    const free = ipasFigures(ipas({ status: "in_transit", on_hold: false, on_hold_note: "stale" }))
    expect(free.status).toBe("in_transit")
    expect(free.onHold).toBe(false)
    expect(free.onHoldNote).toBeNull()
  })

  it("has no status for no IPAS at all", () => {
    expect(ipasFigures(null).status).toBeNull()
  })

  describe("the Remaining balance settles on a full payment or filing (ADR 0036, amended)", () => {
    const owing = { pi_qt_amount: 10000 }

    it("is 0 when a full payment is recorded, with tax withheld", () => {
      const payments = [pay("down_payment", 5000, "Cash"), pay("full_payment", 4550, "Cash")]
      expect(ipasFigures(ipas({ ...owing, payments })).remainingBalance).toBe(0)
    })

    it("is 0 once filed, with or without payments", () => {
      expect(ipasFigures(ipas({ ...owing, state: "filed" })).remainingBalance).toBe(0)
      expect(ipasFigures(ipas({ ...owing, state: "filed", payments: [down] })).remainingBalance).toBe(0)
    })

    it("reads the facts, never the status", () => {
      const payments = [pay("down_payment", 5000, "Cash"), pay("full_payment", 4550, "Cash")]
      expect(ipasFigures(ipas({ ...owing, status: "order_draft", payments })).remainingBalance).toBe(0)
      expect(ipasFigures(ipas({ ...owing, status: "done" })).remainingBalance).toBe(10000)
    })

    it("is not zeroed by a part payment or nothing paid", () => {
      expect(ipasFigures(ipas({ ...owing, payments: [down] })).remainingBalance).toBe(7000)
      expect(ipasFigures(ipas(owing)).remainingBalance).toBe(10000)
    })

    it("a cancelled IPAS counts down even with a full payment", () => {
      const payments = [pay("full_payment", 4000, "Cash")]
      expect(ipasFigures(ipas({ ...owing, state: "cancelled", payments })).remainingBalance).toBe(6000)
    })
  })
})

describe("ipasTotalsByCurrency", () => {
  const row = (currency, amount, remainingBalance) => ({ figures: { currency, amount, remainingBalance } })

  it("adds per currency to the centavo, in the order each first appears, and never across currencies", () => {
    const totals = ipasTotalsByCurrency([row("USD", 0.1, 0.1), row("PHP", 10, 4), row("USD", 0.2, 0.2), row(null, null, null)])
    expect(totals).toEqual([
      { currency: "USD", amount: 0.3, remainingBalance: 0.3, count: 2 },
      { currency: "PHP", amount: 10, remainingBalance: 4, count: 1 },
      { currency: null, amount: 0, remainingBalance: 0, count: 1 },
    ])
  })
})

describe("ipasFigures: Payment status (ADR 0055)", () => {
  const ask = { amount: 5600, purpose: "down_payment", note: null }

  it("reads Not due yet with nothing paid and no ask", () => {
    expect(ipasFigures(ipas()).paymentStatus).toBe("not_due_yet")
  })

  it("reads For payment while an ask is open, whatever was paid before", () => {
    expect(ipasFigures(ipas({ payment_ask: ask })).paymentStatus).toBe("for_payment")
    const part = ipasFigures(ipas({ payment_ask: ask, payments: [pay("down_payment", 5600, "Bank TT")] }))
    expect(part.paymentStatus).toBe("for_payment")
    expect(part.paymentAsk).toEqual(ask)
  })

  it("reads DP paid with some paid and a balance left", () => {
    expect(ipasFigures(ipas({ payments: [pay("down_payment", 5600, "Bank TT")] })).paymentStatus).toBe("dp_paid")
  })

  it("labels the paid state Fully paid and works the split from the amounts (#1207)", () => {
    expect(IPAS_PAYMENT_STATUS_LABELS.paid).toBe("Fully paid")
    const part = ipasFigures(ipas({ pi_qt_amount: 10000, payments: [pay("down_payment", 3000, "Bank TT")] }))
    expect(paidLeftText(part)).toBe("30% paid, 70% left")
    // 30% + 60% typed, but the amounts leave 10% owed
    const gap = ipasFigures(ipas({ pi_qt_amount: 10000, payments: [{ ...pay("down_payment", 3000, "Bank TT"), percent_of_order: 30 }, { ...pay("payment", 6000, "Bank TT"), percent_of_order: 60 }] }))
    expect(paidLeftText(gap)).toBe("90% paid, 10% left")
    // An uneven split shows at most one decimal (found on staging: "37.1033% paid")
    expect(paidLeftText({ paidPercent: 37.1033, leftPercent: 62.8967 })).toBe("37.1% paid, 62.9% left")
  })

  it("reads Paid with nothing left, even on an order still at Order-Draft", () => {
    const covered = ipas({ status: "order_draft", payments: [pay("down_payment", 6720, "Bank TT"), pay("payment", 4480, "Bank TT")] })
    expect(ipasFigures(covered).paymentStatus).toBe("paid")
    expect(ipasFigures(ipas({ payments: [pay("full_payment", 11200, "Bank TT")] })).paymentStatus).toBe("paid")
  })

  it("reads Paid when overpaid, and For payment over Paid when an ask is open", () => {
    expect(ipasFigures(ipas({ payments: [pay("payment", 12800, "Bank TT")] })).paymentStatus).toBe("paid")
    expect(ipasFigures(ipas({ payment_ask: ask, payments: [pay("full_payment", 11200, "Bank TT")] })).paymentStatus).toBe("for_payment")
  })

  it("finds the open ask among the asks a read brings, and ignores closed ones", () => {
    const asks = [{ ...ask, closed_at: "2026-11-20T00:00:00Z" }, { ...ask, amount: 900 }]
    const figures = ipasFigures(ipas({ payment_asks: asks }))
    expect(figures.paymentStatus).toBe("for_payment")
    expect(figures.paymentAsk.amount).toBe(900)
    expect(ipasFigures(ipas({ payment_asks: [asks[0]] })).paymentStatus).toBe("not_due_yet")
  })

  it("has none on a cancelled IPAS", () => {
    expect(ipasFigures(ipas({ state: "cancelled", payment_ask: ask })).paymentStatus).toBeNull()
  })
})

describe("ipasFigures: supplier-billed Freight (#1192)", () => {
  const billed = { freight_amount: 1600, freight_currency: "Php", freight_billed_by_supplier: true }

  it("owes the P0 total plus supplier-billed Freight when no P.I/QT Amount is typed", () => {
    const figures = ipasFigures(ipas({ ...billed, payments: [pay("down_payment", 6000, "Bank TT"), pay("payment", 6800, "Bank TT")] }))
    expect(figures.amount).toBe(12800)
    expect(figures.overpaidBy).toBe(0)
    expect(figures.remainingBalance).toBe(0)
  })

  it("leaves the typed P.I/QT Amount as what is owed", () => {
    expect(ipasFigures(ipas({ ...billed, pi_qt_amount: 12800 })).amount).toBe(12800)
    expect(ipasFigures(ipas({ ...billed, pi_qt_amount: 11200 })).amount).toBe(11200)
  })

  it("ignores Freight the supplier did not bill, and Freight in another currency", () => {
    expect(ipasFigures(ipas({ ...billed, freight_billed_by_supplier: false })).amount).toBe(11200)
    expect(ipasFigures(ipas({ ...billed, freight_currency: "EUR" })).amount).toBe(11200)
  })

  it("matches the bill check when the P.I equals the P0 total plus the Freight", () => {
    expect(ipasFigures(ipas({ ...billed, pi_qt_amount: 12800 })).billCheck.status).toBe(IPAS_BILL_CHECK.MATCHES)
    expect(ipasFigures(ipas({ ...billed, pi_qt_amount: 11200 })).billCheck.status).toBe(IPAS_BILL_CHECK.DIFFERS)
    expect(ipasFigures(ipas({ pi_qt_amount: 12800 })).billCheck.difference).toBe(1600)
  })

  it("shows each payment's real share of what is owed, not the percent typed", () => {
    const payments = [pay("down_payment", 7680, "Bank TT", { percent_of_order: 60 }), pay("payment", 5120, "Bank TT", { percent_of_order: 40 })]
    expect(ipasFigures(ipas({ ...billed, payments })).paymentPercents).toBe("Down payment · 60%; Payment · 40%")
    expect(ipasFigures(ipas({ payments })).paymentPercents).toBe("Down payment · 68.5714%; Payment · 45.7143%")
  })
})
