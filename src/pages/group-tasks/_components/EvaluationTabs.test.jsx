import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import EvaluationTabs from "./EvaluationTabs"

describe("EvaluationTabs", () => {
  it("shows how many tasks wait for the signed-in person to rate", () => {
    render(<EvaluationTabs statusFilter="ALL" count={3} onChange={() => {}} />)

    expect(screen.getByRole("tab", { name: /To evaluate/ })).toHaveTextContent("3")
  })

  it("shows no number when nothing waits", () => {
    render(<EvaluationTabs statusFilter="ALL" count={0} onChange={() => {}} />)

    expect(screen.getByRole("tab", { name: /To evaluate/ })).not.toHaveTextContent("0")
  })

  it("opens the waiting tasks, and goes back to all of them", () => {
    const onChange = vi.fn()
    const { rerender } = render(<EvaluationTabs statusFilter="ALL" count={1} onChange={onChange} />)

    fireEvent.click(screen.getByRole("tab", { name: /To evaluate/ }))
    expect(onChange).toHaveBeenLastCalledWith("AWAITING_EVALUATION")

    rerender(<EvaluationTabs statusFilter="AWAITING_EVALUATION" count={1} onChange={onChange} />)
    expect(screen.getByRole("tab", { name: /To evaluate/ })).toHaveAttribute("aria-selected", "true")

    fireEvent.click(screen.getByRole("tab", { name: "All group tasks" }))
    expect(onChange).toHaveBeenLastCalledWith("ALL")
  })
})
