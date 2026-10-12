import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import GradeSelector from "./GradeSelector"

describe("GradeSelector", () => {
  it("keeps the selected grade's own colour on hover instead of the ghost grey", () => {
    render(<GradeSelector grade={2} canEvaluate onSelect={() => {}} />)

    const selected = screen.getByRole("button", { name: "2" })
    expect(selected.className).toContain("hover:bg-orange-500")
    expect(selected.className).toContain("hover:text-white")
    expect(selected.className).not.toContain("hover:bg-background")
  })
})
