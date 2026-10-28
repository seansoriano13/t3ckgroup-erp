/**
 * The three-slot Canvass form (#721, ADR 0047): three slots shown like the sheet's CANVASS MATRIX
 * tab, "No other supplier" on an empty slot 2 or 3 needing a reason, one reason serving both slots,
 * and the count of slots a winner needs. The database owns the rules (policy test 721); this checks
 * what the screen offers and what it hands over.
 */
import { describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import CanvassSlots from "./CanvassSlots"

const offer = (name) => ({ id: name, supplier_name: name })
const mark = (slot, reason) => ({ slot, reason, created_at: "2026-11-13T02:00:00Z", actor: { name: "Ben Cruz" } })

const show = (props = {}) => {
  const onMark = vi.fn()
  const onClear = vi.fn()
  render(<CanvassSlots offers={[]} marks={[]} canEdit onMark={onMark} onClear={onClear} {...props} />)
  return { onMark, onClear }
}

describe("the three slots", () => {
  it("shows three slots, with an Offer in the first and the rest not added yet", () => {
    show({ offers: [offer("Redleaf Inc.")] })
    expect(within(screen.getByTestId("slot-1")).getByText("Offer 1 added")).toBeInTheDocument()
    expect(within(screen.getByTestId("slot-2")).getByText("Not added yet")).toBeInTheDocument()
    expect(within(screen.getByTestId("slot-3")).getByText("Not added yet")).toBeInTheDocument()
    expect(screen.getByTestId("slots-summary")).toHaveTextContent("1 of 3 supplier slots filled or explained. A winner needs all 3.")
  })

  it("offers No other supplier on slots 2 and 3 only, and not once an Offer fills the slot", () => {
    show({ offers: [offer("A"), offer("B")] })
    expect(screen.queryByRole("button", { name: "No other supplier for supplier 1" })).toBeNull()
    expect(screen.queryByRole("button", { name: "No other supplier for supplier 2" })).toBeNull()
    expect(screen.getByRole("button", { name: "No other supplier for supplier 3" })).toBeInTheDocument()
  })

  it("shows an explained slot with its reason, who and when, and counts it", () => {
    show({ offers: [offer("A"), offer("B")], marks: [mark(3, "Sole distributor")] })
    const slot = screen.getByTestId("slot-3")
    expect(within(slot).getByText("No other supplier")).toBeInTheDocument()
    expect(within(slot).getByText("Sole distributor")).toBeInTheDocument()
    expect(within(slot).getByText(/Ben Cruz/)).toBeInTheDocument()
    expect(screen.getByTestId("slots-summary")).toHaveTextContent("3 of 3 supplier slots filled or explained.")
  })

  it("ignores a mark on a slot that has since got an Offer", () => {
    show({ offers: [offer("A"), offer("B"), offer("C")], marks: [mark(3, "Old reason")] })
    expect(screen.queryByText("Old reason")).toBeNull()
  })

  it("counts more than three Offers as allowed", () => {
    show({ offers: [offer("A"), offer("B"), offer("C"), offer("D")] })
    expect(screen.getByTestId("slots-summary")).toHaveTextContent("3 of 3")
    expect(screen.getByTestId("slots-summary")).toHaveTextContent("1 more offer below.")
  })
})

describe("marking No other supplier", () => {
  it("will not save without a reason", async () => {
    const { onMark } = show({ offers: [offer("A")] })
    await userEvent.click(screen.getByRole("button", { name: "No other supplier for supplier 2" }))
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    await userEvent.type(screen.getByRole("textbox"), "   ")
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    expect(onMark).not.toHaveBeenCalled()
  })

  it("saves one slot with its reason", async () => {
    const { onMark } = show({ offers: [offer("A"), offer("B")] })
    await userEvent.click(screen.getByRole("button", { name: "No other supplier for supplier 3" }))
    await userEvent.type(screen.getByRole("textbox"), "  Sole distributor ")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(onMark).toHaveBeenCalledWith({ slots: [3], reason: "Sole distributor" })
  })

  it("lets one reason serve both slots 2 and 3", async () => {
    const { onMark } = show({ offers: [offer("A")] })
    await userEvent.click(screen.getByRole("button", { name: "No other supplier for supplier 2" }))
    await userEvent.type(screen.getByRole("textbox"), "Only one dealer in the country")
    await userEvent.click(screen.getByRole("checkbox"))
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(onMark).toHaveBeenCalledWith({ slots: [2, 3], reason: "Only one dealer in the country" })
  })

  it("does not offer the shared reason when the other slot is filled", async () => {
    show({ offers: [offer("A"), offer("B")] })
    await userEvent.click(screen.getByRole("button", { name: "No other supplier for supplier 3" }))
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("takes a mark back off", async () => {
    const { onClear } = show({ offers: [offer("A")], marks: [mark(2, "Why not")] })
    await userEvent.click(screen.getByRole("button", { name: "Remove the No other supplier note on supplier 2" }))
    expect(onClear).toHaveBeenCalledWith(2)
  })

  it("is read-only when the viewer cannot edit", () => {
    show({ offers: [offer("A")], marks: [mark(2, "Why not")], canEdit: false })
    expect(screen.queryByRole("button")).toBeNull()
  })
})
