import { useState } from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { setupUser } from "@/test/support"

import { SwitchField, CheckboxField } from "./ToggleField"

function ControlledSwitch(props) {
  const [on, setOn] = useState(false)
  return <SwitchField label="Required to leave" checked={on} onCheckedChange={setOn} {...props} />
}
function ControlledCheckbox(props) {
  const [on, setOn] = useState(true)
  return <CheckboxField label="Head" checked={on} onCheckedChange={setOn} {...props} />
}

describe("SwitchField", () => {
  it("names the switch by its label and toggles when the text is clicked", async () => {
    const user = setupUser()
    render(<ControlledSwitch />)
    const control = screen.getByRole("switch", { name: /Required to leave/ })
    expect(control).not.toBeChecked()
    await user.click(screen.getByText("Required to leave"))
    expect(control).toBeChecked()
  })

  it("shows the description and includes it in the accessible name", () => {
    render(<ControlledSwitch description="Blocks the move until filled in." />)
    expect(screen.getByRole("switch", { name: /Blocks the move until filled in\./ })).toBeInTheDocument()
  })

  it("does not toggle when disabled", async () => {
    const user = setupUser()
    const onCheckedChange = vi.fn()
    render(<SwitchField label="Locked" disabled checked={false} onCheckedChange={onCheckedChange} />)
    await user.click(screen.getByText("Locked"))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it("supports the inline variant, still named by its text", async () => {
    const user = setupUser()
    render(<ControlledSwitch variant="inline" label="Create more" />)
    await user.click(screen.getByText("Create more"))
    expect(screen.getByRole("switch", { name: "Create more" })).toBeChecked()
  })
})

describe("CheckboxField", () => {
  it("names the checkbox by its label and toggles when the text is clicked", async () => {
    const user = setupUser()
    render(<ControlledCheckbox />)
    const box = screen.getByRole("checkbox", { name: "Head" })
    expect(box).toBeChecked()
    await user.click(screen.getByText("Head"))
    expect(box).not.toBeChecked()
  })

  it("does not toggle when disabled", async () => {
    const user = setupUser()
    const onCheckedChange = vi.fn()
    render(<CheckboxField label="Head" disabled checked onCheckedChange={onCheckedChange} />)
    await user.click(screen.getByText("Head"))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
