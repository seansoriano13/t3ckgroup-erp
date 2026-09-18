import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, fireEvent } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router"
import FlowVersionPage from "@/pages/flow-versions/[snapshotId]"
import { renderWithProviders } from "@/test/support"
import { salesFlowService } from "@/services/salesFlowService"

// Mock ResizeObserver for React Flow
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("FlowVersionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderPage(snapshotId = "snap-123") {
    return renderWithProviders(
      <MemoryRouter initialEntries={[`/flow-versions/${snapshotId}`]}>
        <Routes>
          <Route path="/flow-versions/:snapshotId" element={<FlowVersionPage />} />
        </Routes>
      </MemoryRouter>
    )
  }

  it("loads snapshot and renders stage nodes with condition and action counts", async () => {
    const mockSnapshot = {
      id: "snap-123",
      version: 1,
      version_minor: 0,
      note: "Baseline locked version",
      created_at: "2026-09-10T10:00:00Z",
      snapshot_data: {
        stages: [
          { id: "s1", name: "Stage One", pos_x: 0, pos_y: 0 },
          { id: "s2", name: "Stage Two", pos_x: 250, pos_y: 0 },
        ],
        edges: [{ id: "e1", from_stage_id: "s1", to_stage_id: "s2" }],
        conditions: [
          { id: "c1", stage_id: "s1", kind: "field", label: "PO date filled in" },
          { id: "c2", stage_id: "s1", kind: "attachment", label: "Notice of Award" },
        ],
        actions: [
          { id: "a1", stage_id: "s1", kind: "create_individual_task", config: { projectTitle: "Prepare bid" } },
        ],
      },
    }

    vi.spyOn(salesFlowService, "getSnapshot").mockResolvedValue(mockSnapshot)

    renderPage("snap-123")

    expect(await screen.findByText("Sales Flow — v1.0")).toBeInTheDocument()
    expect(screen.getByText("“Baseline locked version”")).toBeInTheDocument()
    expect(screen.getByText("Read-only")).toBeInTheDocument()

    // Assert stage nodes exist
    const stageOneElements = screen.getAllByText("Stage One")
    expect(stageOneElements.length).toBeGreaterThan(0)
    expect(screen.getByText("Stage Two")).toBeInTheDocument()

    // Assert condition and action counts are rendered on stage nodes (Gate 2, On entry 1)
    expect(screen.getByText(/Gate.*2/)).toBeInTheDocument()
    expect(screen.getByText(/On entry.*1/)).toBeInTheDocument()
  })

  it("clicking a stage opens the read-only stage panel with snapshot rules and no editing controls", async () => {
    const mockSnapshot = {
      id: "snap-123",
      version: 2,
      version_minor: 1,
      created_at: "2026-09-10T10:00:00Z",
      snapshot_data: {
        stages: [
          { id: "s1", name: "Bidding Stage", bracket_label: "Pre-Award", pos_x: 0, pos_y: 0 },
        ],
        edges: [],
        conditions: [
          {
            id: "c1",
            stage_id: "s1",
            kind: "field",
            label: "PO date filled in",
            is_required: true,
            config: { column: "po_date" },
          },
        ],
        actions: [
          {
            id: "a1",
            stage_id: "s1",
            kind: "create_individual_task",
            config: { projectTitle: "Send Notification" },
          },
        ],
      },
    }

    vi.spyOn(salesFlowService, "getSnapshot").mockResolvedValue(mockSnapshot)

    renderPage("snap-123")

    await screen.findByText("Sales Flow — v2.1")

    // Click the Stage node
    const stageElements = screen.getAllByText("Bidding Stage")
    const stageNode = stageElements[stageElements.length - 1].closest(".react-flow__node")
    fireEvent.click(stageNode)

    // Panel opens in read-only mode showing "Stage · this version"
    expect(await screen.findByText("Stage · this version")).toBeInTheDocument()
    expect(screen.getAllByText("Pre-Award").length).toBe(2) // bracket node + panel header

    // Verifies snapshot condition is displayed — once as its satellite card
    // on the canvas (issue #203, story 33) and once as the panel's own row.
    expect(screen.getAllByText("PO date filled in").length).toBe(2)

    // No editing controls
    expect(screen.queryByLabelText("Stage name")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Add/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Delete Stage/ })).not.toBeInTheDocument()

    // Switch to Actions tab
    fireEvent.click(screen.getByRole("button", { name: /Actions/ }))
    expect((await screen.findAllByText("Send Notification")).length).toBe(2)
  })

  it("handles older snapshots with conditions/actions grouped per stage", async () => {
    const mockSnapshot = {
      id: "snap-legacy",
      version: 1,
      version_minor: 0,
      created_at: "2026-09-10T10:00:00Z",
      snapshot_data: {
        stages: [
          { id: "s1", name: "Legacy Stage", pos_x: 0, pos_y: 0 },
        ],
        edges: [],
        // Older format: object keyed by stage_id
        conditions: {
          s1: [{ id: "c1", stage_id: "s1", kind: "tickbox", label: "Checked legacy box" }],
        },
        actions: {
          s1: [{ id: "a1", stage_id: "s1", kind: "create_individual_task", config: { projectTitle: "Legacy action" } }],
        },
      },
    }

    vi.spyOn(salesFlowService, "getSnapshot").mockResolvedValue(mockSnapshot)

    renderPage("snap-legacy")

    await screen.findByText("Sales Flow — v1.0")

    // Node counts should correctly show 1 condition and 1 action
    expect(screen.getByText(/Gate.*1/)).toBeInTheDocument()
    expect(screen.getByText(/On entry.*1/)).toBeInTheDocument()

    // Click node and verify panel reads the grouped data
    const stageElements = screen.getAllByText("Legacy Stage")
    fireEvent.click(stageElements[stageElements.length - 1].closest(".react-flow__node"))

    // Once as the satellite card, once as the panel's own row.
    expect((await screen.findAllByText("Checked legacy box")).length).toBe(2)
  })

  it("states plainly when a version saved no rules at all", async () => {
    const mockSnapshot = {
      id: "snap-empty-rules",
      version: 1,
      version_minor: 0,
      created_at: "2026-09-10T10:00:00Z",
      snapshot_data: {
        stages: [
          { id: "s1", name: "Government Stage", pos_x: 0, pos_y: 0 },
        ],
        edges: [],
        conditions: [],
        actions: [],
      },
    }

    vi.spyOn(salesFlowService, "getSnapshot").mockResolvedValue(mockSnapshot)

    renderPage("snap-empty-rules")

    await screen.findByText("Sales Flow — v1.0")

    const stageElements = screen.getAllByText("Government Stage")
    fireEvent.click(stageElements[stageElements.length - 1].closest(".react-flow__node"))

    expect(await screen.findByText("This version saved no Stage Conditions or Stage Actions")).toBeInTheDocument()
    expect(screen.getByText("It was locked before any were drawn on the flow.")).toBeInTheDocument()
  })
})
