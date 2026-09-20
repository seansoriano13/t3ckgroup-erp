import { useState } from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { setupUser } from "@/test/support"

import { Slider } from "./slider"

function Controlled(props) {
  const [value, setValue] = useState(1)
  return <Slider aria-label="Zoom" min={1} max={3} step={0.5} value={value} onValueChange={setValue} {...props} />
}

describe("Slider", () => {
  it("exposes the current value and its range as a slider", () => {
    render(<Controlled />)
    const thumb = screen.getByRole("slider", { name: "Zoom" })
    expect(thumb).toHaveAttribute("aria-valuenow", "1")
    expect(thumb).toHaveAttribute("min", "1")
    expect(thumb).toHaveAttribute("max", "3")
  })

  it("moves with the arrow keys by its step", async () => {
    const user = setupUser()
    render(<Controlled />)
    const thumb = screen.getByRole("slider", { name: "Zoom" })
    thumb.focus()
    await user.keyboard("{ArrowRight}")
    expect(thumb).toHaveAttribute("aria-valuenow", "1.5")
    await user.keyboard("{ArrowLeft}")
    expect(thumb).toHaveAttribute("aria-valuenow", "1")
  })

  it("reports changes through onValueChange with the new number", async () => {
    const user = setupUser()
    const onValueChange = vi.fn()
    render(<Slider aria-label="Zoom" min={0} max={10} value={5} onValueChange={onValueChange} />)
    screen.getByRole("slider", { name: "Zoom" }).focus()
    await user.keyboard("{ArrowRight}")
    expect(onValueChange).toHaveBeenCalled()
    expect(onValueChange.mock.calls[0][0]).toBe(6)
  })

  it("ignores the keyboard when disabled", async () => {
    const user = setupUser()
    render(<Controlled disabled />)
    const thumb = screen.getByRole("slider", { name: "Zoom" })
    thumb.focus()
    await user.keyboard("{ArrowRight}")
    expect(thumb).toHaveAttribute("aria-valuenow", "1")
  })
})
