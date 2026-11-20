import { describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import IpasStatusSteps from "./IpasStatusSteps"

const ipasOf = (over = {}) => ({
  state: "open",
  source: "import",
  status: "in_transit",
  statusSteps: [
    { step: "order_draft", on: "2026-11-01", by: { id: "u1", name: "Buyer" } },
    { step: "ordered", on: "2026-11-03", by: { id: "u1", name: "Buyer" } },
    { step: "in_transit", on: "2026-11-10", by: { id: "u2", name: "Lia" } },
  ],
  ...over,
})

const renderSteps = (ipas, props = {}) => {
  const onPick = vi.fn()
  const onEditDate = vi.fn()
  render(<IpasStatusSteps ipas={ipas} canSet onPick={onPick} onEditDate={onEditDate} {...props} />)
  return { onPick, onEditDate }
}

describe("IpasStatusSteps (#1154)", () => {
  it("shows every step of an Import IPAS, with its day and who set it, and marks the current one", () => {
    renderSteps(ipasOf())

    const rows = screen.getAllByRole("listitem")
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "ipas-step-order_draft",
      "ipas-step-payment_approval",
      "ipas-step-ordered",
      "ipas-step-processing",
      "ipas-step-shipped",
      "ipas-step-in_transit",
      "ipas-step-customs",
      "ipas-step-local_hub",
      "ipas-step-out_for_delivery",
      "ipas-step-delivered",
      "ipas-step-done",
    ])
    const current = screen.getByTestId("ipas-step-in_transit")
    expect(current).toHaveAttribute("aria-current", "step")
    expect(within(current).getByText("Nov 10, 2026")).toBeInTheDocument()
    expect(within(current).getByText("set by Lia")).toBeInTheDocument()
    expect(within(screen.getByTestId("ipas-step-processing")).queryByText(/2026/)).toBeNull()
  })

  it("leaves out the Import-only steps on a Local IPAS", () => {
    renderSteps(ipasOf({ source: "local" }))

    expect(screen.queryByTestId("ipas-step-customs")).toBeNull()
    expect(screen.queryByTestId("ipas-step-local_hub")).toBeNull()
    expect(screen.queryByTestId("ipas-step-out_for_delivery")).toBeNull()
    expect(screen.getByTestId("ipas-step-delivered")).toBeInTheDocument()
  })

  it("asks the page for the date when a row is picked, going forward or back", async () => {
    const { onPick } = renderSteps(ipasOf())

    await userEvent.click(screen.getByRole("button", { name: "Set the status to Delivered" }))
    await userEvent.click(screen.getByRole("button", { name: "Set the status to Ordered" }))

    expect(onPick.mock.calls).toEqual([["delivered"], ["ordered"]])
  })

  it("offers Edit date on a reached step only", async () => {
    const { onEditDate } = renderSteps(ipasOf())

    expect(screen.queryByRole("button", { name: "Edit the Shipped / Picked Up date" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Edit the Ordered date" }))

    expect(onEditDate).toHaveBeenCalledWith("ordered")
  })

  it("shows Done but does not let it be picked: it comes from filing", () => {
    renderSteps(ipasOf())

    const done = screen.getByTestId("ipas-step-done")
    expect(within(done).getByText("Comes from filing")).toBeInTheDocument()
    expect(within(done).queryByRole("button")).toBeNull()
  })

  describe("the suggestion line (#1155)", () => {
    const poConfirmed = { purchaseOrder: { ticked: true }, receivedInOdoo: { ticked: false } }
    const draft = (over = {}) => ipasOf({ status: "order_draft", statusSteps: [], statuses: poConfirmed, ...over })

    it("asks to move to the furthest matching step, and moves only on the click", async () => {
      const onSuggest = vi.fn()
      renderSteps(draft(), { onSuggest })

      const line = screen.getByTestId("ipas-status-suggestion")
      expect(line).toHaveTextContent("Odoo says this PO is confirmed. Move to Ordered?")
      expect(onSuggest).not.toHaveBeenCalled()

      await userEvent.click(within(line).getByRole("button", { name: "Move to Ordered" }))
      expect(onSuggest).toHaveBeenCalledWith("ordered")
    })

    it("shows nothing when the status is already at or past the step", () => {
      renderSteps(ipasOf({ statuses: poConfirmed }), { onSuggest: vi.fn() })
      expect(screen.queryByTestId("ipas-status-suggestion")).toBeNull()
    })

    it("suggests Delivered from a Transmittal on Out for Delivery", () => {
      renderSteps(ipasOf({ status: "out_for_delivery", slips: [{ id: "t1" }] }), { onSuggest: vi.fn() })
      expect(screen.getByTestId("ipas-status-suggestion")).toHaveTextContent("Move to Delivered?")
    })

    it("shows nothing to a viewer who may not set the status", () => {
      renderSteps(draft(), { canSet: false, onSuggest: vi.fn() })
      expect(screen.queryByTestId("ipas-status-suggestion")).toBeNull()
    })
  })

  it("is read-only without the right to set the status, and on a filed IPAS", () => {
    const { rerender } = render(<IpasStatusSteps ipas={ipasOf()} canSet={false} onPick={vi.fn()} onEditDate={vi.fn()} />)
    expect(screen.queryAllByRole("button")).toHaveLength(0)

    rerender(<IpasStatusSteps ipas={ipasOf({ state: "filed", status: "done" })} canSet onPick={vi.fn()} onEditDate={vi.fn()} />)
    expect(screen.queryAllByRole("button")).toHaveLength(0)
  })
})
