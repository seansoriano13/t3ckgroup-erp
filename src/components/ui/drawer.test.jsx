import { useState } from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { setupUser } from "@/test/support"

import { Drawer, DrawerClose } from "./drawer"

function Harness({ side }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open panel</button>
      <Drawer open={open} onOpenChange={setOpen} side={side}>
        <p>Panel body</p>
        <DrawerClose>Dismiss</DrawerClose>
        <input aria-label="Search" />
      </Drawer>
    </div>
  )
}

describe("Drawer", () => {
  it("shows nothing until opened, then shows the panel as a dialog", async () => {
    const user = setupUser()
    render(<Harness />)
    expect(screen.queryByText("Panel body")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Open panel" }))
    expect(screen.getByRole("dialog")).toHaveTextContent("Panel body")
  })

  it("closes on Escape", async () => {
    const user = setupUser()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Open panel" }))
    await user.keyboard("{Escape}")
    expect(screen.queryByText("Panel body")).not.toBeInTheDocument()
  })

  it("closes when the backdrop is clicked, but not when the panel is", async () => {
    const user = setupUser()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Open panel" }))
    await user.click(screen.getByText("Panel body"))
    expect(screen.getByText("Panel body")).toBeInTheDocument()
    await user.click(document.querySelector('[data-slot="drawer-overlay"]'))
    expect(screen.queryByText("Panel body")).not.toBeInTheDocument()
  })

  it("closes from its close control", async () => {
    const user = setupUser()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Open panel" }))
    await user.click(screen.getByRole("button", { name: "Dismiss" }))
    expect(screen.queryByText("Panel body")).not.toBeInTheDocument()
  })

  it("moves focus into the panel when it opens", async () => {
    const user = setupUser()
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Open panel" }))
    const dialog = screen.getByRole("dialog")
    await waitFor(() => expect(dialog).toContainElement(document.activeElement))
  })

  it("reports the requested close through onOpenChange", async () => {
    const user = setupUser()
    const onOpenChange = vi.fn()
    render(<Drawer open onOpenChange={onOpenChange} side="left"><p>Body</p></Drawer>)
    await user.keyboard("{Escape}")
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
  })
})
