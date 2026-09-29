import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ReactFlowProvider } from "@xyflow/react"
import FlowSatelliteNode from "./FlowSatelliteNode"
import { renderWithProviders } from "@/test/support"
import { FIELDS, GATE, RUN } from "./flowCanvasLayout"

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

  it("renders a required custom field in blue, saying it blocks leaving", () => {
    const { container } = renderSatellite({
      column: FIELDS,
      variant: "field",
      field: { source: "custom", field_type: "date", label: "Bid opening", is_required: true },
    })
    expect(screen.getByText("Bid opening")).toBeInTheDocument()
    expect(screen.getByText("Date · blocks leaving")).toBeInTheDocument()
    expect(screen.getByText("Required")).toBeInTheDocument()
    expect(container.querySelector(".bg-blue-a3")).toBeInTheDocument()
  })

  it("names the SOR field an SOR-source field writes to, with no Required badge when optional", () => {
    renderSatellite({
      column: FIELDS,
      variant: "field",
      field: { source: "sor", sor_field: "contact_person", label: "Contact", is_required: false },
    })
    expect(screen.getByText("SOR field · Contact Person")).toBeInTheDocument()
    expect(screen.queryByText("Required")).not.toBeInTheDocument()
  })

  it("renders the add slot with a plus icon", () => {
    renderSatellite({ variant: "add", column: GATE, addLabel: "Add Condition" })
    expect(screen.getByText("Add Condition")).toBeInTheDocument()
  })
})
