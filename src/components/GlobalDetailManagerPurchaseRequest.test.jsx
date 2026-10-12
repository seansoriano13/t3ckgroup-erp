/**
 * Issue #309 — a Purchase Request opens as a modal from GlobalDetailManager,
 * stacked over whatever is open, and closing it leaves that untouched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, act } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import { stubRpc } from "@/test/msw/server"
import GlobalDetailManager from "./GlobalDetailManager"

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", name: "Ana" } }) }))
vi.mock("./purchase-request/PurchaseRequestView", () => ({
  default: ({ requestId }) => <div data-testid="pr-view">view of {requestId}</div>,
}))
vi.mock("./sor/OpportunityDetailsModal", () => ({
  default: () => <div data-testid="sor-modal">SOR open</div>,
}))
vi.mock("../services/opportunityService", () => ({
  opportunityService: {
    getOpportunityForModal: vi.fn(async () => ({
      accessLevel: "full",
      opportunity: { id: "opp-1" },
    })),
  },
}))

const open = (id, type) =>
  act(() => {
    window.dispatchEvent(new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id, type } }))
  })

beforeEach(() => {
  stubRpc("purchase_request_queue", () => [
    { id: "pr-1", opportunity_id: "o-1", project_title: "Acme CCTV Rollout", client_name: "Acme Corp", opportunity_no: "SOR-1" },
  ])
})

describe("PURCHASE_REQUEST in GlobalDetailManager", () => {
  it("opens the shared request view as a modal", async () => {
    renderWithProviders(<GlobalDetailManager />)
    open("pr-1", "PURCHASE_REQUEST")

    expect(await screen.findByTestId("pr-view")).toHaveTextContent("view of pr-1")
    expect(await screen.findByText("Acme CCTV Rollout")).toBeInTheDocument()
  })

  it("closing it leaves nothing open", async () => {
    const user = setupUser()
    renderWithProviders(<GlobalDetailManager />)
    open("pr-1", "PURCHASE_REQUEST")
    await screen.findByTestId("pr-view")

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByTestId("pr-view")).not.toBeInTheDocument())
  })

  it("stacks over an open SOR instead of replacing it, and closing returns to the SOR", async () => {
    const user = setupUser()
    renderWithProviders(<GlobalDetailManager />)
    open("opp-1", "OPPORTUNITY")
    await screen.findByTestId("sor-modal")

    open("pr-1", "PURCHASE_REQUEST")
    await screen.findByTestId("pr-view")
    expect(screen.getByTestId("sor-modal")).toBeInTheDocument()

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByTestId("pr-view")).not.toBeInTheDocument())
    expect(screen.getByTestId("sor-modal")).toBeInTheDocument()
  })
})
