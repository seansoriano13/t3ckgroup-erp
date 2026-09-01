/**
 * Asking purchasing to source a product the company doesn't carry.
 *
 * ── Written to survive a UI rework ──────────────────────────────────────────
 * These assert on the *payload handed to procurementService* and on
 * accessible names — never on class names, DOM structure, or copy. Restyle the
 * panel, move the controls, rewrite the labels, and these should still pass;
 * if one fails after a redesign, a rule actually changed and that is the point.
 *
 * The rules worth protecting, in order of how expensive they are to get wrong:
 *   1. A request needs a named product — an empty composer submitted is a
 *      comment, not a request, and must not create a task.
 *   2. A request always has exactly one named owner, or none and a team head
 *      to name one. Never a nameless task.
 *   3. A team mention carries the sub-department, not just the department —
 *      purchasing sits under OPERATIONS and the department alone routes to the
 *      wrong desk.
 *
 * If a redesign needs different handles, change the aria-labels here and in the
 * component together — do not reach for test ids or class selectors.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithProviders } from "../../test/support"
import ProcurementPanel from "./ProcurementPanel"
import { procurementService } from "../../services/procurementService"

const SALES_ID = "11111111-1111-4111-8111-111111111111"
const BUYER_ID = "22222222-2222-4222-8222-222222222222"
const HEAD_ID = "33333333-3333-4333-8333-333333333333"

// Mirrors the real org: purchasing is a sub-department under OPERATIONS, which
// has its own department-level head. Flattening this hides the routing rule.
const EMPLOYEES = [
  { id: SALES_ID, name: "Ana Reyes", department: "SALES", subDepartment: null },
  {
    id: HEAD_ID,
    name: "Raquel Galacgac",
    department: "OPERATIONS",
    subDepartment: "PURCHASING",
  },
  {
    id: BUYER_ID,
    name: "Cjay Espina",
    department: "OPERATIONS",
    subDepartment: "PURCHASING",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Gracean Escobedo",
    department: "OPERATIONS",
    subDepartment: null,
  },
]

const OPPORTUNITY = { id: "opp-1", sales_reference: "S01237", client_name: "ACME Corp" }

vi.mock("../../services/employeeService", () => ({
  employeeService: { getAllEmployees: vi.fn(async () => EMPLOYEES) },
}))

vi.mock("../../services/procurementService", () => ({
  procurementService: {
    listForOpportunity: vi.fn(async () => []),
    createRequest: vi.fn(async (payload) => payload.items),
    assignRequests: vi.fn(async () => "task-1"),
    updateRequest: vi.fn(async (id, updates) => ({ id, ...updates })),
    deleteRequest: vi.fn(async (id) => ({ id })),
  },
}))

vi.mock("react-hot-toast", () => {
  // Both the default and named `toast` exports are used across this tree —
  // react-hot-toast itself re-exports one as the other. confirmDeleteToast
  // (src/components/ui/CustomToast.jsx) imports the named one and calls
  // `.custom`, which a default-only mock leaves undefined.
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), custom: vi.fn() })
  return { default: toast, toast }
})

vi.mock("../ui/CustomToast", () => ({
  // The real confirmDeleteToast renders its confirm/cancel buttons inside a
  // toast.custom(...) callback, which needs a live <Toaster/> portal to ever
  // reach the DOM — nothing here mounts one. Skipping straight to onConfirm
  // tests what this panel is responsible for (wiring delete to
  // procurementService), not the generic confirm-toast widget itself, which
  // has no test of its own to duplicate here.
  confirmDeleteToast: (_title, _description, onConfirm) => onConfirm(),
}))

vi.mock("../../lib/supabase", () => ({
  supabase: {
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  },
}))

let authUser = { id: SALES_ID, isSuperAdmin: false, is_head: false }
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: authUser }),
}))

const request = (overrides = {}) => ({
  id: "req-1",
  opportunity_id: OPPORTUNITY.id,
  requested_name: "Hydraulic hose kit",
  requested_quantity: 5,
  requested_unit: "set",
  outcome: null,
  // Matches the default authUser (SALES_ID) below — canEdit checks
  // `user.id === requested_by`, and most fixtures here stand in for the
  // salesperson looking at their own request.
  requested_by: SALES_ID,
  assigned_to: BUYER_ID,
  assignee: { id: BUYER_ID, name: "Cjay Espina" },
  verification: "UNVERIFIED",
  ...overrides,
})

async function renderPanel({ requests = [] } = {}) {
  procurementService.listForOpportunity.mockResolvedValue(requests)
  const view = renderWithProviders(<ProcurementPanel opportunity={OPPORTUNITY} />)

  // Two independent queries feed this panel. Requests may arrive first or
  // second, so an assertion made before both land reads as "the rule did not
  // apply" rather than "the data had not arrived" — wait for both explicitly.
  //
  // The signal is the header, not the first product name: a fully-resolved set
  // folds itself the moment the data lands, so the name is not on screen for
  // those fixtures. The header renders whenever there is at least one request,
  // folded or not, which is exactly the condition being waited on.
  if (requests.length) {
    await screen.findByRole("button", { name: /procurement requests/i })
  } else {
    await screen.findByRole("button", { name: /request a product/i })
  }
  return view
}

const openComposer = (user) =>
  user.click(screen.getByRole("button", { name: /request a product/i }))

const nameProduct = (user, name, index = 1) =>
  user.type(screen.getByRole("textbox", { name: `Product name ${index}` }), name)

/**
 * Picks a recipient through the @ typeahead. Typing rather than clicking a
 * list is the whole point of the control, so the test drives it the way a
 * person does.
 */
