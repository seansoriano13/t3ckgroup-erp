/**
 * The purchasing side: answering a requisition, one product at a time.
 *
 * ── Written to survive a UI rework ──────────────────────────────────────────
 * These assert on the *payload handed to purchasingService.resolveRequest*
 * and on accessible names — never on class names, DOM structure, or copy.
 *
 * The rules worth protecting:
 *   1. Invisible on tasks that are not requisitions.
 *   2. An outcome claiming a buy happened cannot be recorded without a PO
 *      number — that number is the only evidence the work was done.
 *   3. An outcome where nothing was bought must NOT demand one, or the buyer
 *      invents one to get past the form.
 *   4. Each product is answered separately, since one PO per supplier means a
 *      request routinely spans several.
 *
 * If a redesign needs different handles, change the aria-labels here and in the
 * component together — do not reach for test ids or class selectors.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithProviders } from "../test/support"
import ProcurementResolutionPanel from "./ProcurementResolutionPanel"
import { purchasingService } from "../services/purchasingService"
import { PROCUREMENT_OUTCOME } from "../constants/procurement"

const TASK_ID = "task-1"
const BUYER_ID = "22222222-2222-4222-8222-222222222222"

vi.mock("../services/purchasingService", () => ({
  purchasingService: {
    listForTask: vi.fn(async () => []),
    sorForTask: vi.fn(async () => null),
    resolveRequest: vi.fn(async () => ({
      id: "req-1",
      opportunity_id: "opp-1",
      verification: "VERIFIED",
    })),
    verifyPoNumber: vi.fn(async () => ({
      state: "VERIFIED",
      productRef: "[HOSE-01] Hydraulic Hose 5m",
    })),
  },
}))

vi.mock("../lib/supabase", () => ({
  supabase: {
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  },
}))

vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

const request = (overrides = {}) => ({
  id: "req-1",
  task_id: TASK_ID,
  opportunity_id: "opp-1",
  requested_name: "Hydraulic hose kit",
  requested_quantity: 5,
  requested_unit: "sets",
  outcome: null,
  verification: "UNVERIFIED",
  ...overrides,
})

async function renderPanel(requests, props = {}) {
  purchasingService.listForTask.mockResolvedValue(requests)
  const view = renderWithProviders(
    <ProcurementResolutionPanel taskId={TASK_ID} userId={BUYER_ID} {...props} />,
  )
  if (requests.length) await screen.findByText(requests[0].requested_name)
  return view
}

const chooseOutcome = async (user, label, formIndex = 0) => {
  const triggers = screen.getAllByText(
    /select status|in progress|purchased|delivered|already in odoo|substituted|cannot source/i,
  )
  const trigger = triggers[formIndex] || triggers[0]
  await user.click(trigger)
  const option = await screen.findByRole("button", { name: new RegExp(`^${label}`, "i") })
  await user.click(option)
}

const recordButton = () =>
  screen.getByRole("button", {
    name: /record outcome|set to in progress|enter po number|save changes/i,
  })

beforeEach(() => {
  vi.clearAllMocks()
  purchasingService.resolveRequest.mockResolvedValue({
    id: "req-1",
    opportunity_id: "opp-1",
    verification: "VERIFIED",
  })
})

describe("what the buyer is sourcing from", () => {
  it("shows the client's own wording so the buyer isn't sourcing blind", async () => {
    await renderPanel([
      request({ requested_description: "Needs to survive -10°C, client sent a spec PDF" }),
    ])

    expect(
      screen.getByText("Needs to survive -10°C, client sent a spec PDF"),
    ).toBeInTheDocument()
  })

  it("shows the screenshot the client sent, not just a description", async () => {
    // Sales rarely retypes specs — they paste the screenshot of the client's
    // message. If the buyer never sees it, the request is only half-forwarded.
    await renderPanel([
      request({
        requested_images: [
          { url: "https://res.cloudinary.com/t3ck/spec.jpg", name: "spec.jpg" },
        ],
      }),
    ])

    expect(screen.getByRole("img", { name: "spec.jpg" })).toBeInTheDocument()
  })

  it("says nothing extra when the ask was just a name", async () => {
    await renderPanel([request({ requested_description: null, requested_images: [] })])

    expect(screen.queryByRole("img")).toBeNull()
  })
})

describe("staying out of the way", () => {
  it("renders nothing on a task that is not a requisition", async () => {
    const { container } = await renderPanel([])
    // Every ordinary task in the system mounts this component. It has to cost
    // the user nothing when there is no procurement on it.
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})

describe("the PO number is the evidence", () => {
  it("will not record a purchased outcome without one", async () => {
    const user = userEvent.setup()
    await renderPanel([request()])

    await chooseOutcome(user, "Purchased")
    await user.click(recordButton())

    expect(purchasingService.resolveRequest).not.toHaveBeenCalled()
  })

  it("allows setting status to in progress instantly on dropdown selection without a PO number or form submit", async () => {
    const user = userEvent.setup()
    await renderPanel([request()])

    await chooseOutcome(user, "In progress")

    await waitFor(() => expect(purchasingService.resolveRequest).toHaveBeenCalled())
    const [requestId, payload] = purchasingService.resolveRequest.mock.calls[0]
    expect(requestId).toBe("req-1")
    expect(payload.outcome).toBe(PROCUREMENT_OUTCOME.IN_PROGRESS)
    expect(payload.poNumber).toBe("")
  })

  it("will not record a substitution without one either", async () => {
    const user = userEvent.setup()
    await renderPanel([request()])

    await chooseOutcome(user, "Substituted")
    await user.click(recordButton())

    expect(purchasingService.resolveRequest).not.toHaveBeenCalled()
  })

  it("does not demand a PO when nothing was bought", async () => {
    const user = userEvent.setup()
    await renderPanel([request()])

    await chooseOutcome(user, "Already in Odoo")

    // The PO is optional and does not block recording when nothing was bought
    await user.click(recordButton())
    await waitFor(() => expect(purchasingService.resolveRequest).toHaveBeenCalled())
  })

  it("does not demand a PO when the product cannot be sourced", async () => {
    const user = userEvent.setup()
    await renderPanel([request()])

    await chooseOutcome(user, "Cannot source")

    await user.click(recordButton())
    await waitFor(() => expect(purchasingService.resolveRequest).toHaveBeenCalled())
  })

  it("clears PO number and product name when switching outcome to In Progress in the edit form", async () => {
    const user = userEvent.setup()
    await renderPanel([request()])

    await chooseOutcome(user, "Purchased")
    await user.type(screen.getByRole("textbox", { name: "PO Number" }), "P01234")
    expect(screen.getByRole("textbox", { name: "PO Number" }).value).toBe("P01234")

    await chooseOutcome(user, "In progress")
    expect(screen.getByRole("textbox", { name: "PO Number" }).value).toBe("")
  })
})

describe("what gets recorded", () => {
  it("sends the outcome, the PO, the ETA and the note for one product", async () => {
    const user = userEvent.setup()
    await renderPanel([request()])

    await chooseOutcome(user, "Purchased")
    await user.type(screen.getByRole("textbox", { name: "PO Number" }), "P01234")
    // Wait out the verifyPoNumber debounce — submitting before it resolves
    // sends whatever odooProductRef held before verification (empty), not
    // what Odoo actually returned.
    await waitFor(() =>
      expect(screen.getByDisplayValue("[HOSE-01] Hydraulic Hose 5m")).toBeInTheDocument(),
    )
    fireEvent.change(screen.getByLabelText("ETA"), { target: { value: "2026-09-12T14:30" } })
    await user.type(screen.getByRole("textbox", { name: /purchasing remarks|note for sales/i }), "6 week lead time")
    await user.click(recordButton())

    await waitFor(() => expect(purchasingService.resolveRequest).toHaveBeenCalled())

    const [requestId, payload, actorId] = purchasingService.resolveRequest.mock.calls[0]
    expect(requestId).toBe("req-1")
    expect(actorId).toBe(BUYER_ID)
    expect(payload).toMatchObject({
      outcome: PROCUREMENT_OUTCOME.PURCHASED,
      poNumber: "P01234",
      odooProductRef: "[HOSE-01] Hydraulic Hose 5m",
      eta: "2026-09-12T14:30",
      note: "6 week lead time",
    })
  })

  it("answers each product on its own, so two suppliers means two POs", async () => {
    const user = userEvent.setup()
    await renderPanel([
      request({ id: "req-1", requested_name: "Hydraulic hose kit" }),
      request({ id: "req-2", requested_name: "Safety harness" }),
    ])

    // Two independent forms, answer the second one
    await chooseOutcome(user, "Purchased", 1)
    const poFields = screen.getAllByRole("textbox", { name: "PO Number" })
    expect(poFields).toHaveLength(1)

    await user.type(poFields[0], "P05678")
    const recordButtons = screen.getAllByRole("button", {
      name: /save changes|record outcome|enter po number/i,
    })
    await user.click(recordButtons[0])

    await waitFor(() => expect(purchasingService.resolveRequest).toHaveBeenCalled())
    const [requestId, payload] = purchasingService.resolveRequest.mock.calls[0]
    expect(requestId).toBe("req-2")
    expect(payload.poNumber).toBe("P05678")
  })

  it("shows who the PO was placed with once the buyer has recorded it", async () => {
    await renderPanel([
      request({
        outcome: PROCUREMENT_OUTCOME.PURCHASED,
        po_number: "P02531",
        verification: "VERIFIED",
        odoo_vendor: "Firewolf Motors",
      }),
    ])

    expect(screen.getByText("Firewolf Motors")).toBeInTheDocument()
  })

  it("leaves an already-answered product alone until edit is clicked", async () => {
    await renderPanel([
      request({
        outcome: PROCUREMENT_OUTCOME.PURCHASED,
        po_number: "P01234",
        verification: "VERIFIED",
      }),
    ])

    expect(screen.queryByRole("button", { name: /^purchased$/i })).toBeNull()
    expect(screen.getByText("P01234")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /edit outcome/i })).toBeInTheDocument()
  })

  it("allows editing an already-recorded PO number and saving changes", async () => {
    const user = userEvent.setup()
    await renderPanel([
      request({
        outcome: PROCUREMENT_OUTCOME.PURCHASED,
        po_number: "P01234",
        verification: "VERIFIED",
      }),
    ])

    await user.click(screen.getByRole("button", { name: /edit outcome/i }))
    const poInput = screen.getByRole("textbox", { name: "PO Number" })
    expect(poInput).toHaveValue("P01234")

    await user.clear(poInput)
    await user.type(poInput, "P02540")
    await user.click(screen.getByRole("button", { name: /save changes/i }))

    await waitFor(() => expect(purchasingService.resolveRequest).toHaveBeenCalled())
    const [requestId, payload] = purchasingService.resolveRequest.mock.calls[0]
    expect(requestId).toBe("req-1")
    expect(payload.poNumber).toBe("P02540")
  })

  it("disables the Odoo product name field when the PO is verified in Odoo", async () => {
    const user = userEvent.setup()
    await renderPanel([
      request({
        outcome: PROCUREMENT_OUTCOME.PURCHASED,
        po_number: "P01234",
        odoo_product_ref: "LITHIUM CHARGER 48V",
        verification: "VERIFIED",
      }),
    ])

    await user.click(screen.getByRole("button", { name: /edit outcome/i }))
    const productInput = screen.getByRole("textbox", { name: "Odoo product name" })
    expect(productInput).toHaveAttribute("readonly")
    expect(screen.getByText(/verified from odoo po/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument()
  })

  it("provides 1-click quick action to mark a purchased item as delivered", async () => {
    const user = userEvent.setup()
    await renderPanel([
      request({
        outcome: PROCUREMENT_OUTCOME.PURCHASED,
        po_number: "P01234",
        verification: "VERIFIED",
      }),
    ])

    await user.click(screen.getByRole("button", { name: /mark delivered/i }))

    await waitFor(() => expect(purchasingService.resolveRequest).toHaveBeenCalled())
    const [requestId, payload] = purchasingService.resolveRequest.mock.calls[0]
    expect(requestId).toBe("req-1")
    expect(payload.outcome).toBe(PROCUREMENT_OUTCOME.DELIVERED)
    expect(payload.poNumber).toBe("P01234")
  })

  it("Record PO button opens the resolution form with Purchased preselected", async () => {
    const user = userEvent.setup()
    await renderPanel([
      request({
        outcome: PROCUREMENT_OUTCOME.IN_PROGRESS,
      }),
    ])

    await user.click(screen.getByRole("button", { name: /record po/i }))
    expect(screen.getByRole("textbox", { name: "PO Number" })).toBeInTheDocument()
    // The outcome trigger is a non-semantic div (FilterTrigger/Dropdown), not
    // an accessible button — matched the same way chooseOutcome() does.
    expect(screen.getByText(/^purchased$/i)).toBeInTheDocument()
  })

  it("calls onDeliveredComplete when all items are delivered and task is auto-submitted", async () => {
    const onDeliveredComplete = vi.fn()
    purchasingService.resolveRequest.mockResolvedValue({
      id: "req-1",
      outcome: PROCUREMENT_OUTCOME.DELIVERED,
      task_id: TASK_ID,
      opportunity_id: "opp-1",
      taskAutoSubmitted: true,
    })
    const user = userEvent.setup()
    await renderPanel(
      [
        request({
          outcome: PROCUREMENT_OUTCOME.PURCHASED,
          po_number: "P01234",
          verification: "VERIFIED",
        }),
      ],
      { onDeliveredComplete },
    )

    await user.click(screen.getByRole("button", { name: /mark delivered/i }))
    await waitFor(() => expect(onDeliveredComplete).toHaveBeenCalled())
  })

  it("shows the buyer where their requisition stands", async () => {
    await renderPanel([
      request({ id: "req-1", outcome: PROCUREMENT_OUTCOME.PURCHASED, po_number: "P01234" }),
      request({ id: "req-2", requested_name: "Safety harness" }),
    ])

    expect(screen.getByText(/1\/2 done/i)).toBeInTheDocument()
  })
})

describe("what the buyer is told about the PO check", () => {
  it("says the number was not found rather than letting it read as confirmed", async () => {
    const toast = (await import("react-hot-toast")).default
    const user = userEvent.setup()
    purchasingService.resolveRequest.mockResolvedValue({
      id: "req-1",
      opportunity_id: "opp-1",
      po_number: "P09999",
      verification: "NOT_FOUND",
    })
    await renderPanel([request()])

    await chooseOutcome(user, "Purchased")
    await user.type(screen.getByRole("textbox", { name: "PO Number" }), "P09999")
    await user.click(recordButton())

    // The save stands — a typo is the likeliest cause and only the buyer can
    // fix it — but it must not be reported as a success.
    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(toast.mock.calls[0][0]).toMatch(/not found in odoo/i)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("distinguishes an unreachable Odoo from a rejected number", async () => {
    const toast = (await import("react-hot-toast")).default
    const user = userEvent.setup()
    purchasingService.resolveRequest.mockResolvedValue({
      id: "req-1",
      opportunity_id: "opp-1",
      po_number: "P01234",
      verification: "PENDING_VERIFICATION",
    })
    await renderPanel([request()])

    await chooseOutcome(user, "Purchased")
    await user.type(screen.getByRole("textbox", { name: "PO Number" }), "P01234")
    await user.click(recordButton())

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(toast.success.mock.calls[0][0]).toMatch(/unreachable/i)
  })

  it("surfaces a rejected PO format instead of failing silently", async () => {
    const toast = (await import("react-hot-toast")).default
    const user = userEvent.setup()
    purchasingService.resolveRequest.mockRejectedValue(
      new Error('PO Number must be the Odoo purchase order number — "P" followed by digits.'),
    )
    await renderPanel([request()])

    await chooseOutcome(user, "Purchased")
    await user.type(screen.getByRole("textbox", { name: "PO Number" }), "S01237")
    await user.click(recordButton())

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.error.mock.calls[0][0]).toMatch(/"P" followed by digits/)
  })

  it("live checks the PO and auto-populates the official Odoo product name", async () => {
    const user = userEvent.setup()
    await renderPanel([request()])

    await chooseOutcome(user, "Purchased")
    expect(screen.getByText(/will populate automatically upon po verification/i)).toBeInTheDocument()

    await user.type(screen.getByRole("textbox", { name: "PO Number" }), "P01234")

    await waitFor(() => expect(purchasingService.verifyPoNumber).toHaveBeenCalledWith("P01234"))
    await waitFor(() => expect(screen.getByText(/populated from po/i)).toBeInTheDocument())

    expect(screen.getByDisplayValue("[HOSE-01] Hydraulic Hose 5m")).toBeInTheDocument()
  })
})

/**
 * The buyer's view of the deal behind the requisition.
 *
 * A requisition task carries no link back to the SOR of its own — the tie lives
 * on the request rows — so without this the buyer has to ask sales which deal
 * they are sourcing for. The card answers that without a click; the way through
 * to the full record is offered only to someone the register would let edit it.
 */
