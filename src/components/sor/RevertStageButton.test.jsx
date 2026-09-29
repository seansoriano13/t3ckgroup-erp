import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import RevertStageButton from "./RevertStageButton"
import { opportunityService } from "../../services/opportunityService"

let currentUser = { id: "mover" }
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: currentUser }) }))
vi.mock("../../services/opportunityService", () => ({
    opportunityService: { getVisitsForRevert: vi.fn(), revertStage: vi.fn(), revertNeedsProgressChoice: vi.fn() },
}))

const OPPORTUNITY = { id: "opp-1", flow_stage_id: "stage-2", deal_owner_id: "owner" }
const MOVED = [
    { sequence: 2, left_at: null, undone_at: null, entered_by: "mover" },
    { sequence: 1, left_at: "t", undone_at: null, entered_by: "reg" },
]

function renderButton() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={client}>
            <RevertStageButton opportunity={OPPORTUNITY} />
        </QueryClientProvider>,
    )
}

describe("RevertStageButton", () => {
    beforeEach(() => {
        currentUser = { id: "mover" }
        opportunityService.getVisitsForRevert.mockResolvedValue(MOVED)
        opportunityService.revertNeedsProgressChoice.mockResolvedValue(false)
    })

    it("shows when the viewer may revert and the SOR has a stage to go back to", async () => {
        renderButton()
        expect(await screen.findByRole("button", { name: /revert to last stage/i })).toBeInTheDocument()
    })

    it("is hidden from someone who may not revert", async () => {
        currentUser = { id: "stranger" }
        renderButton()
        await vi.waitFor(() => expect(opportunityService.getVisitsForRevert).toHaveBeenCalled())
        expect(screen.queryByRole("button", { name: /revert to last stage/i })).not.toBeInTheDocument()
    })

    it("is hidden when the SOR has never moved", async () => {
        opportunityService.getVisitsForRevert.mockResolvedValue([MOVED[0]])
        renderButton()
        await vi.waitFor(() => expect(opportunityService.getVisitsForRevert).toHaveBeenCalled())
        expect(screen.queryByRole("button", { name: /revert to last stage/i })).not.toBeInTheDocument()
    })

    it("reverts straight away when no progress choice is needed", async () => {
        opportunityService.revertStage.mockResolvedValueOnce({ id: "opp-1" })
        renderButton()
        await userEvent.click(await screen.findByRole("button", { name: /revert to last stage/i }))
        await vi.waitFor(() => expect(opportunityService.revertStage).toHaveBeenCalledWith("opp-1", null))
        expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument()
    })

    it("opens the Keep/Remove dialog when the pre-check says Stage Work needs a choice, and reverts with it (#392)", async () => {
        opportunityService.revertNeedsProgressChoice.mockResolvedValue(true)
        opportunityService.revertStage.mockResolvedValueOnce({ id: "opp-1" })
        renderButton()
        await userEvent.click(await screen.findByRole("button", { name: /revert to last stage/i }))
        expect(await screen.findByRole("radio", { name: /remove progress/i })).toBeInTheDocument()
        expect(opportunityService.revertStage).not.toHaveBeenCalled()

        await userEvent.click(screen.getByRole("radio", { name: /remove progress/i }))
        await userEvent.click(screen.getByRole("button", { name: /confirm revert/i }))

        await vi.waitFor(() => expect(opportunityService.revertStage).toHaveBeenCalledWith("opp-1", "remove"))
    })

    it("surfaces a refusal as a toast, not the dialog", async () => {
        opportunityService.revertStage.mockRejectedValueOnce(new Error("only whoever made the last move, the Deal Owner, or a Super Admin can revert it."))
        renderButton()
        await userEvent.click(await screen.findByRole("button", { name: /revert to last stage/i }))
        await vi.waitFor(() => expect(opportunityService.revertStage).toHaveBeenCalled())
        expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument()
    })
})
