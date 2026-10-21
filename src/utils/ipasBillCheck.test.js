import { describe, expect, it } from "vitest"
import { BILL_CHECK_KIND, billCheckView } from "./ipasBillCheck"
import { ipasFigures } from "./ipasFigures"

const OLD_COPY = { po: { name: "P02552", currency: "Php" }, lines: [{ line_id: 1, price_subtotal: 10000 }] }

const ipas = ({ total = 11200, pi = null, copy } = {}) => ({
  state: "open",
  currency: "Php",
  pi_qt_amount: pi,
  payments: [],
  odoo_copy: copy ?? {
    po: { name: "P02552", currency: "Php", amount_untaxed: 10000, amount_tax: total - 10000, amount_total: total },
    lines: [{ line_id: 1, price_subtotal: 10000 }],
  },
})
const view = (over) => billCheckView(ipasFigures(ipas(over)))

describe("billCheckView", () => {
  it("says = matches when the P.I equals the Odoo PO total, and has nothing to warn about", () => {
    const result = view({ pi: 11200 })
    expect(result.kind).toBe(BILL_CHECK_KIND.MATCHES)
    expect(result.verdict).toBe("= matches")
    expect(result.warning).toBeNull()
    expect(result.poText).toBe("₱11,200.00")
    expect(result.piText).toBe("₱11,200.00")
  })

  it("says how much more the P.I is when it is higher, and warns", () => {
    const result = view({ pi: 16200 })
    expect(result.kind).toBe(BILL_CHECK_KIND.DIFFERS)
    expect(result.verdict).toBe("≠ P.I is ₱5,000.00 more")
    expect(result.warning).toBe("Supplier bill check: the P.I is ₱5,000.00 more than the Odoo PO (₱16,200.00 against ₱11,200.00).")
  })

  it("says how much less the P.I is when it is lower, and warns", () => {
    const result = view({ pi: 11199.5 })
    expect(result.verdict).toBe("≠ P.I is ₱0.50 less")
    expect(result.warning).toMatch(/₱0\.50 less than the Odoo PO/)
  })

  it("compares to the cent", () => {
    expect(view({ pi: 11200.01 }).kind).toBe(BILL_CHECK_KIND.DIFFERS)
  })

  it("says the P.I/QT Amount is not typed yet when it is blank, and warns", () => {
    const result = view({ pi: null })
    expect(result.kind).toBe(BILL_CHECK_KIND.NOT_TYPED)
    expect(result.verdict).toBe("P.I/QT Amount not typed yet")
    expect(result.piText).toBe("—")
    expect(result.poText).toBe("₱11,200.00")
    expect(result.warning).toMatch(/P\.I\/QT Amount is not typed yet/)
  })

  it("says the PO figure is before tax for an old copy, instead of claiming a mismatch", () => {
    const result = view({ pi: 11200, copy: OLD_COPY })
    expect(result.kind).toBe(BILL_CHECK_KIND.BEFORE_TAX)
    expect(result.verdict).toMatch(/before tax/)
    expect(result.verdict).not.toMatch(/≠/)
    expect(result.warning).toBeNull()
  })

  it("still says the P.I is not typed for an old copy", () => {
    expect(view({ pi: null, copy: OLD_COPY }).kind).toBe(BILL_CHECK_KIND.NOT_TYPED)
  })

  it("does not claim a mismatch when the copy has no Odoo figure at all", () => {
    const result = view({ pi: 500, copy: { po: { name: "P02552" }, lines: [] } })
    expect(result.kind).toBe(BILL_CHECK_KIND.NO_PO)
    expect(result.warning).toBeNull()
  })

  it("writes amounts in the PO's currency", () => {
    const result = billCheckView(
      ipasFigures({ state: "open", payments: [], pi_qt_amount: 1200, odoo_copy: { po: { currency: "USD", amount_total: 1000 }, lines: [] } }),
    )
    expect(result.verdict).toBe("≠ P.I is $200.00 more")
  })
})
