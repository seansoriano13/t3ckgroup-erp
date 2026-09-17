import { render, screen } from "@testing-library/react"
import { setupUser } from "@/test/support"
import { describe, expect, it, vi } from "vitest"
import AddStagePopoverForm from "./AddStagePopoverForm"

describe("AddStagePopoverForm (issue #195)", () => {
  it("submits the stage name and closes when Enter is pressed", async () => {
    const user = setupUser()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn()

    render(<AddStagePopoverForm onSubmit={onSubmit} close={close} />)

    const input = screen.getByPlaceholderText(/Name a Stage/)
    await user.type(input, "Proposal{Enter}")

    expect(onSubmit).toHaveBeenCalledWith("Proposal")
    expect(close).toHaveBeenCalledTimes(1)
  })

  it("closes the popover when Esc is pressed", async () => {
    const user = setupUser()
    const onSubmit = vi.fn()
    const close = vi.fn()

    render(<AddStagePopoverForm onSubmit={onSubmit} close={close} />)

    const input = screen.getByPlaceholderText(/Name a Stage/)
    await user.type(input, "{Escape}")

    expect(close).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("shows an inline error and keeps popover open for a blank name", async () => {
    const user = setupUser()
    const onSubmit = vi.fn()
    const close = vi.fn()

    render(<AddStagePopoverForm onSubmit={onSubmit} close={close} />)

    await user.click(screen.getByRole("button", { name: "Add" }))

    expect(screen.getByText("A Stage needs a name.")).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it("shows an inline error and keeps popover open when onSubmit rejects (e.g. duplicate name)", async () => {
    const user = setupUser()
    const onSubmit = vi.fn().mockRejectedValue(new Error('Stage "Lead" already exists in this flow.'))
    const close = vi.fn()

    render(<AddStagePopoverForm onSubmit={onSubmit} close={close} />)

    const input = screen.getByPlaceholderText(/Name a Stage/)
    await user.type(input, "Lead{Enter}")

    expect(await screen.findByText('Stage "Lead" already exists in this flow.')).toBeInTheDocument()
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText(/Name a Stage/)).toBeInTheDocument()
  })

  it("clears the inline error when the user types", async () => {
    const user = setupUser()
    const onSubmit = vi.fn()
    const close = vi.fn()

    render(<AddStagePopoverForm onSubmit={onSubmit} close={close} />)

    await user.click(screen.getByRole("button", { name: "Add" }))
    expect(screen.getByText("A Stage needs a name.")).toBeInTheDocument()

    const input = screen.getByPlaceholderText(/Name a Stage/)
    await user.type(input, "N")
    expect(screen.queryByText("A Stage needs a name.")).not.toBeInTheDocument()
  })
})
