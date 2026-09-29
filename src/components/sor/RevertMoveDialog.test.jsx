import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import RevertMoveDialog from "./RevertMoveDialog"

describe("RevertMoveDialog", () => {
    it("offers Keep progress, selected, and Remove progress, both enabled", () => {
        render(<RevertMoveDialog isOpen stageName="Quoting" onCancel={vi.fn()} onConfirm={vi.fn()} />)
        expect(screen.getByRole("radio", { name: /keep progress/i })).toHaveAttribute("aria-checked", "true")
        expect(screen.getByRole("radio", { name: /remove progress/i })).toBeEnabled()
    })

    it("confirms with the chosen option", async () => {
        const onConfirm = vi.fn()
        render(<RevertMoveDialog isOpen stageName="Quoting" onCancel={vi.fn()} onConfirm={onConfirm} />)
        await userEvent.click(screen.getByRole("button", { name: /confirm revert/i }))
        expect(onConfirm).toHaveBeenCalledWith("keep")
    })

    it("confirms with Remove progress once selected", async () => {
        const onConfirm = vi.fn()
        render(<RevertMoveDialog isOpen stageName="Quoting" onCancel={vi.fn()} onConfirm={onConfirm} />)
        await userEvent.click(screen.getByRole("radio", { name: /remove progress/i }))
        await userEvent.click(screen.getByRole("button", { name: /confirm revert/i }))
        expect(onConfirm).toHaveBeenCalledWith("remove")
    })

    it("cancels when closed", async () => {
        const onCancel = vi.fn()
        render(<RevertMoveDialog isOpen stageName="Quoting" onCancel={onCancel} onConfirm={vi.fn()} />)
        await userEvent.click(screen.getByRole("button", { name: /cancel/i }))
        expect(onCancel).toHaveBeenCalled()
    })
})
