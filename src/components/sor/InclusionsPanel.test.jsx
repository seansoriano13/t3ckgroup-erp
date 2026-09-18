/**
 * Issue #44 — on a bundled Odoo order the Inclusions live as free text inside
 * the order line's description. Import brings that text in as an editable
 * draft, reviewed and edited before it is ever written to sor_inclusions —
 * nothing here should hit the database until Save is clicked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor, fireEvent } from "@testing-library/react"
import toast from "react-hot-toast"

import { renderWithProviders } from "../../test/support"
import { db } from "../../test/db/store"
import { makeEmployee, makeOpportunity } from "../../test/factories"
import InclusionsPanel from "./InclusionsPanel"
import { odooService } from "../../services/odooService"

vi.mock("../../services/odooService", () => ({
  odooService: { fetchOrderLines: vi.fn() },
}))

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

let authUser
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: authUser }),
}))

function renderPanel(opportunityOverrides = {}) {
  const owner = makeEmployee()
  authUser = { id: owner.id, isSuperAdmin: false }
  const opportunity = makeOpportunity({ registered_by: owner.id, ...opportunityOverrides })
  renderWithProviders(<InclusionsPanel opportunity={opportunity} isRequired />)
  return opportunity
}

const foundLines = (items) => ({
  success: true,
  found: true,
  order: { id: 6070, name: "S06070", state: "sale" },
  customer: { company: "Makati City Government", contact: "" },
  items,
})

describe("InclusionsPanel — import from Odoo (#44)", () => {
  beforeEach(() => {
    odooService.fetchOrderLines.mockReset()
    toast.success.mockClear()
    toast.error.mockClear()
  })

  it("has no import control to use when the SOR has no Sales Reference", async () => {
    renderPanel({ sales_reference: null })

    const importButton = await screen.findByRole("button", { name: /import from odoo/i })
    expect(importButton).toBeDisabled()
    expect(screen.getByText(/sales reference/i)).toBeInTheDocument()
    expect(odooService.fetchOrderLines).not.toHaveBeenCalled()
  })

  it("imports the order line's description as an editable, unsaved draft", async () => {
    renderPanel({ sales_reference: "S06070" })
    odooService.fetchOrderLines.mockResolvedValue(
      foundLines([
        {
          product_name: "Ambulance Commuter",
          description: "1 unit Ambulance - stretcher, oxygen tank, siren",
          quantity: 1,
          unit: "unit",
        },
      ]),
    )

    fireEvent.click(await screen.findByRole("button", { name: /import from odoo/i }))

    const draftInput = await screen.findByDisplayValue(
      "1 unit Ambulance - stretcher, oxygen tank, siren",
    )
    expect(draftInput).toBeInTheDocument()

    // Nothing is written until Save — review-before-save is the whole point.
    expect(db.rows("sor_inclusions")).toHaveLength(0)
  })

  it("lets a draft be edited and removed before it is ever saved", async () => {
    renderPanel({ sales_reference: "S06070" })
    odooService.fetchOrderLines.mockResolvedValue(
      foundLines([{ product_name: "Ambulance Commuter", description: "Draft text", quantity: 1, unit: "unit" }]),
    )
    fireEvent.click(await screen.findByRole("button", { name: /import from odoo/i }))
    const draftInput = await screen.findByDisplayValue("Draft text")

    fireEvent.change(draftInput, { target: { value: "Edited text" } })
    expect(screen.getByDisplayValue("Edited text")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /discard edited text/i }))
    await waitFor(() => expect(screen.queryByDisplayValue("Edited text")).not.toBeInTheDocument())
    expect(db.rows("sor_inclusions")).toHaveLength(0)
  })

  it("saves a reviewed import as real Inclusions", async () => {
    const opportunity = renderPanel({ sales_reference: "S06070" })
    odooService.fetchOrderLines.mockResolvedValue(
      foundLines([{ product_name: "Ambulance Commuter", description: "Draft text", quantity: 1, unit: "unit" }]),
    )
    fireEvent.click(await screen.findByRole("button", { name: /import from odoo/i }))
    await screen.findByDisplayValue("Draft text")

    fireEvent.click(screen.getByRole("button", { name: /save imported/i }))

    await waitFor(() => {
      const rows = db.rows("sor_inclusions").filter((r) => r.opportunity_id === opportunity.id)
      expect(rows).toHaveLength(1)
      expect(rows[0].description).toBe("Draft text")
    })
  })

  it("does not duplicate a line that was already imported and saved", async () => {
    const opportunity = renderPanel({ sales_reference: "S06070" })
    const response = foundLines([
      { product_name: "Ambulance Commuter", description: "Draft text", quantity: 1, unit: "unit" },
    ])
    odooService.fetchOrderLines.mockResolvedValue(response)

    fireEvent.click(await screen.findByRole("button", { name: /import from odoo/i }))
    await screen.findByDisplayValue("Draft text")
    fireEvent.click(screen.getByRole("button", { name: /save imported/i }))
    await waitFor(() =>
      expect(
        db.rows("sor_inclusions").filter((r) => r.opportunity_id === opportunity.id),
      ).toHaveLength(1),
    )

    fireEvent.click(await screen.findByRole("button", { name: /import from odoo/i }))

    await waitFor(() => expect(odooService.fetchOrderLines).toHaveBeenCalledTimes(2))
    expect(
      db.rows("sor_inclusions").filter((r) => r.opportunity_id === opportunity.id),
    ).toHaveLength(1)
    expect(screen.queryAllByDisplayValue("Draft text")).toHaveLength(0)
  })

  it("tells a real not-found apart from Odoo being unreachable", async () => {
    renderPanel({ sales_reference: "S06070" })
    odooService.fetchOrderLines.mockResolvedValue({
      success: false,
      found: false,
      message: 'No Odoo quotation found matching "S06070".',
    })

    fireEvent.click(await screen.findByRole("button", { name: /import from odoo/i }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('No Odoo quotation found matching "S06070".'),
    )

    // A resolved `{ success: false }` with no `found` key is Odoo itself
    // reporting an error (misconfiguration, a bad response) — still a normal
    // round trip, distinct from the reference truly matching nothing above.
    odooService.fetchOrderLines.mockResolvedValue({
      success: false,
      message: "Odoo lookup failed.",
    })
    fireEvent.click(screen.getByRole("button", { name: /import from odoo/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Odoo lookup failed."))

    // Odoo unreachable at the transport level is a third, genuinely different
    // case — odooService throws rather than resolving — and reads as its own
    // message too, not collapsed into either of the two above.
    odooService.fetchOrderLines.mockRejectedValue(new Error("Could not reach Odoo."))
    fireEvent.click(screen.getByRole("button", { name: /import from odoo/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not reach Odoo."))
  })
})
