import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ReactFlowProvider } from "@xyflow/react"
import FlowSatelliteNode from "./FlowSatelliteNode"
import { renderWithProviders } from "@/test/support"
import { GATE, RUN } from "./flowCanvasLayout"

describe("FlowSatelliteNode", () => {
  const renderSatellite = (dataOverrides = {}) => {
    return renderWithProviders(
      <ReactFlowProvider>
        <FlowSatelliteNode
          data={{
            column: GATE,
            variant: "condition",
            condition: { kind: "approval", label: "Needs HR Review", is_required: true },
            ...dataOverrides,
          }}
          selected={false}
        />
      </ReactFlowProvider>
    )
  }

  it("renders a condition with its title", () => {
    renderSatellite()
    expect(screen.getByText("Needs HR Review")).toBeInTheDocument()
  })

  it("displays the Optional badge for non-required conditions", () => {
    renderSatellite({ condition: { kind: "approval", label: "Optional review", is_required: false } })
    expect(screen.getByText("Optional")).toBeInTheDocument()
  })

  it("colors GATE satellites amber", () => {
    const { container } = renderSatellite({ column: GATE })
    expect(container.querySelector(".bg-amber-a3")).toBeInTheDocument()
  })

  it("colors RUN satellites violet", () => {
    const { container } = renderSatellite({ 
      column: RUN, 
      variant: "action",
      action: { kind: "task", name: "Create Task" }
    })
    expect(container.querySelector(".bg-violet-a3")).toBeInTheDocument()
  })

  it("renders the add slot with a plus icon", () => {
    renderSatellite({ variant: "add", column: GATE, addLabel: "Add Condition" })
    expect(screen.getByText("Add Condition")).toBeInTheDocument()
  })
})
