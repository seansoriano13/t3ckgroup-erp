import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { setupUser } from "@/test/support"

import { FieldBox } from "./FieldBox"
import { Input } from "./input"

describe("FieldBox", () => {
  it("names its control: the caption is the control's accessible name", () => {
    render(
      <FieldBox label="Full name" bare>
        <Input />
      </FieldBox>
    )
    expect(screen.getByRole("textbox", { name: "Full name" })).toBeInTheDocument()
  })

  it("focuses the control when the caption is clicked", async () => {
    const user = setupUser()
    render(
      <FieldBox label="Email" bare>
        <Input type="email" />
      </FieldBox>
    )
    await user.click(screen.getByText("Email"))
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveFocus()
  })

  it("keeps a control's own id and points the label at it", () => {
    render(
      <FieldBox label="Company">
        <input id="company-x" />
      </FieldBox>
    )
    expect(screen.getByText("Company")).toHaveAttribute("for", "company-x")
  })

  it("uses htmlFor when the control is not the direct child", () => {
    render(
      <FieldBox label="Notes" htmlFor="notes-field" bare>
        <div>
          <textarea id="notes-field" />
        </div>
      </FieldBox>
    )
    expect(screen.getByRole("textbox", { name: "Notes" })).toBeInTheDocument()
  })

  it("wraps the control in the bordered box by default, and not when bare", () => {
    const { container, rerender } = render(
      <FieldBox label="A" isEditing>
        <input />
      </FieldBox>
    )
    expect(container.querySelector("[class*='min-h-']")).not.toBeNull()
    rerender(
      <FieldBox label="A" bare>
        <input />
      </FieldBox>
    )
    expect(container.querySelector("[class*='min-h-']")).toBeNull()
  })
})
