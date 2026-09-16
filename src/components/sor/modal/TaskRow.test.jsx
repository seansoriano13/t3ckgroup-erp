import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import TaskRow from "./TaskRow"

describe("TaskRow", () => {
  it("renders its title", () => {
    render(<TaskRow title="Confirm delivery address" />)
    expect(screen.getByText("Confirm delivery address")).toBeInTheDocument()
  })
})
