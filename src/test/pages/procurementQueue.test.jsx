/**
 * The Procurement Queue (#308) on the fake database: a Queue page whose rows
 * open the shared PurchaseRequestView in a slide-over (`?request=`, where
 * notifications link), sliced by unassigned / mine and open / closed, with
 * Take on an unassigned row. Who may read and take is the policy tier's
 * (44-procurement-queue, 41-purchase-request-chat-and-buyer).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router"

import ProcurementQueuePage from "@/pages/purchasing/index.jsx"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubProcurementQueueRpcs } from "@/test/stubs/procurementQueueRpc"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"

let authUser
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

let me, colleague, salesperson, unassigned, taken, done

function request({ ref, title, buyer = null, items = [] }) {
  const sor = makeOpportunity({
    registered_by: salesperson.id,
    deal_owner_id: salesperson.id,
    sales_reference: ref,
    project_title: title,
  })
  const r = db.seed("purchase_requests", { opportunity_id: sor.id, created_by: salesperson.id, buyer_id: buyer })
  db.seed("purchase_request_members", { request_id: r.id, employee_id: salesperson.id, side: "sales" })
  if (buyer) db.seed("purchase_request_members", { request_id: r.id, employee_id: buyer, side: "purchasing" })
  for (const [name, status] of items) {
    db.seed("purchase_request_items", {
      request_id: r.id,
      source: "new",
      name,
      quantity: 1,
      status,
      requested_by: salesperson.id,
    })
  }
  return r
}

const Where = () => <output data-testid="where">{useLocation().search}</output>

function renderAt(entry = "/purchasing") {
  return renderWithProviders(
    <MemoryRouter initialEntries={[entry]}>
      <ProcurementQueuePage />
      <Where />
    </MemoryRouter>,
  )
}

const rowFor = async (ref) => (await screen.findByText(ref)).closest("tr")
const tab = (name) => screen.getByRole("tab", { name: new RegExp(`^${name}`) })

beforeEach(() => {
  me = makeEmployee({ name: "Pia Buyer", department: "OPERATIONS", has_purchasing_flow: true })
  colleague = makeEmployee({ name: "Ben Cruz", department: "OPERATIONS", has_purchasing_flow: true })
  salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  authUser = { id: me.id, name: me.name, has_purchasing_flow: true }

  unassigned = request({ ref: "S01001", title: "Harbour lights", items: [["Floodlight", "requested"]] })
  taken = request({ ref: "S01002", title: "Bridge rails", buyer: colleague.id, items: [["Rail", "ordered"]] })
  done = request({ ref: "S01003", title: "Old depot", buyer: colleague.id, items: [["Bolt", "received"]] })

  stubProcurementQueueRpcs({ actorId: me.id })
  stubPurchaseRequestItemRpcs({ actorId: me.id })
})

describe("Procurement Queue", () => {
  it("is a Queue page listing open requests, with the closed ones a filter away", async () => {
    renderAt()

    expect(await screen.findByRole("heading", { name: /procurement\s*queue/i })).toBeInTheDocument()
    expect(await rowFor("S01001")).toBeInTheDocument()
    expect(await rowFor("S01002")).toBeInTheDocument()
    expect(screen.queryByText("S01003")).not.toBeInTheDocument()
    expect(within(await rowFor("S01001")).getByText("1 open of 1")).toBeInTheDocument()

    const user = setupUser()
    await user.click(within(screen.getByTestId("page-toolbar")).getByRole("button", { name: "Open" }))
    await user.click(await screen.findByText("Closed"))

    expect(await rowFor("S01003")).toBeInTheDocument()
    expect(screen.queryByText("S01001")).not.toBeInTheDocument()
  })

  it("slices by unassigned and mine", async () => {
    const user = setupUser()
    renderAt()
    await rowFor("S01001")

    await user.click(tab("Unassigned"))
    expect(screen.getByText("S01001")).toBeInTheDocument()
    expect(screen.queryByText("S01002")).not.toBeInTheDocument()

    await user.click(tab("Mine"))
    expect(screen.queryByText("S01001")).not.toBeInTheDocument()
    expect(screen.queryByText("S01002")).not.toBeInTheDocument()
    expect(screen.getByText("No matching requests")).toBeInTheDocument()
  })

  it("opens the picked request beside the list, in the URL, with its items, members and chat", async () => {
    const user = setupUser()
    renderAt()

    await user.click(await rowFor("S01002"))

    const sheet = await screen.findByRole("dialog")
    expect(screen.getByTestId("where")).toHaveTextContent(`?request=${taken.id}`)
    expect(within(sheet).getByText("Bridge rails")).toBeInTheDocument()
    expect(await within(sheet).findByText("Rail")).toBeInTheDocument()
    expect(await within(sheet).findByText("Ana Reyes")).toBeInTheDocument()
    expect(within(sheet).getByRole("region", { name: "Request chat" })).toBeInTheDocument()
    expect(within(sheet).getByText("1 / 2")).toBeInTheDocument()
  })

  it("opens straight from a notification's link", async () => {
    renderAt(`/purchasing?request=${done.id}`)

    const sheet = await screen.findByRole("dialog")
    expect(within(sheet).getByText("Old depot")).toBeInTheDocument()
  })

  it("Take on an unassigned row makes me the Buyer, and the row moves under Mine", async () => {
    const user = setupUser()
    renderAt()

    await user.click(within(await rowFor("S01001")).getByRole("button", { name: /take/i }))

    await waitFor(() => expect(db.rows("purchase_requests").find((r) => r.id === unassigned.id).buyer_id).toBe(me.id))
    expect(screen.getByTestId("where")).toHaveTextContent("")

    await user.click(tab("Mine"))
    expect(await rowFor("S01001")).toBeInTheDocument()
    expect(within(await rowFor("S01001")).getByText("Pia Buyer")).toBeInTheDocument()
    expect(screen.queryByText("S01002")).not.toBeInTheDocument()

    await user.click(tab("Unassigned"))
    expect(screen.queryByText("S01001")).not.toBeInTheDocument()
  })

  it("Take from the slide-over's footer", async () => {
    const user = setupUser()
    renderAt(`/purchasing?request=${unassigned.id}`)

    const sheet = await screen.findByRole("dialog")
    await user.click(await within(sheet).findByRole("button", { name: /^take$/i }))

    await waitFor(() => expect(db.rows("purchase_requests").find((r) => r.id === unassigned.id).buyer_id).toBe(me.id))
    const buyer = within(sheet).getByRole("region", { name: "Buyer" })
    expect(await within(buyer).findByText("Pia Buyer")).toBeInTheDocument()
    expect(within(sheet).queryByRole("button", { name: /^take$/i })).not.toBeInTheDocument()
  })
})
