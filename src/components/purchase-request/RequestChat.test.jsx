/**
 * The request's Chat (#307) on screen, against the fake database. What a
 * member and a reader see and do; who may post, and who is notified, are the
 * policy tier's (41-purchase-request-chat-and-buyer).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import RequestChat from "./RequestChat"

let authUser
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

let salesperson, buyer, request

beforeEach(() => {
  salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  buyer = makeEmployee({ name: "Ben Cruz", department: "OPERATIONS", has_purchasing_flow: true })
  const opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
  request = db.seed("purchase_requests", { opportunity_id: opportunity.id, created_by: salesperson.id })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: buyer.id, side: "purchasing" })
  db.seed("purchase_request_messages", {
    request_id: request.id,
    author_id: salesperson.id,
    content: "Purchase Request opened.",
    metadata: { event: "opened" },
    created_at: "2026-10-01T00:00:00Z",
  })
})

describe("a member", () => {
  beforeEach(() => {
    authUser = { id: salesperson.id, name: "Ana Reyes" }
  })

  it("reads the thread, events included", async () => {
    renderWithProviders(<RequestChat request={request} />)
    expect(await screen.findByText("Purchase Request opened.")).toBeInTheDocument()
    expect(screen.getByText("2 members")).toBeInTheDocument()
  })

  it("posts a message mentioning another member", async () => {
    const user = setupUser()
    renderWithProviders(<RequestChat request={request} />)
    await screen.findByText("Purchase Request opened.")

    const box = screen.getByPlaceholderText(/Message the request/)
    await user.type(box, "@Ben")
    await user.click(await screen.findByText("Ben Cruz"))
    await user.type(box, "can you quote this?")
    await user.click(screen.getByRole("button", { name: /Send/ }))

    await waitFor(() =>
      expect(db.rows("purchase_request_messages").at(-1)).toMatchObject({
        author_id: salesperson.id,
        content: "@Ben Cruz can you quote this?",
        metadata: { mentions: [{ id: buyer.id, name: "Ben Cruz" }] },
      }),
    )
    expect(await screen.findByText("can you quote this?", { exact: false })).toBeInTheDocument()
    expect(box).toHaveValue("")
  })
})

describe("a reader who isn't a member", () => {
  it("reads but can't post", async () => {
    const other = makeEmployee({ name: "Cy Lim", department: "OPERATIONS", has_purchasing_flow: true })
    authUser = { id: other.id, name: "Cy Lim", has_purchasing_flow: true }
    renderWithProviders(<RequestChat request={request} />)

    expect(await screen.findByText("Purchase Request opened.")).toBeInTheDocument()
    expect(await screen.findByText(/Only the request's members can post/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Message the request/)).not.toBeInTheDocument()
  })
})
