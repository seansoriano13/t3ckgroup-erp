/**
 * Escape and the status menu inside the request panel (#555). The panel is a dialog; the status
 * dialog opens inside it. Escape must close only the status dialog, and a status menu takes
 * no clicks until it has finished opening.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { Dialog } from "@/components/ui/dialog"
import { RecordModalContent } from "@/components/ui/record-modal"
import { statusMenuReady } from "@/test/support/statusMenuReady"
import RequestedItems from "./RequestedItems"

let buyer, request

beforeEach(() => {
  const salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  buyer = makeEmployee({ name: "Ben Cruz", department: "OPERATIONS", has_purchasing_flow: true })
  const opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
  request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id, buyer_id: buyer.id })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: buyer.id, side: "purchasing" })
  db.seed("purchase_request_items", {
    request_id: request.id,
    source: "new",
    name: "Full Body Harness",
    unit: "pc",
    quantity: 10,
    requested_by: salesperson.id,
    status: "canvassing",
  })
  stubPurchaseRequestItemRpcs({ actorId: buyer.id })
})

const renderPanel = (onClose) =>
  renderWithProviders(
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <RecordModalContent>
        <RequestedItems request={request} />
      </RecordModalContent>
    </Dialog>,
  )

const openMenu = async (user) => {
  const row = (await screen.findByText("Full Body Harness")).closest("[data-testid='requested-item']")
  await user.click(within(row).getByRole("button", { name: "Change status of Full Body Harness" }))
  return row
}

describe("the request panel", () => {
  it("Escape closes only the status dialog, not the panel", async () => {
    const onClose = vi.fn()
    const user = setupUser()
    renderPanel(onClose)

    await openMenu(user)
    await statusMenuReady()
    await user.click(screen.getByRole("button", { name: "Cannot source" }))
    expect(await screen.findByText(/Keep it/)).toBeInTheDocument()

    await user.keyboard("{Escape}")

    await waitFor(() => expect(screen.queryByText("Keep it")).not.toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText("Full Body Harness")).toBeInTheDocument()
  })

  it("Escape on an open status menu closes the menu, not the panel", async () => {
    const onClose = vi.fn()
    const user = setupUser()
    renderPanel(onClose)

    await openMenu(user)
    expect(screen.getByRole("menu")).toBeInTheDocument()

    await user.keyboard("{Escape}")

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
  })

  it("a status menu takes no clicks until it has finished opening", async () => {
    const user = setupUser()
    renderPanel(vi.fn())

    const row = await openMenu(user)
    // A click in the very first instant of the menu picks nothing.
    fireEvent.click(screen.getByRole("button", { name: "Cannot source" }))
    expect(screen.queryByText("Keep it")).not.toBeInTheDocument()
    expect(within(row).getByText("Canvassing")).toBeInTheDocument()

    // Once open, the same click works.
    await statusMenuReady()
    await user.click(screen.getByRole("button", { name: "Cannot source" }))
    expect(await screen.findByText("Keep it")).toBeInTheDocument()
  })
})
