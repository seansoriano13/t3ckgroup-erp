/**
 * #821 — a Sales Reference Stage Field renders the S0 card's input, so it runs the same S0 save
 * (checks, refusals, products pulled) and never the plain single-field save.
 */
import { describe, it, expect, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"

import { renderWithProviders, setupUser } from "../../test/support"
import { makeEmployee, makeOpportunity } from "../../test/factories"
import { stubSalesReferenceCard, stubSalesReferenceSave } from "../../test/stubs/salesReferenceCard"
import { db } from "../../test/db/store"
import StageFieldsForm from "./StageFieldsForm"

const field = { id: "f-1", label: "Sales Reference", source: "sor", sor_field: "sales_reference", is_required: false }

const setup = () => {
  const opportunity = makeOpportunity({ registered_by: makeEmployee().id })
  const onSaveField = vi.fn()
  const onChanged = vi.fn()
  stubSalesReferenceCard({ lock: "open", canEdit: true })
  renderWithProviders(
    <StageFieldsForm opportunity={opportunity} fields={[field]} currentVisitId={null} actorId="a" onSaveField={onSaveField} onChanged={onChanged} />,
  )
  return { opportunity, onSaveField, onChanged }
}

describe("StageFieldsForm Sales Reference (#821)", () => {
  it("shows the card's S0 input", async () => {
    setup()
    expect(await screen.findByRole("form", { name: "Edit S0" })).toBeInTheDocument()
    expect(screen.getByLabelText("S0")).toBeInTheDocument()
  })

  it("saves through the S0 save, not saveRecordField", async () => {
    const { opportunity, onSaveField, onChanged } = setup()
    const calls = stubSalesReferenceSave()
    const user = setupUser()

    await user.type(await screen.findByLabelText("S0"), "S01237")
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ opportunityId: opportunity.id, salesReference: "S01237", reason: null })
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(onSaveField).not.toHaveBeenCalled()
    expect(db.internal.rowsOf("sales_opportunities").find((row) => row.id === opportunity.id).sales_reference).toBe("S01237")
  })

  it("shows the same refusal as the card", async () => {
    const { onSaveField } = setup()
    stubSalesReferenceSave({ refuse: { message: "Odoo has no S01237. Check the number.", hint: "not_found" } })
    const user = setupUser()

    await user.type(await screen.findByLabelText("S0"), "S01237")
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Odoo has no S01237. Check the number.")
    expect(onSaveField).not.toHaveBeenCalled()
  })

  it("shows a locked S0 as text, with no input, to someone who may not change it", async () => {
    const opportunity = makeOpportunity({ registered_by: makeEmployee().id, sales_reference: "S01237" })
    stubSalesReferenceCard({ lock: "locked", canEdit: false })
    renderWithProviders(
      <StageFieldsForm opportunity={opportunity} fields={[field]} currentVisitId={null} actorId="a" onSaveField={vi.fn()} />,
    )

    expect(await screen.findByRole("img", { name: "Locked" })).toBeInTheDocument()
    expect(screen.getByText("S01237")).toBeInTheDocument()
    expect(screen.queryByRole("form", { name: "Edit S0" })).not.toBeInTheDocument()
  })

  it("starts the input from the stored S0 once the card has loaded", async () => {
    const opportunity = makeOpportunity({ registered_by: makeEmployee().id, sales_reference: "S01237" })
    stubSalesReferenceCard({ lock: "open", canEdit: true })
    renderWithProviders(
      <StageFieldsForm opportunity={{ ...opportunity, sales_reference: null }} fields={[field]} currentVisitId={null} actorId="a" onSaveField={vi.fn()} />,
    )

    expect(await screen.findByLabelText("S0")).toHaveValue("S01237")
  })
})

describe("StageChecklistRow Sales Reference condition (#821)", () => {
  it("renders the card's S0 input for a field condition on sales_reference", async () => {
    const { default: StageChecklistRow } = await import("./StageChecklistRow")
    const opportunity = makeOpportunity({ registered_by: makeEmployee().id })
    stubSalesReferenceCard({ lock: "open", canEdit: true })
    const calls = stubSalesReferenceSave()
    const onSaveField = vi.fn()
    const user = setupUser()
    renderWithProviders(
      <StageChecklistRow
        condition={{ id: "c1", kind: "field", label: "Sales Reference", config: { column: "sales_reference" } }}
        status="unmet"
        opportunity={opportunity}
        onSaveField={onSaveField}
      />,
    )

    await user.type(await screen.findByLabelText("S0"), "S01237")
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(onSaveField).not.toHaveBeenCalled()
  })

  it("shows the S0 as text, with no input, to a read-only viewer", async () => {
    const { default: StageChecklistRow } = await import("./StageChecklistRow")
    const opportunity = makeOpportunity({ registered_by: makeEmployee().id, sales_reference: "S01237" })
    stubSalesReferenceCard({ lock: "open", canEdit: true })
    renderWithProviders(
      <StageChecklistRow
        condition={{ id: "c1", kind: "field", label: "Sales Reference", config: { column: "sales_reference" } }}
        status="unmet"
        opportunity={opportunity}
      />,
    )

    expect(await screen.findByText("S01237")).toBeInTheDocument()
    expect(screen.queryByLabelText("S0")).not.toBeInTheDocument()
  })
})
