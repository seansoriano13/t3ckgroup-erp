/**
 * #815 — the S0 card at the top of the SOR window. Open: shows the number and an Edit button.
 * Locked: a lock icon whose reason is in a hover tooltip only, and no Edit for a person who may not
 * change it. A Super Admin still gets Edit on a locked S0, and is asked for a reason.
 */
import { describe, it, expect } from "vitest"
import { screen, waitFor } from "@testing-library/react"

import { renderWithProviders, setupUser } from "../../test/support"
import { makeEmployee, makeOpportunity } from "../../test/factories"
import { stubSalesReferenceCard, stubSalesReferenceSave } from "../../test/stubs/salesReferenceCard"
import { db } from "../../test/db/store"
import S0Card from "./S0Card"

const sor = (overrides = {}) => makeOpportunity({ registered_by: makeEmployee().id, ...overrides })

describe("S0Card", () => {
  it("shows the S0 and an Edit button while it can change", async () => {
    const opportunity = sor({ sales_reference: "S01237" })
    stubSalesReferenceCard({ lock: "open", canEdit: true, odooState: "found", productCount: 3 })
    renderWithProviders(<S0Card opportunityId={opportunity.id} />)

    expect(await screen.findByText("S01237")).toBeInTheDocument()
    expect(screen.getByText("In Odoo")).toBeInTheDocument()
    expect(screen.getByText(/3 products/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument()
    expect(screen.queryByLabelText("Locked")).not.toBeInTheDocument()
  })

  it("shows a lock, no Edit, and no standing reason once the S0 is locked", async () => {
    const opportunity = sor({ sales_reference: "S01237" })
    stubSalesReferenceCard({ lock: "locked", canEdit: false, firstStageName: "Quoting" })
    renderWithProviders(<S0Card opportunityId={opportunity.id} />)

    expect(await screen.findByLabelText("Locked")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/Locked after/)).not.toBeInTheDocument()
  })

  it("puts the reason in a hover tooltip", async () => {
    const opportunity = sor({ sales_reference: "S01237" })
    stubSalesReferenceCard({ lock: "locked", canEdit: false, firstStageName: "Quoting" })
    const user = setupUser()
    renderWithProviders(<S0Card opportunityId={opportunity.id} />)

    await user.hover(await screen.findByLabelText("Locked"))
    expect(await screen.findByText("Locked after Quoting")).toBeInTheDocument()
  })

  it("lets a Super Admin edit a locked S0, asks for a reason, and sends both", async () => {
    const opportunity = sor({ sales_reference: "S01237" })
    stubSalesReferenceCard({ lock: "locked", canEdit: true, firstStageName: "Quoting" })
    const calls = stubSalesReferenceSave()
    const user = setupUser()
    renderWithProviders(<S0Card opportunityId={opportunity.id} />)

    await user.click(await screen.findByRole("button", { name: /edit/i }))
    const save = screen.getByRole("button", { name: "Save" })
    await user.clear(screen.getByLabelText("S0"))
    await user.type(screen.getByLabelText("S0"), "S01300")
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText("Reason"), "Wrong quotation")
    await user.click(save)

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ opportunityId: opportunity.id, salesReference: "S01300", reason: "Wrong quotation" })
    await waitFor(() =>
      expect(db.internal.rowsOf("sales_opportunities").find((row) => row.id === opportunity.id).sales_reference).toBe("S01300"),
    )
  })

  it("shows the refusal when the save is refused", async () => {
    const opportunity = sor()
    stubSalesReferenceCard({ lock: "open", canEdit: true })
    stubSalesReferenceSave({ refuse: { message: 'S01237 is already on SOR "Rope Rescue" (Acme). One S0 per SOR.', hint: "duplicate" } })
    const user = setupUser()
    renderWithProviders(<S0Card opportunityId={opportunity.id} />)

    expect(await screen.findByText("Not set")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /edit/i }))
    await user.type(screen.getByLabelText("S0"), "S01237")
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/already on SOR "Rope Rescue"/)
  })

  it("refuses a bad format before asking the server", async () => {
    const opportunity = sor()
    stubSalesReferenceCard({ lock: "open", canEdit: true })
    const calls = stubSalesReferenceSave()
    const user = setupUser()
    renderWithProviders(<S0Card opportunityId={opportunity.id} />)

    await user.click(await screen.findByRole("button", { name: /edit/i }))
    await user.type(screen.getByLabelText("S0"), "ABC12")
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/Odoo quotation number/)
    expect(calls).toHaveLength(0)
  })

  it("shows a red Duplicate badge with the other SOR named on hover only (#819)", async () => {
    const opportunity = sor({ sales_reference: "S01237" })
    stubSalesReferenceCard({ duplicates: [{ id: "other-1", name: "Rope Rescue (Acme)" }] })
    const user = setupUser()
    renderWithProviders(<S0Card opportunityId={opportunity.id} />)

    const badge = await screen.findByText("Duplicate")
    expect(screen.queryByText(/Also on SOR/)).not.toBeInTheDocument()
    await user.hover(badge)
    expect(await screen.findByText("Also on SOR Rope Rescue (Acme). One S0 per SOR; change one.")).toBeInTheDocument()
  })

  it("shows no Duplicate badge when the S0 is unique", async () => {
    const opportunity = sor({ sales_reference: "S01237" })
    stubSalesReferenceCard({})
    renderWithProviders(<S0Card opportunityId={opportunity.id} />)

    await screen.findByText("S01237")
    expect(screen.queryByText("Duplicate")).not.toBeInTheDocument()
  })
})
