import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import FlowCanvas from "./FlowCanvas"
import { renderWithProviders } from "@/test/support"
import { salesFlowService } from "@/services/salesFlowService"
import {
  makeFlowEdge,
  makeFlowStage,
  makeOpportunity,
  makeSaleType,
  makeSalesFlow,
  makeSuperAdmin,
} from "@/test/factories"

import { supabase } from "@/lib/supabase"
import { stubLockSalesFlowRpc } from "@/test/stubs/lockFlowRpc"
import { stubRestoreFlowSnapshotRpc } from "@/test/stubs/restoreFlowSnapshotRpc"
import toast from "react-hot-toast"

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
  stubRestoreFlowSnapshotRpc()
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

  it("shows why a flow cannot be published yet, and disables the button", async () => {
    seedFlow()

    renderWithProviders(<FlowCanvas />)

    expect(
      await screen.findByText("• This flow has no Won Stage — set where the deal is won."),
    ).toBeInTheDocument()
    // A first publish reads "Publish v1.0" from the database preview, and is
    // still disabled for the existing blockers.
    const publish = await screen.findByRole("button", { name: /Publish v1\.0/ })
    expect(publish).toBeDisabled()
  })

  it("disables Publish in the popover while the draft is unchanged, and shows why", async () => {
    const user = userEvent.setup()
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)

    // Publish once, then reopen the draft without changing anything — the
    // draft the canvas shows is now identical to the latest version.
    await salesFlowService.lockFlow(flow.id, mockUser.current.id)
    await salesFlowService.unlockFlow(flow.id, "Just checking something", mockUser.current.id)

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: saleType.name }))

    await user.click(await screen.findByRole("button", { name: /Publish v1\.1/ }))

    expect(await screen.findByText("Note (optional)")).toBeInTheDocument()
    expect(await screen.findByText(/nothing to publish/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled()
  })

  it("shows a change summary and enables Publish once the draft differs, and the note survives to history", async () => {
    const user = userEvent.setup()
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id)
    await salesFlowService.unlockFlow(flow.id, "One more pass", mockUser.current.id)
    await salesFlowService.renameStage(awarded.id, "Won", mockUser.current.id)

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: saleType.name }))
    await waitFor(() => expect(screen.getAllByText("Won").length).toBeGreaterThan(0))

    await user.click(await screen.findByRole("button", { name: /Publish v1\.1/ }))
    await screen.findByText("Changes since the latest version")
    expect(await screen.findByText(/Changed: Awarded/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Publish" })).not.toBeDisabled()

    await user.type(screen.getByPlaceholderText(/Why this version exists/), "Renamed for clarity.")
    await user.click(screen.getByRole("button", { name: "Publish" }))

    await waitFor(async () => {
      const history = await salesFlowService.listSnapshots(flow.id)
      expect(history[0].note).toBe("Renamed for clarity.")
    })
  })

  it("offers to move deals up after a minor publish, naming how many", async () => {
    const user = userEvent.setup()
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id) // v1.0
    const [v1] = await salesFlowService.listSnapshots(flow.id)

    makeOpportunity({
      registered_by: mockUser.current.id,
      sale_type_id: saleType.id,
      flow_snapshot_id: v1.id,
      flow_stage_id: lead.id,
    })

    await salesFlowService.unlockFlow(flow.id, "One more pass", mockUser.current.id)
    await salesFlowService.renameStage(awarded.id, "Won", mockUser.current.id) // stays v1.x -> minor

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: saleType.name }))
    await waitFor(() => expect(screen.getAllByText("Won").length).toBeGreaterThan(0))

    await user.click(await screen.findByRole("button", { name: /Publish v1\.1/ }))
    await screen.findByText("Changes since the latest version")
    await user.click(screen.getByRole("button", { name: "Publish" }))

    expect(await screen.findByText("Move 1 SOR on 1.x up to v1.1?")).toBeInTheDocument()
  })

  it("does not offer to move deals after a major publish", async () => {
    const user = userEvent.setup()
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id) // v1.0
    const [v1] = await salesFlowService.listSnapshots(flow.id)

    makeOpportunity({
      registered_by: mockUser.current.id,
      sale_type_id: saleType.id,
      flow_snapshot_id: v1.id,
      flow_stage_id: lead.id,
    })

    await salesFlowService.unlockFlow(flow.id, "Rework", mockUser.current.id)
    // Changing the Won Stage forces a major bump (ADR 0020) — no earlier
    // version can be safely assumed to share it.
    await salesFlowService.setWonStage(flow.id, lead.id, mockUser.current.id)

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: saleType.name }))

    await user.click(await screen.findByRole("button", { name: /Publish v2\.0/ }))
    await screen.findByText("Changes since the latest version")
    await user.click(screen.getByRole("button", { name: "Publish" }))

    await waitFor(async () => {
      const history = await salesFlowService.listSnapshots(flow.id)
      expect(history[0].version).toBe(2)
    })
    expect(screen.queryByText(/Move .* SOR.* up to/)).not.toBeInTheDocument()
  })

  it("hides every edit control once the flow is locked", async () => {
    const { flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id)

    renderWithProviders(<FlowCanvas />)

    expect(await screen.findByRole("button", { name: /Edit draft/ })).toBeInTheDocument()
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

  // ── Version viewing and restore (issue #193) ─────────────────────────────

  it("draws a clicked version read-only under a banner, with no editing controls, and returns to the draft", async () => {
    const user = userEvent.setup()
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id) // v1.0
    await salesFlowService.unlockFlow(flow.id, "Back to editing", mockUser.current.id)

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: saleType.name }))
    await user.click(await screen.findByText("v1.0"))

    expect(await screen.findByText("Viewing v1.0 — read-only")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Add Stage/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Publish/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Tidy layout/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Back to draft" }))
    expect(screen.queryByText("Viewing v1.0 — read-only")).not.toBeInTheDocument()
    expect(await screen.findByRole("button", { name: /Add Stage/ })).toBeInTheDocument()
  })

  it("opens a version's Stage read-only when a Stage is clicked while viewing", async () => {
    const user = userEvent.setup()
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id) // v1.0
    await salesFlowService.unlockFlow(flow.id, "Back to editing", mockUser.current.id)

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: saleType.name }))
    await user.click(await screen.findByText("v1.0"))
    await screen.findByText("Viewing v1.0 — read-only")

    // A plain `fireEvent.click` here, not `userEvent.click`: React Flow's pane
    // binds its own d3-zoom mousedown listener, and userEvent's pointerdown/
    // mousedown/mouseup sequence bubbles into it — d3-zoom then reaches for
    // `event.view.document`, which jsdom's synthesized MouseEvent doesn't
    // carry, throwing outside any try/catch this test controls. A bare click
    // event still fires React Flow's own onNodeClick without going through
    // that pointer sequence.
    const leadNodes = screen.getAllByText("Lead")
    fireEvent.click(leadNodes[leadNodes.length - 1].closest(".react-flow__node"))

    expect(await screen.findByText("Stage · this version")).toBeInTheDocument()
  })

  it("disables Restore on a published Sales Flow, hinting to edit the draft first", async () => {
    const user = userEvent.setup()
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id) // v1.0, stays locked/published

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: saleType.name }))
    await user.click(await screen.findByText("v1.0"))

    const restoreButton = await screen.findByRole("button", { name: "Restore into draft" })
    expect(restoreButton).toBeDisabled()
  })

  it("restores a version into the draft after confirming, from the banner", async () => {
    const user = userEvent.setup()
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id) // v1.0
    await salesFlowService.unlockFlow(flow.id, "Adding a stage", mockUser.current.id)
    const negotiation = await salesFlowService.addStage(flow.id, "Negotiation", mockUser.current.id)
    await salesFlowService.addEdge(flow.id, lead.id, negotiation.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id) // v1.1
    await salesFlowService.unlockFlow(flow.id, "About to restore v1.0", mockUser.current.id)

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: saleType.name }))
    await screen.findByText("v1.1")
    await user.click(screen.getByText("v1.0"))
    await screen.findByText("Viewing v1.0 — read-only")

    await user.click(screen.getByRole("button", { name: "Restore into draft" }))
    await screen.findByText("Restore v1.0?")
    await user.click(screen.getByRole("button", { name: "Restore" }))

    await waitFor(async () => {
      const stages = (await salesFlowService.getFlow(saleType.id)).stages
      expect(stages.map((s) => s.name).sort()).toEqual(["Awarded", "Lead"])
    })
    // Back on the (now restored) draft, not still pinned to the viewed version.
    expect(screen.queryByText("Viewing v1.0 — read-only")).not.toBeInTheDocument()
  })

  it("shows the refusal naming the Stage and SOR count when restore is blocked", async () => {
    const errorToast = vi.spyOn(toast, "error").mockImplementation(() => "id")
    const user = userEvent.setup()
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id) // v1.0
    await salesFlowService.unlockFlow(flow.id, "Adding a stage", mockUser.current.id)
    const negotiation = await salesFlowService.addStage(flow.id, "Negotiation", mockUser.current.id)
    await salesFlowService.addEdge(flow.id, lead.id, negotiation.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id) // v1.1
    await salesFlowService.unlockFlow(flow.id, "About to restore v1.0", mockUser.current.id)
    makeOpportunity({ sale_type_id: saleType.id, flow_stage_id: negotiation.id })

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: saleType.name }))
    await screen.findByText("v1.1")
    await user.click(screen.getByText("v1.0"))
    await screen.findByText("Viewing v1.0 — read-only")

    await user.click(screen.getByRole("button", { name: "Restore into draft" }))
    await screen.findByText("Restore v1.0?")
    await user.click(screen.getByRole("button", { name: "Restore" }))

    await waitFor(() => {
      expect(errorToast).toHaveBeenCalledWith(
        expect.stringMatching(/"Negotiation" is referenced by 1 SOR\b/),
      )
    })
    // The refusal changed nothing — still viewing v1.0, draft untouched.
    expect(await screen.findByText("Viewing v1.0 — read-only")).toBeInTheDocument()
    const stages = (await salesFlowService.getFlow(saleType.id)).stages
    expect(stages.map((s) => s.name).sort()).toEqual(["Awarded", "Lead", "Negotiation"])
  })
})
