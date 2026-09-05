import { screen } from "@testing-library/react"
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
            onDelete: vi.fn(),
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
})
