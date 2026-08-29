import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ReactFlowProvider } from "@xyflow/react"
import FlowCanvasNode from "./FlowCanvasNode"
import { renderWithProviders } from "@/test/support"
import { makeFlowStage } from "@/test/factories"

describe("FlowCanvasNode", () => {
  const renderNode = (dataOverrides = {}) => {
    const stage = makeFlowStage({ name: "Qualification" })
    return renderWithProviders(
      <ReactFlowProvider>
        <FlowCanvasNode
          data={{
            stage,
            isEntry: false,
            isWon: false,
            disabled: false,
            conditionCount: 0,
            actionCount: 0,
            ...dataOverrides,
          }}
        />
      </ReactFlowProvider>
    )
  }

  it("renders the stage name", () => {
    renderNode()
    expect(screen.getByText("Qualification")).toBeInTheDocument()
  })

  it("shows the Entry badge if it is the first stage", () => {
    renderNode({ isEntry: true })
    expect(screen.getByText("Entry")).toBeInTheDocument()
  })

  it("shows the Won badge if it is the won stage", () => {
    renderNode({ isWon: true })
    expect(screen.getByText("Won")).toBeInTheDocument()
  })

  it("shows the Terminal badge if the stage is terminal", () => {
    renderNode({ stage: makeFlowStage({ name: "Lost", is_terminal: true }) })
    expect(screen.getByText("Terminal")).toBeInTheDocument()
  })

  it("renders custom colors from the database", () => {
    const { container } = renderNode({ stage: makeFlowStage({ name: "Custom", color: "amber" }) })
    // The tile should carry the amber color
    const tile = container.querySelector(".bg-amber-a3")
    expect(tile).toBeInTheDocument()
  })

  it("does not show satellite counts if they are zero", () => {
    renderNode()
    expect(screen.queryByText("1")).not.toBeInTheDocument()
  })

  it("shows condition and action counts if they exist", () => {
    renderNode({ conditionCount: 3, actionCount: 5 })
    expect(screen.getByText(/Gate.*3/)).toBeInTheDocument()
    expect(screen.getByText(/On entry.*5/)).toBeInTheDocument()
  })
})
