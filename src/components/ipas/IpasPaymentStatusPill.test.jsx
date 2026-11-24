import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import IpasPaymentStatusPill from "./IpasPaymentStatusPill"
import { ipasFigures } from "../../utils/ipasFigures"

const ipas = (over = {}) => ({
  state: "open",
  currency: "EUR",
  pi_qt_amount: 10000,
  payments: [],
  odoo_copy: { po: { currency: "EUR", amount_total: 10000 }, lines: [] },
  ...over,
})
const pay = (kind, amount) => ({ kind, amount, methodLabel: "Bank TT" })

describe("IpasPaymentStatusPill", () => {
  it.each([
    ["Not due yet", {}],
    ["DP paid · 30% paid, 70% left", { payments: [pay("down_payment", 3000)] }],
    ["Fully paid", { payments: [pay("down_payment", 6000), pay("payment", 4000)] }],
  ])("reads %s from the figures", (label, over) => {
    render(<IpasPaymentStatusPill figures={ipasFigures(ipas(over))} />)
    expect(screen.getByTestId("ipas-payment-status-pill")).toHaveTextContent(label)
  })

  it("says what the open ask is for on hover", () => {
    const figures = ipasFigures(ipas({ payment_asks: [{ amount: 3000, purpose: "down_payment", note: "30% down", closed_at: null }] }))
    render(<IpasPaymentStatusPill figures={figures} />)
    expect(screen.getByTestId("ipas-payment-status-pill")).toHaveTextContent("For payment")
    const title = screen.getByText("For payment").getAttribute("title")
    expect(title).toContain("Down payment")
    expect(title).toContain("30% down")
  })

  it("shows nothing for a cancelled IPAS", () => {
    const { container } = render(<IpasPaymentStatusPill figures={ipasFigures(ipas({ state: "cancelled" }))} />)
    expect(container).toBeEmptyDOMElement()
  })
})
