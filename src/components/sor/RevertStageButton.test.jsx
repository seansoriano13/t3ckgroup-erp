import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import RevertStageButton from "./RevertStageButton"
import { opportunityService } from "../../services/opportunityService"

let currentUser = { id: "mover" }
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: currentUser }) }))
vi.mock("../../services/opportunityService", () => ({
    opportunityService: { getVisitsForRevert: vi.fn(), revertStage: vi.fn() },
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
})
