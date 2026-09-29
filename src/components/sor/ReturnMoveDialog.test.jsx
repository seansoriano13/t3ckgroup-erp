import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import ReturnMoveDialog from "./ReturnMoveDialog"

describe("ReturnMoveDialog", () => {
    it("offers Resume previous work, selected, and Start fresh, both enabled", () => {
        render(<ReturnMoveDialog isOpen stageName="Quoting" onCancel={vi.fn()} onConfirm={vi.fn()} />)
        expect(screen.getByRole("radio", { name: /resume previous work/i })).toHaveAttribute("aria-checked", "true")
        expect(screen.getByRole("radio", { name: /start fresh/i })).toBeEnabled()
    })

    it("confirms with the chosen option", async () => {
        const onConfirm = vi.fn()
        render(<ReturnMoveDialog isOpen stageName="Quoting" onCancel={vi.fn()} onConfirm={onConfirm} />)
        await userEvent.click(screen.getByRole("button", { name: /confirm move/i }))
        expect(onConfirm).toHaveBeenCalledWith("resume")
    })

    it("confirms with Start fresh once selected", async () => {
        const onConfirm = vi.fn()
        render(<ReturnMoveDialog isOpen stageName="Quoting" onCancel={vi.fn()} onConfirm={onConfirm} />)
        await userEvent.click(screen.getByRole("radio", { name: /start fresh/i }))
        await userEvent.click(screen.getByRole("button", { name: /confirm move/i }))
        expect(onConfirm).toHaveBeenCalledWith("start_fresh")
    })
})
