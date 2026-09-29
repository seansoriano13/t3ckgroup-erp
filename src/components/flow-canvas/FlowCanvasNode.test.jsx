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

  // The chip these replace said the word "Access" and named nobody, so a
  // Stage calling eleven people in looked identical to one calling nobody.
  describe("audience strip", () => {
    const AUDIENCE = {
      calledIn: [
        { employeeId: "e1", name: "Maria Daniella C. Duran", calls: [] },
        { employeeId: "e2", name: "Raquel Galacgac", calls: [] },
      ],
      shutOutGroups: [],
      counts: { calledIn: 2, shutOutRoles: 0, shutOutPeople: 0 },
    }

    it("names how many people are called in, and lists them on hover", () => {
      renderNode({ audience: AUDIENCE })
      expect(screen.getByText("2")).toBeInTheDocument()
      expect(screen.getByText("called in")).toBeInTheDocument()
      expect(
        screen.getByRole("button", {
          name: "Called in here: Maria Daniella C. Duran, Raquel Galacgac",
        }),
      ).toBeInTheDocument()
    })

    // A Stage nobody is called into must still answer the question. Showing
    // nothing is what made the whole feature invisible.
    it("says Deal Team only rather than staying blank", () => {
      renderNode({
        audience: { calledIn: [], shutOutGroups: [], counts: { calledIn: 0, shutOutRoles: 0 } },
      })
      expect(screen.getByText("Deal Team only")).toBeInTheDocument()
    })

    it("counts shut-out roles and groups together", () => {
      renderNode({
        audience: {
          calledIn: [],
          shutOutGroups: [{ id: "g1", name: "Purchasing", memberCount: 4 }],
          counts: { calledIn: 0, shutOutRoles: 2, shutOutPeople: 4 },
        },
      })
      expect(screen.getByText("3")).toBeInTheDocument()
    })

    it("gives the View as verdict a reason instead of only dimming", () => {
      renderNode({
        audience: AUDIENCE,
        accessLensState: "hidden",
        viewAsLabel: "Sales Director",
      })
      expect(screen.getByText("No access for Sales Director")).toBeInTheDocument()
      expect(screen.queryByText("called in")).not.toBeInTheDocument()
    })

    it("says when the Stage is what calls the previewed identity in", () => {
      renderNode({
        audience: AUDIENCE,
        accessLensState: "calls-in",
        viewAsLabel: "Raquel Galacgac",
      })
      expect(screen.getByText("Calls Raquel Galacgac in")).toBeInTheDocument()
    })

    it.each([
      ["deal-team", "Deal Team"],
      ["can-edit", "Can view and edit"],
      ["view-only", "Can view, can't edit"],
    ])("says %s explicitly", (accessLensState, text) => {
      renderNode({ audience: AUDIENCE, accessLensState, viewAsLabel: "Someone" })
      expect(screen.getByText(text)).toBeInTheDocument()
    })
  })

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

  it("keeps a dimmed Fields count at zero, so 'no fields' reads differently from 'not built'", () => {
    renderNode()
    const chip = screen.getByText(/Fields.*0/)
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveClass("opacity-60")
  })

  it("shows the Fields count, lit, once a Stage has fields", () => {
    renderNode({ fieldCount: 2 })
    const chip = screen.getByText(/Fields.*2/)
    expect(chip).toHaveClass("bg-blue-a3")
    expect(chip).not.toHaveClass("opacity-60")
  })

  describe("outgoing plus button (issue #195)", () => {
    it("is always visible when the stage has no outgoing move", () => {
      renderNode({ canAddStage: true, hasOutgoing: false })
      const button = screen.getByLabelText("Add Stage after Qualification")
      const wrapper = button.closest(".nodrag")
      expect(wrapper).toHaveClass("opacity-100")
      expect(wrapper).not.toHaveClass("opacity-0")
    })

    it("appears only on hover when the stage already has an outgoing move", () => {
      renderNode({ canAddStage: true, hasOutgoing: true })
      const button = screen.getByLabelText("Add Stage after Qualification")
      const wrapper = button.closest(".nodrag")
      expect(wrapper).toHaveClass("opacity-0")
      expect(wrapper).toHaveClass("group-hover/stage:opacity-100")
    })

    it("never appears on a terminal stage", () => {
      renderNode({
        canAddStage: true,
        hasOutgoing: false,
        stage: makeFlowStage({ name: "Lost", is_terminal: true }),
      })
      expect(screen.queryByLabelText(/Add Stage after/)).not.toBeInTheDocument()
    })

    it("never appears when the flow is published / editing is disabled", () => {
      renderNode({ canAddStage: false, hasOutgoing: false })
      expect(screen.queryByLabelText(/Add Stage after/)).not.toBeInTheDocument()
    })
  })
})
