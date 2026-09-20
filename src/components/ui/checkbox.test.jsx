import { useState } from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { Checkbox } from "./checkbox"

function Controlled({ initial = false, ...props }) {
  const [checked, setChecked] = useState(initial)
  return <Checkbox aria-label="Agree" checked={checked} onCheckedChange={setChecked} {...props} />
}

describe("Checkbox", () => {
  it("toggles when clicked", async () => {
    const user = userEvent.setup()
    render(<Controlled />)
    const box = screen.getByRole("checkbox", { name: "Agree" })
    expect(box).not.toBeChecked()
    await user.click(box)
    expect(box).toBeChecked()
    await user.click(box)
    expect(box).not.toBeChecked()
  })

  it("toggles from the keyboard with Space", async () => {
    const user = userEvent.setup()
    render(<Controlled />)
    const box = screen.getByRole("checkbox", { name: "Agree" })
    await user.tab()
    expect(box).toHaveFocus()
    await user.keyboard(" ")
    expect(box).toBeChecked()
  })

  it("shows the controlled checked state and reports changes without owning it", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Checkbox aria-label="Agree" checked onCheckedChange={onCheckedChange} />)
    const box = screen.getByRole("checkbox", { name: "Agree" })
    expect(box).toBeChecked()
    await user.click(box)
    expect(onCheckedChange).toHaveBeenCalledWith(false, expect.anything())
    expect(box).toBeChecked()
  })

  it("ignores clicks when disabled", async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Checkbox aria-label="Agree" disabled onCheckedChange={onCheckedChange} />)
    const box = screen.getByRole("checkbox", { name: "Agree" })
    await user.click(box)
    expect(onCheckedChange).not.toHaveBeenCalled()
    expect(box).toHaveAttribute("aria-disabled", "true")
  })

  it("is named by a wrapping label, so clicking the label toggles it", async () => {
    const user = userEvent.setup()
    render(
      <label>
        <Controlled aria-label={undefined} />
        Send me updates
      </label>
    )
    const box = screen.getByRole("checkbox", { name: "Send me updates" })
    await user.click(screen.getByText("Send me updates"))
    expect(box).toBeChecked()
  })
})
