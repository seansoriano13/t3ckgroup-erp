/**
 * Issue #309 — a Purchase Request opens as a modal from GlobalDetailManager,
 * stacked over whatever is open, and closing it leaves that untouched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, act } from "@testing-library/react"
import { renderWithProviders, setupUser } from "@/test/support"
import { stubRpc } from "@/test/msw/server"
import { MemoryRouter, useLocation } from "react-router"
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
      opportunity: { id: "11111111-1111-4111-8111-111111111111" },
    })),
  },
}))

const Where = () => {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

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
    renderWithProviders(<MemoryRouter><GlobalDetailManager /></MemoryRouter>)
    open("pr-1", "PURCHASE_REQUEST")

    expect(await screen.findByTestId("pr-view")).toHaveTextContent("view of pr-1")
    expect(await screen.findByText("Acme CCTV Rollout")).toBeInTheDocument()
  })

  it("closing it leaves nothing open", async () => {
    const user = setupUser()
    renderWithProviders(<MemoryRouter><GlobalDetailManager /></MemoryRouter>)
    open("pr-1", "PURCHASE_REQUEST")
    await screen.findByTestId("pr-view")

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByTestId("pr-view")).not.toBeInTheDocument())
  })

  it("stacks over an open SOR instead of replacing it, and closing returns to the SOR", async () => {
    const user = setupUser()
    renderWithProviders(<MemoryRouter><GlobalDetailManager /></MemoryRouter>)
    open("11111111-1111-4111-8111-111111111111", "OPPORTUNITY")
    await screen.findByTestId("sor-modal")

    open("pr-1", "PURCHASE_REQUEST")
    await screen.findByTestId("pr-view")
    expect(screen.getByTestId("sor-modal")).toBeInTheDocument()

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByTestId("pr-view")).not.toBeInTheDocument())
    expect(screen.getByTestId("sor-modal")).toBeInTheDocument()
  })

  it("opens from the address and keeps the tab in it (#1019)", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={["/anywhere?open=pr:pr-1&view=chat"]}>
        <GlobalDetailManager />
        <Where />
      </MemoryRouter>,
    )
    expect(await screen.findByTestId("pr-view")).toHaveTextContent("view of pr-1")
  })

  it("writes ?open=pr:<id> when opened from the app, with the tab a notification names", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={["/anywhere"]}>
        <GlobalDetailManager />
        <Where />
      </MemoryRouter>,
    )
    act(() => {
      window.dispatchEvent(new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: "pr-1", type: "PURCHASE_REQUEST", tab: "chat" } }))
    })
    await screen.findByTestId("pr-view")
    expect(screen.getByTestId("where")).toHaveTextContent("/anywhere?open=pr%3Apr-1&view=chat")
  })

  it("rewrites the old ?request= shape to ?open=pr:", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={["/purchasing?request=pr-1&keep=1"]}>
        <GlobalDetailManager />
        <Where />
      </MemoryRouter>,
    )
    act(() => {
      window.dispatchEvent(
        new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: "pr-1", type: "PURCHASE_REQUEST", replace: true, dropParams: ["request"] } }),
      )
    })
    await screen.findByTestId("pr-view")
    const where = screen.getByTestId("where").textContent
    expect(where).toContain("open=pr%3Apr-1")
    expect(where).toContain("keep=1")
    expect(where).not.toContain("request=")
  })

  it("closing a request stacked over an SOR steps back to the SOR's address", async () => {
    const user = setupUser()
    renderWithProviders(
      <MemoryRouter initialEntries={["/sors"]}>
        <GlobalDetailManager />
        <Where />
      </MemoryRouter>,
    )
    open("11111111-1111-4111-8111-111111111111", "OPPORTUNITY")
    await screen.findByTestId("sor-modal")
    const sorAddress = screen.getByTestId("where").textContent
    open("pr-1", "PURCHASE_REQUEST")
    await screen.findByTestId("pr-view")
    expect(screen.getByTestId("where").textContent).toContain("pr%3Apr-1")

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByTestId("pr-view")).not.toBeInTheDocument())
    expect(screen.getByTestId("where")).toHaveTextContent(sorAddress)
    expect(screen.getByTestId("sor-modal")).toBeInTheDocument()
  })
})
