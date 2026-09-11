import { fireEvent, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import FlowMoveEdge from "./FlowMoveEdge"
import { ReactFlowProvider } from "@xyflow/react"
import { renderWithProviders } from "@/test/support"

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    EdgeLabelRenderer: ({ children }) => <div data-testid="edge-label-renderer">{children}</div>,
    getBezierPath: () => ["M 0 0 L 100 100", 50, 50, 0, 0]
  }
})

describe("FlowMoveEdge", () => {
  const renderEdge = (dataOverrides = {}, edgeOverrides = {}) => {
    return renderWithProviders(
      <svg>
        <FlowMoveEdge
          id="edge-1"
          sourceX={0}
          sourceY={0}
          targetX={100}
          targetY={100}
          sourcePosition="bottom"
          targetPosition="top"
          data={{
            fromName: "Lead",
            toName: "Qualification",
            disabled: false,
            canInsertStage: true,
            onDelete: vi.fn(),
            onInsertStage: vi.fn(),
            ...dataOverrides
          }}
          {...edgeOverrides}
        />
      </svg>
    )
  }

  it("renders a transparent interaction path that receives hover events", () => {
    const { container } = renderEdge()
    const interactionPath = container.querySelector('path[stroke="transparent"]')
    expect(interactionPath).toBeInTheDocument()
    expect(interactionPath).toHaveAttribute("stroke", "transparent")
  })

  it("shows the delete button with a specific label containing the stage names", () => {
    renderEdge()
    // It's invisible initially, but it exists in the DOM.
    expect(screen.getByRole("button", { name: /Delete the move from Lead to Qualification/ })).toBeInTheDocument()
  })

  it("triggers onDelete when the delete button is clicked", async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderEdge({ onDelete }, { selected: true })

    const btn = screen.getByRole("button", { name: /Delete the move/ })
    await user.click(btn)

    expect(onDelete).toHaveBeenCalledWith("edge-1")
  })

  it("hides the delete button completely when disabled (e.g. locked flow)", () => {
    renderEdge({ disabled: true })
    expect(screen.queryByRole("button", { name: /Delete the move/ })).not.toBeInTheDocument()
  })

  it("shows a midpoint insert button labelled with both Stage names (issue #196)", () => {
    renderEdge()
    expect(
      screen.getByRole("button", { name: "Insert a Stage between Lead and Qualification" }),
    ).toBeInTheDocument()
  })

  it("hides the insert button when the flow can't be edited (locked or viewing a version)", () => {
    renderEdge({ canInsertStage: false })
    expect(screen.queryByRole("button", { name: /Insert a Stage/ })).not.toBeInTheDocument()
    // The delete button is unaffected by canInsertStage — it has its own gate.
    expect(screen.getByRole("button", { name: /Delete the move/ })).toBeInTheDocument()
  })

  it("opens the name popover and submits the new Stage's name to onInsertStage", async () => {
    const user = userEvent.setup()
    const onInsertStage = vi.fn().mockResolvedValue()
    renderEdge({ onInsertStage })

    // The trigger sits at opacity-0/pointer-events:none until hover or
    // selection — real for a mouse, invisible to jsdom's CSS engine, so it's
    // clicked directly rather than through a hover-then-click sequence.
    fireEvent.click(screen.getByRole("button", { name: "Insert a Stage between Lead and Qualification" }))
    await user.type(await screen.findByPlaceholderText(/Name a Stage/), "Qualified")
    await user.click(screen.getByRole("button", { name: "Add" }))

    expect(onInsertStage).toHaveBeenCalledWith("Qualified")
  })
})