async function mention(user, query, optionLabel) {
  const field = screen.getByRole("textbox", { name: "Send to" })
  await user.clear(field)
  await user.type(field, query)
  await user.click(await screen.findByRole("option", { name: optionLabel }))
}

const sendButton = () =>
  screen.getByRole("button", { name: /^(send \d+|name a product|sending)/i })

beforeEach(() => {
  vi.clearAllMocks()
  authUser = { id: SALES_ID, isSuperAdmin: false, is_head: false }
  procurementService.listForOpportunity.mockResolvedValue([])
  procurementService.createRequest.mockImplementation(async (p) => p.items)
})

describe("the form stays collapsed until asked for", () => {
  it("shows a single button on a deal with nothing outstanding", async () => {
    await renderPanel()
    expect(screen.getByRole("button", { name: /request a product/i })).toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "Product name 1" })).toBeNull()
  })

  it("opens the composer on click", async () => {
    const user = userEvent.setup()
    await renderPanel()
    await openComposer(user)
    expect(screen.getByRole("textbox", { name: "Product name 1" })).toBeInTheDocument()
  })

  it("puts the cursor in the first field so the next keystroke lands", async () => {
    const user = userEvent.setup()
    await renderPanel()
    await openComposer(user)

    // Opening a form and leaving focus on the button behind it means the user
    // has to click again before typing.
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Product name 1" })).toHaveFocus(),
    )
  })

  it("brings the composer into view rather than opening it off screen", async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const user = userEvent.setup()
    await renderPanel()
    await openComposer(user)

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    // "nearest", not "center": this panel sits low in a long modal, and
    // centring it would drag the product list off screen for no reason.
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" })
    delete Element.prototype.scrollIntoView
  })

  it("cancel closes it again without sending anything", async () => {
    const user = userEvent.setup()
    await renderPanel()
    await openComposer(user)
    await nameProduct(user, "Hydraulic hose kit")
    await user.click(screen.getByRole("button", { name: /^cancel$/i }))

    expect(screen.queryByRole("textbox", { name: "Product name 1" })).toBeNull()
    expect(procurementService.createRequest).not.toHaveBeenCalled()
  })
})

