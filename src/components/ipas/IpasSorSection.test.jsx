import { describe, expect, it, vi } from "vitest"
import { act, screen } from "@testing-library/react"

import { renderWithProviders } from "@/test/support"
import { stubRpc } from "@/test/msw/server"
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
})
