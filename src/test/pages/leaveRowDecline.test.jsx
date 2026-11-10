import { screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router"

import LeaveApprovalsPage from "@/pages/approvals/leaves/index.jsx"
import { decideHeadApproval } from "@/services/headApprovalService"
import { renderWithProviders, setupUser } from "@/test/support"

/**
 * #512: the leave row's Decline icon only opens the review sheet, where the
 * note is collected. It must not also fire the decision.
 */

vi.mock("@/components/ProtectedRoute", () => ({ default: ({ children }) => children }))
vi.mock("@/services/headApprovalService", () => ({ decideHeadApproval: vi.fn(async () => ({})) }))
vi.mock("@/pages/approvals/_components/useApprovalQueues", async (orig) => {
  const actual = await orig()
  const request = {
    id: 7,
    table: "leaves",
    matchColumn: "id",
    matchValue: 7,
    requestType: "SIL",
    date: "2026-10-01",
    created_at: new Date().toISOString(),
    reason: "Family trip",
    employee: { id: "emp-1", name: "Ana Cruz", department: "IT" },
  }
  return {
    ...actual,
    useApprovalQueues: () => ({
      roles: { user: { id: "head-1" } },
      leavesPending: [request],
      isLoadingLeaves: false,
      isErrorLeaves: false,
      refetchLeaves: vi.fn(),
    }),
  }
})

describe("Leave approvals row Decline", () => {
  it("opens the sheet without recording a decision", async () => {
    const user = setupUser()
    renderWithProviders(<MemoryRouter><LeaveApprovalsPage /></MemoryRouter>)

    await user.click(await screen.findByRole("button", { name: /^Decline Ana Cruz/ }))

    expect(decideHeadApproval).not.toHaveBeenCalled()
  })
})