describe("a named product is what creates the request", () => {
  it("will not send with an empty composer, however the buyer is chosen", async () => {
    const user = userEvent.setup()
    await renderPanel()
    await openComposer(user)
    await mention(user, "cjay", /Cjay Espina/)
    await user.click(sendButton())

    // A blank product name submitted is a comment, not a request. Letting it
    // through fills the purchasing task list with chatter nobody can action.
    expect(procurementService.createRequest).not.toHaveBeenCalled()
  })

  it("will not send a name with nobody chosen to receive it", async () => {
    const user = userEvent.setup()
    await renderPanel()
    await openComposer(user)
    await nameProduct(user, "Hydraulic hose kit")
    await user.click(sendButton())

    // A task with no owner is the group-task failure mode this flow exists to
    // avoid: visible to everyone, owned by nobody.
    expect(procurementService.createRequest).not.toHaveBeenCalled()
  })

  it("sends the name, quantity, unit and description together", async () => {
    const user = userEvent.setup()
    await renderPanel()
    await openComposer(user)

    await nameProduct(user, "Hydraulic hose kit")
    // Four presses of "+" from the default of 1.
    const bump = screen.getByRole("button", { name: "Increase Quantity 1" })
    for (let i = 0; i < 4; i += 1) await user.click(bump)
    await user.click(screen.getByText("unit"))
    await user.click(await screen.findByRole("button", { name: "set" }))
    await user.type(
      screen.getByRole("textbox", { name: "Description 1" }),
      "Client wants 5m, high pressure",
    )
    await mention(user, "cjay", /Cjay Espina/)
    await user.click(sendButton())

    await waitFor(() => expect(procurementService.createRequest).toHaveBeenCalledTimes(1))

    const payload = procurementService.createRequest.mock.calls[0][0]
    expect(payload).toMatchObject({
      opportunityId: OPPORTUNITY.id,
      assigneeId: BUYER_ID,
      requesterId: SALES_ID,
    })
    expect(payload.items).toEqual([
      {
        product_name: "Hydraulic hose kit",
        quantity: 5,
        unit: "set",
        description: "Client wants 5m, high pressure",
        images: [],
      },
    ])
  })

  it("supports more than one product per request", async () => {
    const user = userEvent.setup()
    await renderPanel()
    await openComposer(user)

    await nameProduct(user, "Hydraulic hose kit")
    await user.click(screen.getByRole("button", { name: /add another product/i }))
    await nameProduct(user, "Safety harness", 2)
    await mention(user, "cjay", /Cjay Espina/)
    await user.click(sendButton())

    await waitFor(() => expect(procurementService.createRequest).toHaveBeenCalled())
    expect(
      procurementService.createRequest.mock.calls[0][0].items.map((i) => i.product_name),
    ).toEqual(["Hydraulic hose kit", "Safety harness"])
  })

  it("drops a card added and then left blank", async () => {
    const user = userEvent.setup()
    await renderPanel()
    await openComposer(user)

    await nameProduct(user, "Hydraulic hose kit")
    await user.click(screen.getByRole("button", { name: /add another product/i }))
    // second card left empty
    await mention(user, "cjay", /Cjay Espina/)
    await user.click(sendButton())

    await waitFor(() => expect(procurementService.createRequest).toHaveBeenCalled())
    expect(procurementService.createRequest.mock.calls[0][0].items).toHaveLength(1)
  })
})

