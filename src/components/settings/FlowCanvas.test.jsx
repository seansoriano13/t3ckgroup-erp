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

import { supabase } from "@/lib/supabase"
import { stubLockSalesFlowRpc } from "@/test/stubs/lockFlowRpc"

// Mock ResizeObserver for React Flow
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const mockUser = vi.hoisted(() => ({ current: null }))

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}))
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}))

const channelMock = {
  on: function() { return this; },
  subscribe: function() { return this; },
  unsubscribe: vi.fn(),
  track: vi.fn(),
  send: vi.fn(() => Promise.resolve()),
  presenceState: vi.fn(() => ({})),
  state: "joined"
}

beforeEach(() => {
  vi.spyOn(supabase, "channel").mockReturnValue(channelMock)
  stubLockSalesFlowRpc()
})

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
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)

    renderWithProviders(<FlowCanvas />)

    // Select the Sale Type explicitly to avoid parallel test pollution picking another flow
    await userEvent.click(await screen.findByRole("button", { name: saleType.name }))

    // Wait for the canvas to load nodes
    expect(await screen.findByText("Lead")).toBeInTheDocument()
    expect(screen.getByText("Awarded")).toBeInTheDocument()

    // Check tags inside the nodes
    const leadNode = screen.getByText("Lead").closest(".react-flow__node")
    expect(within(leadNode).getByText("Entry")).toBeInTheDocument()

    const awardedNode = screen.getByText("Awarded").closest(".react-flow__node")
    expect(within(awardedNode).getByText(/Won/)).toBeInTheDocument()
  })

  it("names the handles a move runs between", async () => {
    // React Flow resolves an edge that names no handle to whichever source
    // handle it finds first. A Stage node also carries the two bottom anchors
    // its conditions and actions hang from, so an unnamed output meant every
    // move drew from under the node's bottom-left corner instead of its right
    // edge. Both flow handles are named, and the satellite anchors are not
    // reachable by that name.
    const { saleType, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)

    renderWithProviders(<FlowCanvas />)
    await userEvent.click(await screen.findByRole("button", { name: saleType.name }))

    const leadNode = (await screen.findByText("Lead")).closest(".react-flow__node")

    const out = leadNode.querySelector('[data-handleid="out"]')
    const inn = leadNode.querySelector('[data-handleid="in"]')

    expect(out).not.toBeNull()
    expect(inn).not.toBeNull()
    expect(out).toHaveClass("source")
    expect(inn).toHaveClass("target")

    // The satellite anchors are separate handles, and never the flow's.
    expect(leadNode.querySelector('[data-handleid="gate"]')).not.toBeNull()
    expect(leadNode.querySelector('[data-handleid="run"]')).not.toBeNull()
  })

  it("shows why a flow cannot be locked yet, and disables locking", async () => {
    seedFlow()

    renderWithProviders(<FlowCanvas />)

    expect(
      await screen.findByText("• This flow has no Won Stage — set where the deal is won."),
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
    expect(screen.queryByLabelText("Delete Stage")).not.toBeInTheDocument()
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
