import { render, screen, within } from "@testing-library/react"
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
const ask = (over = {}) => ({ id: "a1", amount: 3000, purpose: "down_payment", priority: "high", note: "30% down", closed_at: null, ...over })

describe("IpasPaymentStatusPill", () => {
  it("shows nothing when nothing is due", () => {
    const { container } = render(<IpasPaymentStatusPill figures={ipasFigures(ipas())} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows a muted bar with the paid and left percents when part is paid", () => {
    render(<IpasPaymentStatusPill figures={ipasFigures(ipas({ payments: [pay("down_payment", 3000)] }))} />)
    expect(screen.getByTestId("ipas-payment-status-pill")).toHaveTextContent("30% paid · 70% left")
    expect(screen.getByTestId("ipas-payment-progress")).toBeInTheDocument()
    expect(screen.queryByText("For payment")).not.toBeInTheDocument()
  })

  it("shows a check and Fully paid, muted, when all is paid", () => {
    render(<IpasPaymentStatusPill figures={ipasFigures(ipas({ payments: [pay("down_payment", 6000), pay("payment", 4000)] }))} />)
    const pill = screen.getByTestId("ipas-payment-status-pill")
    expect(pill).toHaveTextContent("Fully paid")
    expect(within(pill).getByText("Fully paid")).toHaveClass("text-muted-foreground")
  })

  it("shows an amber For payment pill with the amount and a muted note for an open ask", () => {
    render(<IpasPaymentStatusPill figures={ipasFigures(ipas({ payment_asks: [ask()] }))} />)
    const line = screen.getByTestId("ipas-payment-ask")
    expect(line).toHaveTextContent("For payment")
    expect(line).toHaveTextContent("3,000.00")
    expect(line).toHaveTextContent("Down payment · High")
    expect(line.getAttribute("title")).toContain("30% down")
    expect(screen.getByTestId("ipas-payment-status-pill")).toHaveAttribute("data-payment-status", "for_payment")
  })

  it("stacks several open asks as one line each, and leaves closed asks out", () => {
    const asks = [ask({ id: "a1" }), ask({ id: "a2", purpose: "charge", charge_kind: { label: "Freight" }, currency: "EUR", priority: "medium", amount: 500 }), ask({ id: "a3", closed_at: "2026-11-20" })]
    render(<IpasPaymentStatusPill figures={ipasFigures(ipas({ payment_asks: asks }))} />)
    const lines = screen.getAllByTestId("ipas-payment-ask")
    expect(lines).toHaveLength(2)
    expect(lines[1]).toHaveTextContent("Freight · Medium")
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
  })

  it("shows an ask in its own currency when it has one", () => {
    const figures = ipasFigures(ipas({ payment_asks: [ask({ amount: 800, currency: "USD", purpose: "charge" })] }))
    render(<IpasPaymentStatusPill figures={figures} />)
    expect(screen.getByTestId("ipas-payment-ask")).toHaveTextContent(/\$|USD/)
  })

  it("shows nothing for a cancelled IPAS", () => {
    const { container } = render(<IpasPaymentStatusPill figures={ipasFigures(ipas({ state: "cancelled" }))} />)
    expect(container).toBeEmptyDOMElement()
  })
})
