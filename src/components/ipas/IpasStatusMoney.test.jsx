import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import IpasStatusControl from "./IpasStatusControl"
import { ipasPills } from "./record/recordFacts"
import { ipasFigures } from "../../utils/ipasFigures"

const ipas = (over = {}) => ({
  state: "open",
  status: "order_draft",
  currency: "EUR",
  pi_qt_amount: 10000,
  payments: [],
  odoo_copy: { po: { currency: "EUR", amount_total: 10000 }, lines: [] },
  ...over,
})
const ask = (over = {}) => ({ id: "a1", amount: 3000, purpose: "down_payment", priority: "high", closed_at: null, ...over })
const statusFact = (row) => ipasPills(row, ipasFigures(row)).find((pill) => pill.key === "status").value
const list = (row) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IpasStatusControl ipas={row} figures={ipasFigures(row)} />
    </QueryClientProvider>,
  )

describe("the money part on the Status chip", () => {
  it("names the one open request, on the record header and the list", () => {
    const row = ipas({ payment_asks: [ask()] })
    expect(statusFact(row)).toMatch(/ · For payment \(Down payment\)$/)
    list(row)
    expect(screen.getByTestId("ipas-status-pill")).toHaveTextContent(/For payment \(Down payment\)/)
  })

  it("counts several open requests", () => {
    const row = ipas({ payment_asks: [ask(), ask({ id: "a2", purpose: "balance" })] })
    expect(statusFact(row)).toMatch(/For payment \(2\)$/)
    list(row)
    expect(screen.getByTestId("ipas-status-pill")).toHaveTextContent(/For payment \(2\)/)
  })

  it("goes when the request is paid or withdrawn", () => {
    const row = ipas({ payment_asks: [ask({ closed_at: "2026-11-27T00:00:00Z" })] })
    expect(statusFact(row)).not.toMatch(/For payment/)
    list(row)
    expect(screen.getByTestId("ipas-status-pill")).not.toHaveTextContent(/For payment/)
  })
})
