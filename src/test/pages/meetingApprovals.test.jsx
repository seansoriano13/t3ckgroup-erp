import { screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router"

import MeetingApprovalsPage from "@/pages/approvals/meetings/index.jsx"
import { meetingRequestService } from "@/services/meetingRequestService"
import { renderWithProviders, setupUser } from "@/test/support"

/**
 * #624: the Meeting Requests queue. A head sees only what is routed to them (the service filters by
 * head_id; the page shows what it is given), HR and Super Admins get the override on a pending-head
 * request, and the tab count matches the rows.
 */

vi.mock("@/components/ProtectedRoute", () => ({ default: ({ children }) => children }))
vi.mock("@/services/meetingRequestService", async (orig) => {
  const actual = await orig()
  return { ...actual, meetingRequestService: { ...actual.meetingRequestService, decide: vi.fn(async () => ({})), overrideHead: vi.fn(async () => ({})) } }
})

const request = (id, status, name) => ({
  id,
  status,
  purpose: `Purpose ${id}`,
  applicant_id: `a-${id}`,
  created_at: new Date().toISOString(),
  starts_at: "2031-03-10T01:00:00.000Z",
  ends_at: "2031-03-10T02:00:00.000Z",
  guests: ["Mr. Visitor"],
  hr_override: false,
  venue: { id: "v", name: "Conference Room" },
  facilitator: { id: "f", name: "Fay Facilitator" },
  participants: [{ employee_id: "p", employee: { id: "p", name: "Pat Cruz" } }],
  applicant: { id: `a-${id}`, name, department: "SALES" },
  events: [],
})

let roles
let pending
vi.mock("@/pages/approvals/_components/useApprovalQueues", async (orig) => {
  const actual = await orig()
  return {
    ...actual,
    useApprovalQueues: () => ({
      roles,
      meetingsPending: pending,
      isLoadingMeetings: false,
      isErrorMeetings: false,
      refetchMeetings: vi.fn(),
    }),
  }
})

const renderOpen = (id) =>
  renderWithProviders(
    <MemoryRouter initialEntries={[id ? `/approvals/meetings?record=${id}` : "/approvals/meetings"]}>
      <MeetingApprovalsPage />
    </MemoryRouter>,
  )

describe("Meeting Requests queue", () => {
  beforeEach(() => vi.clearAllMocks())

  it("a head sees the requests routed to them, and the count matches the rows", async () => {
    roles = { user: { id: "head-1" }, isHead: true, isHr: false, isSuperAdmin: false }
    pending = [request("m1", "PENDING_HEAD", "Ana Cruz"), request("m2", "PENDING_HEAD", "Ben Diaz")]
    renderOpen()

    expect(await screen.findByText("Ana Cruz")).toBeTruthy()
    expect(screen.getByText("Ben Diaz")).toBeTruthy()
    expect(screen.getAllByRole("button", { name: /^Approve / })).toHaveLength(2)
    expect(screen.getByText("2")).toBeTruthy()
  })

  it("HR sees the pending-HR request and the override on a pending-head one", async () => {
    roles = { user: { id: "hr-1" }, isHead: false, isHr: true, isSuperAdmin: false }
    pending = [request("m1", "PENDING_HEAD", "Ana Cruz"), request("m2", "PENDING_HR", "Ben Diaz")]
    renderOpen("m1")

    expect(await screen.findByRole("button", { name: /Skip the head step/ })).toBeTruthy()
    expect(screen.getByText("Conference Room")).toBeTruthy()
    expect(screen.getByText("Fay Facilitator")).toBeTruthy()
    expect(screen.getByText("Pat Cruz")).toBeTruthy()
    expect(screen.getByText("Mr. Visitor")).toBeTruthy()
  })

  it("offers no override at the HR step, and none to a head", async () => {
    roles = { user: { id: "hr-1" }, isHead: false, isHr: true, isSuperAdmin: false }
    pending = [request("m2", "PENDING_HR", "Ben Diaz")]
    const { unmount } = renderOpen("m2")
    expect(await screen.findByRole("button", { name: /^Approve$/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Skip the head step/ })).toBeNull()
    unmount()

    roles = { user: { id: "head-1" }, isHead: true, isHr: false, isSuperAdmin: false }
    pending = [request("m1", "PENDING_HEAD", "Ana Cruz")]
    renderOpen("m1")
    expect(await screen.findByRole("button", { name: /^Approve$/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Skip the head step/ })).toBeNull()
  })

  it("keeps decline and return disabled until a note is written, and approves without one", async () => {
    const user = setupUser()
    roles = { user: { id: "head-1" }, isHead: true, isHr: false, isSuperAdmin: false }
    pending = [request("m1", "PENDING_HEAD", "Ana Cruz")]
    renderOpen("m1")

    expect((await screen.findByRole("button", { name: /^Decline$/ })).disabled).toBe(true)
    expect(screen.getByRole("button", { name: /^Return$/ }).disabled).toBe(true)
    await user.click(screen.getByRole("button", { name: /^Approve$/ }))
    expect(meetingRequestService.decide).toHaveBeenCalledWith(expect.objectContaining({ requestId: "m1", decision: "APPROVE" }))
  })
})