describe("who ends up owning it", () => {
  it("names a buyer directly when one is picked", async () => {
    const user = userEvent.setup()
    await renderPanel()
    await openComposer(user)
    await nameProduct(user, "Hydraulic hose kit")
    await mention(user, "cjay", /Cjay Espina/)
    await user.click(sendButton())

    await waitFor(() => expect(procurementService.createRequest).toHaveBeenCalled())
    expect(procurementService.createRequest.mock.calls[0][0]).toMatchObject({
      assigneeId: BUYER_ID,
      department: null,
      subDepartment: null,
    })
  })

  it("sends the sub-department when a team is mentioned, not just the department", async () => {
    const user = userEvent.setup()
    await renderPanel()
    await openComposer(user)
    await nameProduct(user, "Hydraulic hose kit")
    await mention(user, "purchasing", "OPERATIONS › PURCHASING")
    await user.click(sendButton())

    await waitFor(() => expect(procurementService.createRequest).toHaveBeenCalled())

    // Purchasing sits under OPERATIONS. Sending the department alone routes to
    // the head with no sub-department — the Operations Manager — the wrong
    // desk, and an extra hop before anyone can act.
    expect(procurementService.createRequest.mock.calls[0][0]).toMatchObject({
      assigneeId: null,
      department: "OPERATIONS",
      subDepartment: "PURCHASING",
    })
  })

  it("puts purchasing at the top before anything is typed", async () => {
    const user = userEvent.setup()
    await renderPanel()
    await openComposer(user)

    // This panel exists to reach purchasing. Ranking every recipient by name
    // buried the three people who receive requisitions behind everyone who
    // never will.
    await user.click(screen.getByRole("textbox", { name: "Send to" }))
    const shown = (await screen.findAllByRole("option")).map((o) => o.textContent)

    expect(shown.slice(0, 3).every((label) => /PURCHASING/.test(label))).toBe(true)
    // Ranked, not filtered — everyone else is still reachable by typing.
    expect(shown.some((label) => /Gracean|Ana/.test(label))).toBe(true)
  })

  it("offers people and teams from one field, with people first", async () => {
    const user = userEvent.setup()
    await renderPanel()
    await openComposer(user)

    // One control, not a mode toggle: "purchasing" surfaces both the buyers
    // and the team they sit in. Naming a person is the faster path, so people
    // outrank their own team.
    await user.type(screen.getByRole("textbox", { name: "Send to" }), "purchasing")
    const shown = (await screen.findAllByRole("option")).map((o) => o.textContent)

    expect(shown).toContain("Cjay Espina — PURCHASING")
    expect(shown).toContain("OPERATIONS › PURCHASING")
    expect(shown.indexOf("Cjay Espina — PURCHASING")).toBeLessThan(
      shown.indexOf("OPERATIONS › PURCHASING"),
    )
  })

  it("lets a head assign the buyer for requests nobody owns yet", async () => {
    authUser = { id: HEAD_ID, isSuperAdmin: false, is_head: true }
    const user = userEvent.setup()
    const unowned = [
      request({ id: "req-1", assigned_to: null, assignee: null }),
      request({ id: "req-2", assigned_to: null, assignee: null, requested_name: "Safety harness" }),
    ]
    await renderPanel({ requests: unowned })

    // The head's picker offers people only — assigning a request to a team
    // would just reproduce the state it is trying to resolve.
    const field = screen.getAllByRole("textbox", { name: "Send to" })[0]
    await user.type(field, "cjay")
    await user.click(await screen.findByRole("option", { name: /Cjay Espina/ }))
    await user.click(screen.getByRole("button", { name: /^assign$/i }))

    await waitFor(() => expect(procurementService.assignRequests).toHaveBeenCalled())
    const [ids, assignee, actor] = procurementService.assignRequests.mock.calls[0]
    expect(ids).toEqual(["req-1", "req-2"])
    expect(assignee).toBe(BUYER_ID)
    expect(actor).toBe(HEAD_ID)
  })

  it("does not offer assignment to someone who is not a head", async () => {
    const unowned = [request({ assigned_to: null, assignee: null })]
    await renderPanel({ requests: unowned })

    expect(screen.queryByText(/need a buyer/i)).toBeNull()
  })
})