describe("the deal behind the requisition", () => {
  const SOR = {
    id: "opp-1",
    sales_reference: "S07813",
    client_name: "Bayambang LGU",
    project_title: "Fire truck refurbishment",
    status: "AWARDED",
    expected_value: 2450000,
    registered_by: "99999999-9999-4999-8999-999999999999",
    deal_owner_id: "99999999-9999-4999-8999-999999999999",
    deal_owner: { id: "99999999-9999-4999-8999-999999999999", name: "Rina Lopez" },
  }

  const renderWithSor = (sor, props = {}) => {
    purchasingService.sorForTask.mockResolvedValue(sor)
    return renderPanel([request()], props)
  }

  it("names the deal the buyer is sourcing for", async () => {
    await renderWithSor(SOR)

    expect(await screen.findByText("S07813")).toBeInTheDocument()
    expect(screen.getByText("Bayambang LGU")).toBeInTheDocument()
    expect(screen.getByText(/Rina Lopez/)).toBeInTheDocument()
  })

  it("keeps the full record out of reach of a buyer who could not edit it", async () => {
    await renderWithSor(SOR)

    await screen.findByText("S07813")
    expect(screen.queryByRole("button", { name: /view full sor/i })).not.toBeInTheDocument()
  })

  it("offers the full record to someone the register would let edit it", async () => {
    await renderWithSor(SOR, { user: { id: BUYER_ID, is_head: true } })

    expect(
      await screen.findByRole("button", { name: /view full sor/i }),
    ).toBeInTheDocument()
  })

  it("asks to open the SOR rather than navigating away itself", async () => {
    const opened = vi.fn()
    window.addEventListener("OPEN_ENTITY_DETAILS", opened)
    const user = userEvent.setup()

    await renderWithSor(SOR, { user: { id: SOR.deal_owner_id } })
    await user.click(await screen.findByRole("button", { name: /view full sor/i }))

    expect(opened).toHaveBeenCalled()
    expect(opened.mock.calls[0][0].detail).toEqual({ id: "opp-1", type: "OPPORTUNITY" })
    window.removeEventListener("OPEN_ENTITY_DETAILS", opened)
  })

  it("says nothing on a task that has no SOR behind it", async () => {
    await renderWithSor(null)

    await screen.findByText("Hydraulic hose kit")
    expect(screen.queryByText(/view full sor/i)).not.toBeInTheDocument()
  })
})
