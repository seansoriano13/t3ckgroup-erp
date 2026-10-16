import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, screen } from "@testing-library/react"

import { renderWithProviders } from "@/test/support"
import { stubRpc } from "@/test/msw/server"
import { db } from "@/test/db/store"
import IpasSorSection from "./IpasSorSection"

let authUser
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

const summary = (over = {}) => ({
  ipas_id: "ipas-1",
  number: "TGIPAS_052",
  po_number: "P05123",
  supplier: "Scorpe Technologies",
  purpose: "project",
  state: "open",
  buyer_track: [
    { key: "purchase_order", ticked: true, partial: false },
    { key: "with_pop", ticked: false, partial: false },
    { key: "received_in_odoo", ticked: false, partial: true },
  ],
  computation_status: "encoded",
  signoffs: {
    1: { prepared: true, approved: true },
    3: { prepared: true, approved: false },
    7: { received: false, noted: false, checked: false, approved: false },
  },
  ...over,
})

describe("IpasSorSection (#249)", () => {
  beforeEach(() => stubRpc("ipas_standing_for_sor", []))

  it("lists the summary: number, PO, supplier, state, buyer track, costing and sign-offs", async () => {
    authUser = { id: "emp-1" }
    stubRpc("ipas_summaries_for_sor", [summary()])
    renderWithProviders(<IpasSorSection opportunityId="sor-1" />)

    expect(await screen.findByText("TGIPAS_052")).toBeInTheDocument()
    expect(screen.getByText("P05123 · Scorpe Technologies · Project")).toBeInTheDocument()
    expect(screen.getByText("Open")).toBeInTheDocument()
    expect(screen.getByText(/Buyer track · 1 of 3/)).toBeInTheDocument()
    expect(screen.getByTitle("Purchase Order: done")).toBeInTheDocument()
    expect(screen.getByTitle("Received in Odoo: partly done")).toBeInTheDocument()
    expect(screen.getByText("Encoded")).toBeInTheDocument()
    expect(screen.getByText("Prepared, Approved")).toBeInTheDocument()
    expect(screen.getAllByText("Not started")).toHaveLength(1)
  })

  it("renders nothing when no IPAS names the SOR", async () => {
    authUser = { id: "emp-1" }
    stubRpc("ipas_summaries_for_sor", [])
    const { container } = renderWithProviders(<IpasSorSection opportunityId="sor-1" />)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80))
    })
    expect(container).toBeEmptyDOMElement()
  })

  it("opens the full IPAS only for someone who can read every IPAS", async () => {
    stubRpc("ipas_summaries_for_sor", [summary()])

    authUser = { id: "emp-1" }
    const plain = renderWithProviders(<IpasSorSection opportunityId="sor-1" />)
    await screen.findByText("TGIPAS_052")
    expect(screen.queryByRole("button", { name: "Open IPAS" })).not.toBeInTheDocument()
    plain.unmount()

    for (const flags of [{ hasPurchasingFlow: true }, { hasFinanceFlow: true }, { isSuperAdmin: true }, { isIpasSigner: true }, { isIpasApprover: true }]) {
      authUser = { id: "emp-2", ...flags }
      const view = renderWithProviders(<IpasSorSection opportunityId="sor-1" />)
      expect(await screen.findByRole("button", { name: "Open IPAS" })).toBeInTheDocument()
      view.unmount()
    }
  })

  it("opens the IPAS in its own tab", async () => {
    authUser = { id: "emp-2", hasPurchasingFlow: true }
    stubRpc("ipas_summaries_for_sor", [summary()])
    const open = vi.spyOn(window, "open").mockImplementation(() => null)
    renderWithProviders(<IpasSorSection opportunityId="sor-1" />)

    ;(await screen.findByRole("button", { name: "Open IPAS" })).click()

    expect(open).toHaveBeenCalledWith("/purchasing/ipas/ipas-1", "_blank", "noopener")
  })

  it("shows nothing of the money, whatever the function was handed", async () => {
    authUser = { id: "emp-1" }
    stubRpc("ipas_summaries_for_sor", [summary()])
    const { container } = renderWithProviders(<IpasSorSection opportunityId="sor-1" />)
    await screen.findByText("TGIPAS_052")

    expect(container.textContent).not.toMatch(/₱|PHP|Landed|account|payment|charge/i)
  })

  it("shows the next thing, who owes it and a late mark per row (#265)", async () => {
    authUser = { id: "emp-1" }
    stubRpc("ipas_summaries_for_sor", [summary()])
    stubRpc("ipas_standing_for_sor", [
      {
        ipas_id: "ipas-1",
        source: "local",
        created_at: "2026-10-01T04:00:00Z",
        updated_at: "2026-10-01T04:00:00Z",
        costs_completed_at: null,
        proof_paid_on: null,
        shipped_out_on: null,
        onboard_on: null,
        arrived_in_ph_on: null,
        arrived_in_whs_on: null,
        import_clearance_on: null,
        delivered_on: null,
        actual_checking_stamped: false,
        actual_checking_at: null,
        slips: [],
      },
    ])
    renderWithProviders(<IpasSorSection opportunityId="sor-1" />)

    const line = await screen.findByTestId("ipas-next-thing")
    expect(line).toHaveTextContent("With P.O.P — no payment carries proof")
    expect(line).toHaveTextContent("Finance")
    expect(line).toHaveTextContent("days waiting")
  })

  it("says how many days past the rule a late row is (#265)", async () => {
    authUser = { id: "emp-1" }
    stubRpc("ipas_summaries_for_sor", [summary()])
    db.seed("order_ageing_rules", { step: "with_pop", days: 10 })
    stubRpc("ipas_standing_for_sor", [
      {
        ipas_id: "ipas-1", source: "local", created_at: "2026-10-01T04:00:00Z", updated_at: "2026-10-01T04:00:00Z",
        costs_completed_at: null, proof_paid_on: null, shipped_out_on: null, onboard_on: null, arrived_in_ph_on: null,
        arrived_in_whs_on: null, import_clearance_on: null, delivered_on: null, actual_checking_stamped: false,
        actual_checking_at: null, slips: [],
      },
    ])
    renderWithProviders(<IpasSorSection opportunityId="sor-1" />)

    const line = await screen.findByTestId("ipas-next-thing")
    expect(line).toHaveTextContent("Late")
    expect(line).toHaveTextContent(/\d+ days? past the rule/)
  })
})
