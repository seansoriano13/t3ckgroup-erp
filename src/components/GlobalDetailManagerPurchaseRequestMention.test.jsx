/**
 * A mention notification opens the Purchase Request as a modal with the cursor
 * already in its Chat, so the reader can answer straight away. The modal's
 * focus trap must not take the cursor back once the thread has loaded.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, act, waitFor } from "@testing-library/react"
import { renderWithProviders } from "@/test/support"
import { db } from "@/test/db/store"
import { stubRpc } from "@/test/msw/server"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { MemoryRouter } from "react-router"
import GlobalDetailManager from "./GlobalDetailManager"

let authUser
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))
vi.mock("./sor/OpportunityDetailsModal", () => ({
  default: () => <div data-testid="sor-modal">SOR open</div>,
}))

let buyer, opportunity, request

beforeEach(() => {
  const salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  buyer = makeEmployee({ name: "Ben Cruz", department: "OPERATIONS", has_purchasing_flow: true })
  opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
  request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: buyer.id, side: "purchasing" })
  db.seed("purchase_request_messages", {
    request_id: request.id,
    author_id: salesperson.id,
    content: "Can you quote this?",
    created_at: "2026-10-01T00:00:00Z",
  })
  authUser = { id: buyer.id, name: "Ben Cruz" }
  stubRpc("purchase_request_queue", () => [{ id: request.id, opportunity_id: opportunity.id, project_title: "Acme CCTV Rollout", client_name: "Acme Corp", opportunity_no: "SOR-1" }])
})

describe("a Purchase Request opened from a mention", () => {
  it("opens with the cursor in the Chat", async () => {
    renderWithProviders(<MemoryRouter><GlobalDetailManager /></MemoryRouter>)
    act(() => {
      window.dispatchEvent(
        new CustomEvent("OPEN_ENTITY_DETAILS", {
          detail: { id: request.id, type: "PURCHASE_REQUEST", focusChat: true },
        }),
      )
    })

    expect(await screen.findByText("Can you quote this?")).toBeInTheDocument()
    expect(await screen.findByPlaceholderText(/Message the request/)).toHaveFocus()
  })

  it("shows a newer mention when its notification is clicked with the request already open", async () => {
    const openFromMention = () =>
      act(() => {
        window.dispatchEvent(
          new CustomEvent("OPEN_ENTITY_DETAILS", {
            detail: { id: request.id, type: "PURCHASE_REQUEST", focusChat: true },
          }),
        )
      })
    renderWithProviders(<MemoryRouter><GlobalDetailManager /></MemoryRouter>)
    openFromMention()
    expect(await screen.findByText("Can you quote this?")).toBeInTheDocument()

    db.seed("purchase_request_messages", {
      request_id: request.id,
      author_id: request.created_by,
      content: "@Ben Cruz any update?",
      metadata: { mentions: [{ id: buyer.id, name: "Ben Cruz" }] },
      created_at: "2026-10-02T00:00:00Z",
    })
    openFromMention()

    const message = (await screen.findByText(/any update\?/)).closest("[data-message-id]")
    await waitFor(() => expect(message).toHaveAttribute("data-highlighted", "true"))
  })
})
