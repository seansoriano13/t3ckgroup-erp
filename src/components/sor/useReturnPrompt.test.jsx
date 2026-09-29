import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { useReturnPrompt } from "./useReturnPrompt"
import { opportunityService } from "../../services/opportunityService"

vi.mock("../../services/opportunityService", () => ({
    opportunityService: { getReturnStageIds: vi.fn() },
}))

const OPPORTUNITY = { id: "opp-1", flow_stage_id: "b" }
const STAGES = [{ id: "a", name: "Quoting" }, { id: "c", name: "Closing" }]

function Mover({ move, next }) {
    const prompt = useReturnPrompt({ opportunity: OPPORTUNITY, stages: STAGES, enabled: true, move })
    return (
        <>
            <button type="button" onClick={() => prompt.request({ next })}>move</button>
            {prompt.dialog}
        </>
    )
}

function renderMover(next) {
    const move = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><Mover move={move} next={next} /></QueryClientProvider>)
    return move
}

describe("useReturnPrompt (#390)", () => {
    beforeEach(() => opportunityService.getReturnStageIds.mockResolvedValue(["a", "b"]))

    it("moves straight through to a Stage never visited", async () => {
        const move = renderMover("c")
        await userEvent.click(screen.getByRole("button", { name: "move" }))
        await vi.waitFor(() => expect(move).toHaveBeenCalledWith({ next: "c" }))
        expect(screen.queryByText(/move back to/i)).not.toBeInTheDocument()
    })

    it("asks first on a Return, then moves with the choice", async () => {
        const move = renderMover("a")
        await userEvent.click(screen.getByRole("button", { name: "move" }))
        expect(await screen.findByText("Move back to Quoting?")).toBeInTheDocument()
        expect(move).not.toHaveBeenCalled()
        await userEvent.click(screen.getByRole("button", { name: /confirm move/i }))
        expect(move).toHaveBeenCalledWith({ next: "a", returnChoice: "resume" })
    })
})