describe("a request already sent", () => {
  it("shows what came back for it, including a screenshot if there was one", async () => {
    const user = userEvent.setup()
    await renderPanel({
      requests: [
        request({
          outcome: "ON_ORDER",
          po_number: "P01234",
          verification: "VERIFIED",
          requested_description: "5m, high pressure",
          requested_images: [
            { url: "https://res.cloudinary.com/t3ck/hose.jpg", name: "hose.jpg" },
          ],
        }),
      ],
    })

    // A fully-resolved request folds by default (see "the header earns its
    // space only once there is something to report" in ProcurementPanel) —
    // expand it before asserting on what's inside.
    await user.click(screen.getByRole("button", { name: /procurement/i }))

    expect(screen.getByText("P01234")).toBeInTheDocument()
    expect(screen.getByText(/purchased/i)).toBeInTheDocument()
    expect(screen.getByText("5m, high pressure")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "hose.jpg" })).toBeInTheDocument()
  })

  it("shows who the PO was placed with", async () => {
    const user = userEvent.setup()
    await renderPanel({
      requests: [
        request({
          outcome: "ON_ORDER",
          po_number: "P02531",
          verification: "VERIFIED",
          odoo_vendor: "Firewolf Motors",
        }),
      ],
    })

    await user.click(screen.getByRole("button", { name: /procurement/i }))
    expect(screen.getByText("Firewolf Motors")).toBeInTheDocument()
  })

  it("shows nothing extra for a vendor field when nothing has been bought yet", async () => {
    await renderPanel({ requests: [request()] })

    expect(screen.queryByText(/vendor/i)).toBeNull()
  })

  it("says when the PO could not be confirmed, rather than implying it was", async () => {
    const user = userEvent.setup()
    await renderPanel({
      requests: [request({ outcome: "ON_ORDER", po_number: "P09999", verification: "NOT_FOUND" })],
    })

    await user.click(screen.getByRole("button", { name: /procurement/i }))
    expect(screen.getByText(/not found in odoo/i)).toBeInTheDocument()
  })

  it("still lets a new request be composed", async () => {
    const user = userEvent.setup()
    await renderPanel({ requests: [request()] })

    // An open request must not gate the whole panel — sales may need to ask
    // for a second, unrelated product while the first is still with purchasing.
    await openComposer(user)
    expect(screen.getByRole("textbox", { name: "Product name 1" })).toBeInTheDocument()
  })

  it("lets sales edit an open request before a PO is recorded", async () => {
    const user = userEvent.setup()
    await renderPanel({ requests: [request()] })

    await user.click(screen.getByRole("button", { name: /edit hydraulic hose kit/i }))
    const input = screen.getByPlaceholderText(/product name/i)
    await user.clear(input)
    await user.type(input, "Hydraulic hose kit (Heavy Duty)")
    await user.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() => expect(procurementService.updateRequest).toHaveBeenCalled())
    const [id, payload] = procurementService.updateRequest.mock.calls[0]
    expect(id).toBe("req-1")
    expect(payload.product_name).toBe("Hydraulic hose kit (Heavy Duty)")
  })

  it("hides edit controls for users not on the deal", async () => {
    authUser = { id: "user-random", isSuperAdmin: false, is_head: false }
    await renderPanel({ requests: [request()] })
    
    expect(screen.queryByRole("button", { name: /edit hydraulic hose kit/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /delete hydraulic hose kit/i })).toBeNull()
  })

  it("shows edit controls for another salesperson on the same deal", async () => {
    authUser = { id: "user-partner", isSuperAdmin: false, is_head: false }
    const opp = { ...OPPORTUNITY, support_sales_1_id: "user-partner" }
    procurementService.listForOpportunity.mockResolvedValue([request()])
    await renderWithProviders(<ProcurementPanel opportunity={opp} />)
    await screen.findByRole("button", { name: /procurement requests/i })
    
    expect(screen.getByRole("button", { name: /edit hydraulic hose kit/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /delete hydraulic hose kit/i })).toBeInTheDocument()
  })

  it("lets sales cancel/delete an open request before a PO is recorded", async () => {
    const user = userEvent.setup()
    await renderPanel({ requests: [request()] })

    await user.click(screen.getByRole("button", { name: /delete hydraulic hose kit/i }))

    await waitFor(() => expect(procurementService.deleteRequest).toHaveBeenCalled())
    const [id] = procurementService.deleteRequest.mock.calls[0]
    expect(id).toBe("req-1")
  })

  it("locks edit and delete actions once a PO is purchased", async () => {
    const user = userEvent.setup()
    await renderPanel({
      requests: [request({ outcome: "PURCHASED", po_number: "P01234" })],
    })

    await user.click(screen.getByRole("button", { name: /procurement/i }))
    expect(screen.queryByRole("button", { name: /edit hydraulic hose kit/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /delete hydraulic hose kit/i })).toBeNull()
  })

  it("lets sales click View Task to open the purchasing task details", async () => {
    const user = userEvent.setup()
    const dispatchSpy = vi.spyOn(window, "dispatchEvent")
    await renderPanel({ requests: [request({ task_id: "task-123" })] })

    const taskBtn = screen.getByRole("button", { name: /task/i })
    expect(taskBtn).toBeInTheDocument()

    await user.click(taskBtn)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "OPEN_ENTITY_DETAILS",
        detail: { id: "task-123", type: "TASK" },
      }),
    )
  })
})
