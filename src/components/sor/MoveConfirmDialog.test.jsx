import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import MoveConfirmDialog from "./MoveConfirmDialog"
import { opportunityService } from "../../services/opportunityService"

vi.mock("../../services/opportunityService", () => ({
    opportunityService: { getVisitedStageIds: vi.fn(), updateStatus: vi.fn() },
}))

const OPPORTUNITY = { id: "opp-1", flow_stage_id: "b", client_name: "Acme", project_title: "Ropes" }

function renderDialog(targetId) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={client}>
            <MoveConfirmDialog
                isOpen
                onClose={vi.fn()}
                opportunity={OPPORTUNITY}
                targetStage={{ id: targetId, name: "Stage " + targetId }}
                knownBlockers={[{ label: "Sign-off" }]}
                actorId="me"
            />
        </QueryClientProvider>,
    )
}

describe("MoveConfirmDialog — Return prompt (#390)", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        opportunityService.getVisitedStageIds.mockResolvedValue(["a", "b"])
        opportunityService.updateStatus.mockResolvedValue({})
    })

    it("asks Resume / Start fresh for a Stage already visited, and lists no blockers", async () => {
        renderDialog("a")
        expect(await screen.findByRole("radio", { name: /resume previous work/i })).toHaveAttribute("aria-checked", "true")
        expect(screen.getByRole("radio", { name: /start fresh/i })).toBeDisabled()
        expect(screen.queryByText("Sign-off")).not.toBeInTheDocument()
        await userEvent.click(screen.getByRole("button", { name: /confirm move/i }))
        expect(opportunityService.updateStatus).toHaveBeenCalledWith("opp-1", "a", "me", null, null, { returnChoice: "resume" })
    })

    it("asks nothing for a Stage never visited", async () => {
        renderDialog("c")
        await vi.waitFor(() => expect(opportunityService.getVisitedStageIds).toHaveBeenCalled())
        expect(screen.queryByRole("radio")).not.toBeInTheDocument()
        expect(screen.getByText("Sign-off")).toBeInTheDocument()
    })
})
