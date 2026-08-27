import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import FlowCanvas from "./FlowCanvas"
import { renderWithProviders } from "@/test/support"
import { salesFlowService } from "@/services/salesFlowService"
import {
  makeFlowEdge,
  makeFlowStage,
  makeSaleType,
  makeSalesFlow,
  makeSuperAdmin,
} from "@/test/factories"

/**
 * The Flow Canvas, wired to the real salesFlowService against the fake
 * database — so a query shape real PostgREST would reject fails here too.
 *
 * Issue #36 keeps canvas UI coverage deliberately minimal: the drawing surface
 * is scheduled to be hidden once the flow it produces is implemented, and
 * heavily testing the one genuinely disposable part of the project is spending
 * in the wrong place. So this proves only that the canvas reads and writes
 * configuration. Everything about what a flow MEANS — legal moves, where deals
 * enter, why a flow cannot be locked — is constants/salesFlow.js's job and is
 * tested there against literals.
 *
 * AuthContext is stubbed so the canvas renders as the Super Admin it is gated
 * to; the provider itself is covered in src/context/AuthContext.test.jsx.
 */
const mockUser = vi.hoisted(() => ({ current: null }))

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}))
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}))

/** A Sale Type owning a two-Stage flow. */
function seedFlow() {
  const saleType = makeSaleType({ name: "Government Bidding" })
  const flow = makeSalesFlow({ sale_type_id: saleType.id })
  const lead = makeFlowStage({ flow_id: flow.id, name: "Lead", sort_order: 0 })
  const awarded = makeFlowStage({ flow_id: flow.id, name: "Awarded", sort_order: 1 })
  return { saleType, flow, lead, awarded }
}

describe("FlowCanvas", () => {
  beforeEach(() => {
    mockUser.current = makeSuperAdmin({ name: "Super Admin" })
  })

  it("says the list starts empty rather than proposing Sale Types", async () => {
    renderWithProviders(<FlowCanvas />)

    expect(await screen.findByText("No Sale Types yet")).toBeInTheDocument()
  })

  it("renders a flow's Stages, marking where deals enter and where they are won", async () => {
    const { flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)

    renderWithProviders(<FlowCanvas />)

    const rows = within(await screen.findByRole("list", { name: "Stages" })).getAllByRole("listitem")
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText("Deals enter here")).toBeInTheDocument()
    expect(within(rows[1]).getByText(/Won/)).toBeInTheDocument()
  })

  it("draws a move by ticking a destination", async () => {
    const user = userEvent.setup()
    const { saleType, lead, awarded } = seedFlow()

    renderWithProviders(<FlowCanvas />)

    // Every Stage name appears several times on this screen — as its own
    // heading, as a destination under each other Stage, and in the Won Stage
    // picker. The one being clicked is the destination inside Lead's own row.
    const [leadRow] = within(await screen.findByRole("list", { name: "Stages" })).getAllByRole(
      "listitem",
    )
    await user.click(within(leadRow).getByRole("button", { name: "Awarded" }))

    await waitFor(async () => {
      const { edges } = await salesFlowService.getFlow(saleType.id)
      expect(edges).toMatchObject([{ from_stage_id: lead.id, to_stage_id: awarded.id }])
    })
  })

  it("shows why a flow cannot be locked yet, and disables locking", async () => {
    seedFlow()

    renderWithProviders(<FlowCanvas />)

    expect(
      await screen.findByText("This flow has no Won Stage — set where the deal is won."),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Lock this flow/ })).toBeDisabled()
  })

  it("hides every edit control once the flow is locked", async () => {
    const { flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id)

    renderWithProviders(<FlowCanvas />)

    expect(await screen.findByRole("button", { name: /Unlock/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Add Stage/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Move up" })).not.toBeInTheDocument()
  })

  it("adds a Stage the Operations Manager names herself", async () => {
    const user = userEvent.setup()
    const { saleType } = seedFlow()

    renderWithProviders(<FlowCanvas />)

    await user.type(await screen.findByPlaceholderText(/Name a Stage/), "Post-Qualification")
    await user.click(screen.getByRole("button", { name: /Add Stage/ }))

    await waitFor(async () => {
      const { stages } = await salesFlowService.getFlow(saleType.id)
      expect(stages.map((s) => s.name)).toContain("Post-Qualification")
    })
  })
})
