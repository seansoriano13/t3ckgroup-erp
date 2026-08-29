import { screen, render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import FlowBracketNode from "./FlowBracketNode"

describe("FlowBracketNode", () => {
  it("renders a dashed container holding the label", () => {
    const { container } = render(
      <FlowBracketNode data={{ label: "Pre-Sales", width: 500 }} />
    )
    
    expect(screen.getByText("Pre-Sales")).toBeInTheDocument()
    
    // The main container should receive the width from data
    const outerDiv = container.firstChild
    expect(outerDiv).toHaveStyle({ width: "500px" })
    expect(outerDiv).toHaveClass("pointer-events-none")
  })
})
