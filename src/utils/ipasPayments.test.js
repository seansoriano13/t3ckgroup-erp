import { describe, expect, it } from "vitest"
import {
  formatDay,
  isIsoDate,
  optionsForPicker,
  parseAmountInput,
  shapeCharge,
  shapePayment,
  summarizePayments,
} from "./ipasPayments"

describe("parseAmountInput", () => {
  it.each([
    ["1250", 1250],
    ["1,250.50", 1250.5],
    ["  ₱ 1 250.5 ", 1250.5],
    ["12.", 12],
    [".5", 0.5],
    ["PHP 300", 300],
    [75, 75],
  ])("reads %s as %s", (raw, value) => {
    expect(parseAmountInput(raw)).toEqual({ ok: true, value })
  })

  it.each([["", null], [null, null], [undefined, null], ["   ", null]])("reads %s as blank", (raw) => {
    expect(parseAmountInput(raw)).toEqual({ ok: true, value: null })
  })

  it.each(["abc", "12abc", "1.2.3", "-5", "--", ".", "1e3", NaN, Infinity, -1])("refuses %s without throwing", (raw) => {
    expect(parseAmountInput(raw)).toEqual({ ok: false })
  })
})

describe("isIsoDate and formatDay", () => {
  it("accepts a real date and nothing half-typed", () => {
    expect(isIsoDate("2026-10-13")).toBe(true)
    for (const bad of ["", "2026-10", "2026-13-01", "2026-02-30", "13/10/2026", null, undefined, 20261013]) {
      expect(isIsoDate(bad)).toBe(false)
    }
  })

  it("words a date as written, whatever the viewer's timezone", () => {
    expect(formatDay("2026-10-01")).toBe("Oct 1, 2026")
    expect(formatDay("2026-01-31")).toBe("Jan 31, 2026")
    expect(formatDay(null)).toBe("—")
    expect(formatDay("soon")).toBe("soon")
  })
})

describe("summarizePayments", () => {
  const payments = [
    { kind: "down_payment", amount: "640", php_debited: "36160", charge_fee_php: "350", proof_url: "https://x/pop.png" },
    { kind: "payment", amount: 100, php_debited: 5600, charge_fee_php: 0 },
    { kind: "full_payment", amount: 640, php_debited: 36240, charge_fee_php: 350 },
    { kind: "shipping_fee", amount: 120, php_debited: 6800, charge_fee_php: 0 },
  ]

  it("derives DP and FP from the rows and adds up what was debited, with no balance", () => {
    const sum = summarizePayments(payments, [{ amount_php: 4200 }, { amount_php: 9870 }], "USD")
    expect(sum).toMatchObject({
      count: 4,
      downPayment: 640,
      fullPayment: 640,
      paid: 1500,
      phpDebited: 84800,
      chargeFeesPhp: 700,
      chargesPhp: 14070,
      totalDebitedPhp: 85500,
      missingPhp: 0,
      hasProof: true,
    })
    expect(sum).not.toHaveProperty("balance")
  })

  it("takes a peso payment's PHP from its amount", () => {
    const sum = summarizePayments([{ kind: "payment", amount: 8325, php_debited: null }], [], "Php")
    expect(sum.phpDebited).toBe(8325)
    expect(sum.missingPhp).toBe(0)
  })

  it("counts a foreign payment with no PHP debited as missing, and has no proof without one", () => {
    const sum = summarizePayments([{ kind: "payment", amount: 100, php_debited: null }], [], "USD")
    expect(sum).toMatchObject({ phpDebited: 0, missingPhp: 1, hasProof: false })
  })

  it("is zero for nothing, and ignores junk rows", () => {
    expect(summarizePayments([], [], null)).toMatchObject({ count: 0, downPayment: 0, paid: 0, totalDebitedPhp: 0 })
    expect(() => summarizePayments([null, {}, { amount: "x" }], [null], "USD")).not.toThrow()
  })
})

describe("rows and pickers", () => {
  const options = new Map([
    ["m1", { id: "m1", list: "payment_method", label: "Dated Check", active: false, sort: 40 }],
    ["k1", { id: "k1", list: "charge_kind", label: "Brokerage Fee", active: true, sort: 10 }],
  ])

  it("resolves an option a list no longer offers, so history keeps its label", () => {
    expect(shapePayment({ id: "p", method_id: "m1", amount: "500", php_debited: null, proof_url: null }, options)).toMatchObject({
      methodLabel: "Dated Check",
      amount: 500,
      php_debited: null,
      charge_fee_php: 0,
      hasProof: false,
    })
    expect(shapeCharge({ id: "c", kind_id: "k1", amount_php: "4200" }, options)).toMatchObject({
      kindLabel: "Brokerage Fee",
      amount_php: 4200,
    })
    expect(shapePayment({ id: "p", method_id: "gone" }, options).methodLabel).toBeNull()
  })

  it("offers the active options of one list, plus the one a row already holds, in order", () => {
    const all = [
      { id: "a", list: "payment_method", label: "Cash", active: true, sort: 30 },
      { id: "b", list: "payment_method", label: "Alipay", active: true, sort: 10 },
      { id: "c", list: "payment_method", label: "Old", active: false, sort: 20 },
      { id: "d", list: "charge_kind", label: "Duties", active: true, sort: 10 },
    ]
    expect(optionsForPicker(all, "payment_method").map((o) => o.label)).toEqual(["Alipay", "Cash"])
    expect(optionsForPicker(all, "payment_method", "c").map((o) => o.label)).toEqual(["Alipay", "Old", "Cash"])
  })
})
