import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import FlowCanvas from "./FlowCanvas"
import { renderWithProviders, setupUser } from "@/test/support"
import { salesFlowService } from "@/services/salesFlowService"
import {
  makeFlowEdge,
  makeFlowStage,
  makeOpportunity,
  makeSaleType,
  makeSalesFlow,
  makeStageCondition,
  makeStageField,
  makeSuperAdmin,
} from "@/test/factories"

import { supabase } from "@/lib/supabase"
import { stubLockSalesFlowRpc } from "@/test/stubs/lockFlowRpc"
import { stubRestoreFlowSnapshotRpc } from "@/test/stubs/restoreFlowSnapshotRpc"
import { moveOpportunitiesToFlowSnapshot } from "@/test/stubs/moveOpportunitiesToSnapshotRpc"
import { stubRpc } from "@/test/msw/server"
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
    await setupUser().click(await screen.findByRole("button", { name: saleType.name }))

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
    await setupUser().click(await screen.findByRole("button", { name: saleType.name }))

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
    const user = setupUser()
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
    const user = setupUser()
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
    const user = setupUser()
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

    await user.click(screen.getByRole("button", { name: "Move deals" }))
    expect(await screen.findByText("Deals moved")).toBeInTheDocument()
    expect(screen.getByText("1 moved successfully.")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Done" }))
    expect(screen.queryByText("Deals moved")).not.toBeInTheDocument()
  })

  it("shows how far the move has got, and cannot be dismissed until it finishes", async () => {
    const user = setupUser()
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id) // v1.0
    const [v1] = await salesFlowService.listSnapshots(flow.id)
    for (let i = 0; i < 2; i += 1) {
      makeOpportunity({
        registered_by: mockUser.current.id,
        sale_type_id: saleType.id,
        flow_snapshot_id: v1.id,
        flow_stage_id: lead.id,
      })
    }
    await salesFlowService.unlockFlow(flow.id, "One more pass", mockUser.current.id)
    await salesFlowService.renameStage(awarded.id, "Won", mockUser.current.id)

    // Hold the database call open so the dialog can be read mid-move.
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    stubRpc("move_opportunities_to_flow_snapshot", async (args) => {
      await gate
      return moveOpportunitiesToFlowSnapshot(args)
    })

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: saleType.name }))
    await waitFor(() => expect(screen.getAllByText("Won").length).toBeGreaterThan(0))
    await user.click(await screen.findByRole("button", { name: /Publish v1\.1/ }))
    await screen.findByText("Changes since the latest version")
    await user.click(screen.getByRole("button", { name: "Publish" }))
    await user.click(await screen.findByRole("button", { name: "Move deals" }))

    expect(await screen.findByText("Moving 2 SORs to v1.1")).toBeInTheDocument()
    expect(screen.getByText("Moved 0 of 2")).toBeInTheDocument()
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0")
    expect(screen.getByText(/Keep this page open/)).toBeInTheDocument()

    // Escape must not dismiss it — closing would hide the only sign the move is running.
    await user.keyboard("{Escape}")
    expect(screen.getByText("Moving 2 SORs to v1.1")).toBeInTheDocument()

    release()
    expect(await screen.findByText("Deals moved")).toBeInTheDocument()
    expect(screen.getByText("2 moved successfully.")).toBeInTheDocument()
    expect(screen.queryByText("Moving 2 SORs to v1.1")).not.toBeInTheDocument()
  })

  it("does not offer to move deals after a major publish", async () => {
    const user = setupUser()
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
    const user = setupUser()
    const { saleType } = seedFlow()

    renderWithProviders(<FlowCanvas />)

    await user.click(await screen.findByRole("button", { name: "Add Stage" }))
    await user.type(await screen.findByPlaceholderText(/Name a Stage/), "Post-Qualification")
    await user.click(screen.getByRole("button", { name: "Add" }))

    await waitFor(async () => {
      const { stages } = await salesFlowService.getFlow(saleType.id)
      expect(stages.map((s) => s.name)).toContain("Post-Qualification")
    })
  })

  it("keeps the popover open with an inline error for a blank or duplicate Stage name", async () => {
    const user = setupUser()
    seedFlow()

    renderWithProviders(<FlowCanvas />)

    await user.click(await screen.findByRole("button", { name: "Add Stage" }))
    await user.click(screen.getByRole("button", { name: "Add" }))
    expect(await screen.findByText("A Stage needs a name.")).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/Name a Stage/), "Lead")
    await user.click(screen.getByRole("button", { name: "Add" }))
    expect(await screen.findByText(/already a Stage called "Lead"/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Name a Stage/)).toBeInTheDocument()
  })

  it("adds the next Stage and its move from a Stage's own outgoing plus", async () => {
    const user = setupUser()
    const { saleType, lead } = seedFlow()

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: saleType.name }))

    // React Flow nodes stay `visibility: hidden` until measured (jsdom never
    // fires the mocked ResizeObserver), which hides their contents from the
    // accessibility tree without hiding them from the DOM — so the plus is
    // found and clicked directly rather than through `getByRole`, the same
    // reason node clicks elsewhere in this file use `fireEvent` (see below).
    const leadNode = (await screen.findByText("Lead")).closest(".react-flow__node")
    fireEvent.click(within(leadNode).getByLabelText(`Add Stage after ${lead.name}`))
    await user.type(await screen.findByPlaceholderText(/Name a Stage/), "Qualified")
    await user.click(screen.getByRole("button", { name: "Add" }))

    await waitFor(async () => {
      const { stages, edges } = await salesFlowService.getFlow(saleType.id)
      const qualified = stages.find((s) => s.name === "Qualified")
      expect(qualified).toBeTruthy()
      expect(edges.some((e) => e.from_stage_id === lead.id && e.to_stage_id === qualified.id)).toBe(true)
    })
  })

  it("points to the canvas plus when the flow is empty and removes the docked input box", async () => {
    const user = setupUser()
    const saleType = makeSaleType({ name: "Direct Sale" })
    makeSalesFlow({ sale_type_id: saleType.id })

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: "Direct Sale" }))

    expect(await screen.findByText("No Stages yet")).toBeInTheDocument()
    expect(screen.getByText(/Use the plus in the corner to name your first Stage/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add Stage" })).toBeInTheDocument()
    // Docked input box is gone
    expect(screen.queryByPlaceholderText(/Name a Stage in your own words/)).not.toBeInTheDocument()
  })

  it("hides all plus buttons while the Sales Flow is published", async () => {
    const user = setupUser()
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id) // published

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: saleType.name }))

    // Canvas-level plus is hidden
    expect(screen.queryByRole("button", { name: "Add Stage" })).not.toBeInTheDocument()
    // Stage-level plusses are hidden
    expect(screen.queryByLabelText(/Add Stage after/)).not.toBeInTheDocument()
  })

  it("locks the canvas and editing controls when the flow is locked", async () => {
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id)

    renderWithProviders(<FlowCanvas />)
    await setupUser().click(await screen.findByRole("button", { name: saleType.name }))
    await screen.findByText("Lead")

    expect(screen.getByRole("button", { name: /Edit draft/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Tidy layout/ })).toBeDisabled()
    expect(screen.queryByRole("button", { name: /Add Stage/ })).not.toBeInTheDocument()
  })

  // ── Version viewing and restore (issue #193) ─────────────────────────────

  it("draws a clicked version read-only under a banner, with no editing controls, and returns to the draft", async () => {
    const user = setupUser()
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
    const user = setupUser()
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

  // Code review of #203 (0eceec9): the version viewer only showed
  // "Gate · N"/"On entry · N" counts, not the condition/action satellite
  // cards the live canvas draws — story 33 asks to "read its rules at a
  // glance", which a bare count doesn't give.
  it("draws a version's conditions as satellite cards, and clicking one opens the panel on that tab", async () => {
    const user = setupUser()
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    makeStageCondition({
      stage_id: lead.id,
      kind: "tickbox",
      label: "Confirm receipt",
    })
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id) // v1.0

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: saleType.name }))
    await user.click(await screen.findByText("v1.0"))
    await screen.findByText("Viewing v1.0 — read-only")

    const satellite = await screen.findByText("Confirm receipt")
    const satelliteNode = satellite.closest(".react-flow__node")
    fireEvent.click(satelliteNode)

    expect(await screen.findByText("Stage · this version")).toBeInTheDocument()
    // The panel opened on Conditions, not Actions or General — the condition
    // row it lists repeats the satellite's own label.
    expect(screen.getAllByText("Confirm receipt")).toHaveLength(2)
    expect(screen.queryByText("This version saved no Stage Conditions on this Stage.")).not.toBeInTheDocument()
    // The clicked satellite itself carries React Flow's own selected class —
    // it isn't left looking like every other unclicked card.
    expect(satelliteNode).toHaveClass("selected")
  })

  // A Stage's fields used to be readable only inside its settings panel, so a
  // Stage with customised fields looked identical to one with none.
  it("draws a Stage's fields as satellite cards, and clicking one opens the panel on the Fields tab", async () => {
    const user = setupUser()
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    makeStageField({ stage_id: lead.id, label: "Bid bond number", source: "custom", field_type: "text", is_required: true })
    makeStageField({
      stage_id: lead.id,
      label: "Retired field",
      source: "custom",
      field_type: "text",
      archived_at: "2026-01-01T00:00:00.000Z",
    })
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: saleType.name }))

    const satellite = await screen.findByText("Bid bond number")
    // Archived fields are not part of the Stage any more.
    expect(screen.queryByText("Retired field")).not.toBeInTheDocument()
    // A required field says it blocks leaving — without being counted as a Gate condition.
    expect(screen.getByText("Text · blocks leaving")).toBeInTheDocument()
    expect(screen.getByText(/Fields · 1/)).toBeInTheDocument()

    fireEvent.click(satellite.closest(".react-flow__node"))

    // The Fields tab lists the same field again, in the panel.
    await waitFor(() => expect(screen.getAllByText("Bid bond number").length).toBeGreaterThan(1))
  })

  it("keeps a dimmed Fields count on a Stage that has none, so 'no fields' is visible", async () => {
    const user = setupUser()
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: saleType.name }))

    expect((await screen.findAllByText(/Fields · 0/)).length).toBe(2)
  })

  it("disables Restore on a published Sales Flow, hinting to edit the draft first", async () => {
    const user = setupUser()
    const { saleType, flow, lead, awarded } = seedFlow()
    makeFlowEdge(lead, awarded)
    await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)
    await salesFlowService.lockFlow(flow.id, mockUser.current.id) // v1.0, stays locked/published

    renderWithProviders(<FlowCanvas />)
    await user.click(await screen.findByRole("button", { name: saleType.name }))
    await user.click(await screen.findByText("v1.0"))

    const restoreButton = await screen.findByRole("button", { name: /Revert to this version|Restore into draft/i })
    expect(restoreButton).toBeDisabled()
  })

  it("restores a version into the draft after confirming, from the banner", async () => {
    const user = setupUser()
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

    await user.click(screen.getByRole("button", { name: /Revert to this version|Restore into draft/i }))
    await screen.findByText(/Revert to v1\.0\?|Restore v1\.0\?/)
    await user.click(screen.getByRole("button", { name: /Revert|Restore/i }))

    await waitFor(async () => {
      const stages = (await salesFlowService.getFlow(saleType.id)).stages
      expect(stages.map((s) => s.name).sort()).toEqual(["Awarded", "Lead"])
    })
    // Back on the (now restored) draft, not still pinned to the viewed version.
    expect(screen.queryByText("Viewing v1.0 — read-only")).not.toBeInTheDocument()
  })

  it("shows the refusal naming the Stage and SOR count when restore is blocked", async () => {
    const errorToast = vi.spyOn(toast, "error").mockImplementation(() => "id")
    const user = setupUser()
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

    await user.click(screen.getByRole("button", { name: /Revert to this version|Restore into draft/i }))
    await screen.findByText(/Revert to v1\.0\?|Restore v1\.0\?/)
    await user.click(screen.getByRole("button", { name: /Revert|Restore/i }))

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

  describe("archived Sale Types in the picker (issue #194)", () => {
    it("hides the archived section when there are none", async () => {
      seedFlow()
      renderWithProviders(<FlowCanvas />)
      await setupUser().click(await screen.findByRole("button", { name: "Government Bidding" }))
      expect(screen.queryByText(/Show archived/)).not.toBeInTheDocument()
    })

    it("lists archived Sale Types collapsed under a count, and expands on click", async () => {
      const { saleType } = seedFlow()
      const archived = makeSaleType({ name: "Retired Program", archived_at: new Date().toISOString() })
      makeSalesFlow({ sale_type_id: archived.id })

      renderWithProviders(<FlowCanvas />)
      await setupUser().click(await screen.findByRole("button", { name: saleType.name }))

      expect(await screen.findByText("Show archived (1)")).toBeInTheDocument()
      expect(screen.queryByText("Retired Program")).not.toBeInTheDocument()

      await setupUser().click(screen.getByText("Show archived (1)"))
      expect(await screen.findByText(/Retired Program/)).toBeInTheDocument()
    })

    it("opens an archived Sale Type from the collapsed section and marks the canvas archived", async () => {
      const { saleType } = seedFlow()
      const archived = makeSaleType({ name: "Retired Program", archived_at: new Date().toISOString() })
      const archivedFlow = makeSalesFlow({ sale_type_id: archived.id })
      makeFlowStage({ flow_id: archivedFlow.id, name: "Only Stage", sort_order: 0 })

      renderWithProviders(<FlowCanvas />)
      await setupUser().click(await screen.findByRole("button", { name: saleType.name }))
      await setupUser().click(screen.getByText("Show archived (1)"))
      await setupUser().click(screen.getByText(/Retired Program/))

      expect(await screen.findByRole("button", { name: "Retired Program" })).toBeInTheDocument()
      expect(await screen.findByText("Archived")).toBeInTheDocument()
      expect(await screen.findByText("Only Stage")).toBeInTheDocument()
    })

    it("archives and unarchives a Sale Type from the toolbar", async () => {
      const { saleType } = seedFlow()
      const second = makeSaleType({ name: "Zebra Sale" })
      makeSalesFlow({ sale_type_id: second.id })

      const { container } = renderWithProviders(<FlowCanvas />)
      await screen.findByRole("button", { name: saleType.name })

      // Click Archive in toolbar
      const archiveSvg = container.querySelector("svg.lucide-archive")
      expect(archiveSvg).toBeInTheDocument()
      await setupUser().click(archiveSvg.closest("button"))

      // Confirm dialog appears and we confirm
      const confirmDialog = await screen.findByRole("dialog")
      const confirmArchiveBtn = within(confirmDialog).getByRole("button", { name: "Archive" })
      await setupUser().click(confirmArchiveBtn)

      // The active flow now shows Archived badge
      expect(await screen.findByText("Archived")).toBeInTheDocument()

      // The picker separates it: opening the picker shows Zebra Sale as active, and Show archived (1)
      await setupUser().click(await screen.findByRole("button", { name: saleType.name }))
      expect(await screen.findByText("Show archived (1)")).toBeInTheDocument()

      // Restore via the manage dropdown in the toolbar
      await setupUser().click(screen.getByRole("button", { name: "Restore or delete archived Sale Type" }))

      const restoreMenuItem = await screen.findByRole("button", { name: "Restore" })
      await setupUser().click(restoreMenuItem)

      const restoreDialog = await screen.findByRole("dialog")
      const confirmRestoreBtn = within(restoreDialog).getByRole("button", { name: "Restore" })
      await setupUser().click(confirmRestoreBtn)

      // Restored: Archived badge is removed
      await waitFor(() => {
        expect(screen.queryByText("Archived")).not.toBeInTheDocument()
      })

      // In the picker, Show archived is gone
      await setupUser().click(screen.getByRole("button", { name: saleType.name }))
      expect(screen.queryByText(/Show archived/)).not.toBeInTheDocument()
    })
  })
})

