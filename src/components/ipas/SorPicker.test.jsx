import { useState } from "react"
import { beforeEach, describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { renderWithProviders } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubIpasRpcs } from "@/test/stubs/ipasRpc"
import SorPicker from "./SorPicker"

/**
 * The IPAS SOR picker (#601): suggestions are the Odoo PO's SORs first, then the
 * caller's recent ones; the search finds by SOR number, SO number or project,
 * including an SOR with no SO number, and highlights what was typed.
 */

function Harness({ suggestions = [], showRecent = true }) {
  const [selected, setSelected] = useState([])
  return (
    <>
      <SorPicker selected={selected} onChange={setSelected} suggestions={suggestions} showRecent={showRecent} />
      <output data-testid="picked">{selected.map((s) => s.sor_code).join(",")}</output>
    </>
  )
}

const sorRow = (over) =>
  makeOpportunity({ registered_by: buyer.id, ...over })

let buyer

beforeEach(() => {
  buyer = makeEmployee({ name: "Buyer", department: "OPERATIONS", has_purchasing_flow: true })
  stubIpasRpcs({ actorId: buyer.id })
})

const named = (sor, n) => {
  const ipas = db.seed("ipas", {
    number: `TGIPAS_8${n}`,
    po_number: `P0800${n}`,
    created_by: buyer.id,
    state: "open",
    priority: "high",
    source: "local",
    purpose: "project",
    odoo_copy: {},
  })
  db.seed("ipas_sors", { ipas_id: ipas.id, opportunity_id: sor.id })
}

describe("SorPicker", () => {
  it("suggests the Odoo PO's SORs first, then the SORs picked recently", async () => {
    const mentioned = sorRow({ sales_reference: "S04081", sor_code: "SOR-198", project_title: "BFP Command Bus" })
    const recent = sorRow({ sales_reference: null, sor_code: "SOR-201", project_title: "Lagoon Survey" })
    named(recent, 1)

    renderWithProviders(
      <Harness
        suggestions={[
          {
            id: mentioned.id,
            sor_code: "SOR-198",
            sales_reference: "S04081",
            project_title: "BFP Command Bus",
            current_stage_name: "Quotation",
            found_in: ["origin"],
          },
        ]}
      />,
    )

    const odoo = screen.getByText("Mentioned on the Odoo PO")
    const picked = await screen.findByText("Picked recently")
    expect(odoo.compareDocumentPosition(picked) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    expect(screen.getByLabelText("Name SOR-198")).toBeInTheDocument()
    expect(screen.getByLabelText("Name SOR-201")).toBeInTheDocument()
    expect(screen.getByText("S04081", { exact: false })).toBeInTheDocument()
    expect(screen.getByText("Quotation", { exact: false })).toBeInTheDocument()
  })

  it("does not ask for recent SORs unless told to", async () => {
    named(sorRow({ sor_code: "SOR-210", project_title: "Quiet Pick" }), 2)
    renderWithProviders(<Harness showRecent={false} />)
    expect(screen.queryByText("Picked recently")).not.toBeInTheDocument()
  })

  it("finds an SOR with no SO number by its SOR number and picks it, with the typed text highlighted", async () => {
    sorRow({ sales_reference: null, sor_code: "SOR-305", project_title: "Dockside Works" })
    const user = userEvent.setup()
    renderWithProviders(<Harness showRecent={false} />)

    await user.type(screen.getByPlaceholderText("SOR number, SO number or project"), "sor-305")

    const row = (await screen.findByText("Add")).closest("li")
    expect(within(row).getByText(/Dockside Works/)).toBeInTheDocument()
    expect(within(row).getByText("SOR-305")).toHaveClass("text-amber-11")
    // No SO number yet: nothing stands in for it.
    expect(within(row).queryByText(/S0/)).not.toBeInTheDocument()

    await user.click(within(row).getByRole("button", { name: "Add" }))
    expect(screen.getByTestId("picked")).toHaveTextContent("SOR-305")
  })

  it("finds an SOR by its SO number", async () => {
    sorRow({ sales_reference: "S04081", sor_code: "SOR-198", project_title: "BFP Command Bus" })
    const user = userEvent.setup()
    renderWithProviders(<Harness showRecent={false} />)

    await user.type(screen.getByPlaceholderText("SOR number, SO number or project"), "s04081")

    const row = (await screen.findByText("Add")).closest("li")
    expect(within(row).getByText("S04081")).toHaveClass("text-amber-11")
    expect(within(row).getByText("SOR-198")).toBeInTheDocument()
  })
})
