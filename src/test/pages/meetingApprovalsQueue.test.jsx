import { screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import MeetingApprovalsPage from "@/pages/approvals/meetings/index.jsx"
import { formatManilaDateTime } from "@/lib/manilaDate.js"
import { supabase } from "@/lib/supabase"
import { db, insertRow } from "@/test/db/store"
import { makeEmployee, makeHrEmployee } from "@/test/factories"
import { stubRpc } from "@/test/msw/server"
import { renderWithProviders, setupUser } from "@/test/support"

/**
 * #1085 (spec #1083, tracker A2-A4): the HR Activities queue against the fake database.
 * A2 the panel's History shows the request's events; A3 deciding the last item gives one toast;
 * A4 the Waiting time follows the last FILED, EDITED or RESENT event and the first filing still shows.
 */

const mockUser = vi.hoisted(() => ({ current: null }))
const toasts = vi.hoisted(() => ({ plain: vi.fn(), success: vi.fn(), error: vi.fn() }))

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser.current, isAuthLoading: false }) }))
vi.mock("@/components/ProtectedRoute", () => ({ default: ({ children }) => children }))
vi.mock("react-hot-toast", () => ({ default: Object.assign((...a) => toasts.plain(...a), { success: toasts.success, error: toasts.error }) }))

const ago = (days) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()

let hr
let applicant
let venue

const file = (purpose, createdAt = new Date().toISOString(), status = "PENDING_HR") => {
  const row = insertRow("meeting_requests", {
    applicant_id: applicant.id,
    venue_id: venue.id,
    starts_at: "2031-03-10T01:00:00.000Z",
    ends_at: "2031-03-10T02:00:00.000Z",
    facilitator_id: applicant.id,
    purpose,
    guests: [],
    status,
    head_id: null,
    created_at: createdAt,
  })
  return row
}
const event = (request, action, createdAt, over = {}) =>
  insertRow("meeting_request_events", { request_id: request.id, actor_id: applicant.id, action, created_at: createdAt, ...over })

const renderQueue = (record) =>
  renderWithProviders(
    <MemoryRouter initialEntries={[record ? `/approvals/meetings?record=${record}` : "/approvals/meetings"]}>
      <MeetingApprovalsPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  hr = makeHrEmployee({ name: "Hana Resources" })
  applicant = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  mockUser.current = hr
  venue = insertRow("calendar_venues", { name: "Conference Room", active: true, sort_order: 1 })
})

describe("HR Activities queue: History (A2)", () => {
  it("shows Filed, Returned and Sent again for a request that was returned and sent again", async () => {
    const request = file("Quarterly planning", ago(5))
    event(request, "FILED", ago(5))
    event(request, "HR_RETURNED", ago(4), { actor_id: hr.id, note: "Add an agenda" })
    event(request, "RESENT", ago(2))
    renderQueue(request.id)

    const history = (await screen.findByText("History")).closest("section") ?? (await screen.findByText("History")).parentElement
    const items = within(history).getAllByRole("listitem")
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^Filed · Ana Reyes/),
      expect.stringMatching(/^Returned · Hana Resources.*"Add an agenda"$/),
      expect.stringMatching(/^Sent again · Ana Reyes/),
    ])
  })
})

describe("HR Activities queue: one toast (A3)", () => {
  const decideLikeTheDatabase = (onDecided) =>
    stubRpc("decide_meeting_request", async (body) => {
      const row = db.rows("meeting_requests").find((r) => r.id === body.p_request_id)
      await supabase.from("meeting_requests").update({ status: "APPROVED" }).eq("id", row.id)
      insertRow("meeting_request_events", { request_id: row.id, actor_id: hr.id, action: "HR_APPROVED", from_status: "PENDING_HR", to_status: "APPROVED" })
      // The live update reaches the page before the answer does: the queue refreshes while the service is still notifying.
      await onDecided()
      return { id: row.id, action: "HR_APPROVED", from_status: "PENDING_HR", to_status: "APPROVED" }
    })

  it("shows only the success toast after deciding the last item, even when the queue refreshes first", async () => {
    const user = setupUser()
    const request = file("Quarterly planning")
    event(request, "FILED", ago(0))
    let view
    decideLikeTheDatabase(async () => {
      await view.client.invalidateQueries({ queryKey: ["meeting-requests"] })
      await new Promise((r) => setTimeout(r, 100))
    })
    view = renderQueue(request.id)

    await user.click(await screen.findByRole("button", { name: /^Approve$/ }))
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Approved."))
    await screen.findByText("Nothing waiting on you right now")
    await new Promise((r) => setTimeout(r, 50))

    expect(toasts.success).toHaveBeenCalledTimes(1)
    expect(toasts.plain).not.toHaveBeenCalled()
  })

  it("still says so for a link to a request someone else decided", async () => {
    const other = file("Already decided", undefined, "APPROVED")
    file("Still waiting")
    renderQueue(other.id)

    await waitFor(() => expect(toasts.plain).toHaveBeenCalledWith("This request is not waiting on you any more."))
    expect(toasts.plain).toHaveBeenCalledTimes(1)
  })
})

describe("HR Activities queue: Waiting time (A4)", () => {
  it("counts from the last Filed, Edited or Sent again event, and the panel still shows the first filing", async () => {
    const request = file("Quarterly planning", ago(10))
    event(request, "FILED", ago(10))
    event(request, "HR_RETURNED", ago(8), { actor_id: hr.id, note: "Add an agenda" })
    event(request, "RESENT", ago(6))
    event(request, "EDITED", ago(3))
    renderQueue(request.id)

    // The row's Waiting column is 3 days (the edit), not 10 (the first filing).
    const row = (await screen.findAllByText("Quarterly planning")).map((el) => el.closest("tr")).find(Boolean)
    expect(within(row).getByText("3d")).toBeTruthy()
    expect(within(row).queryByText("10d")).toBeNull()

    // The panel gives the first filing, not the last.
    const label = await screen.findByText("First filed")
    expect(label.nextElementSibling.textContent).toBe(formatManilaDateTime(ago(10)))
    expect(screen.getByText(/submitted 10 days ago/)).toBeTruthy()
  })

  it("puts the request that last reached HR longest ago first", async () => {
    const edited = file("Edited recently", ago(10))
    event(edited, "FILED", ago(10))
    event(edited, "EDITED", ago(1))
    const steady = file("Filed three days ago", ago(3))
    event(steady, "FILED", ago(3))
    renderQueue()

    await screen.findByText("Edited recently")
    const rows = screen.getAllByRole("row").slice(1)
    expect(rows[0].textContent).toContain("Filed three days ago")
    expect(rows[1].textContent).toContain("Edited recently")
  })
})
