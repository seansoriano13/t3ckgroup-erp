import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { setupUser } from "@/test/support"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import FlowVersionBadge from "./FlowVersionBadge"
import { salesFlowService } from "../../services/salesFlowService"

vi.mock("../../services/salesFlowService", () => ({
    salesFlowService: {
        getSnapshot: vi.fn(),
        getFlow: vi.fn(),
    },
}))

function renderBadge(props) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    })
    return render(
        <QueryClientProvider client={client}>
            <FlowVersionBadge {...props} />
        </QueryClientProvider>,
    )
}

const FLOW_DEAL = {
    id: "opp-1",
    sale_type_id: "st-1",
    flow_snapshot_id: "snap-1",
    flow_stage_id: "stage-2",
}

describe("FlowVersionBadge", () => {
    beforeEach(() => {
        salesFlowService.getSnapshot.mockResolvedValue({
            id: "snap-1",
            version: 3,
            created_at: "2026-09-01T02:00:00Z",
            snapshot_data: { stages: [], edges: [] },
        })
        salesFlowService.getFlow.mockResolvedValue({
            saleType: { id: "st-1", name: "Government" },
            flow: { id: "flow-1" },
            stages: [],
            edges: [],
        })
    })

    it("tells a salesperson which version of the flow their deal follows", async () => {
        renderBadge({ opportunity: FLOW_DEAL })

        expect(await screen.findByText("Government · v3.0")).toBeInTheDocument()
    })

    it("says nothing at all for a deal on the legacy pipeline", () => {
        // Every SOR in production is currently this. A chip reading "Pipeline
        // stages" beside the chevron ribbon would label something nobody asked
        // about, so the badge stays out of the way entirely.
        const { container } = renderBadge({
            opportunity: { id: "opp-2", sale_type_id: null, flow_snapshot_id: null },
        })

        expect(container).toBeEmptyDOMElement()
        expect(salesFlowService.getSnapshot).not.toHaveBeenCalled()
    })

    it("flags a deal that runs a flow but carries no version", async () => {
        // Not a valid state — moving such a deal already refuses — so the badge
        // says so rather than rendering a blank where a version belongs.
        renderBadge({
            opportunity: { id: "opp-3", sale_type_id: "st-1", flow_snapshot_id: null },
        })

        expect(await screen.findByText("Government · no version on record")).toBeInTheDocument()
    })

    it("opens the pinned version when the badge is clicked", async () => {
        const onOpenVersion = vi.fn()
        renderBadge({ opportunity: FLOW_DEAL, onOpenVersion })

        const badge = await screen.findByRole("button", { name: /Government · v3.0/ })
        await setupUser().click(badge)

        expect(onOpenVersion).toHaveBeenCalledWith("snap-1")
    })

    it("is not clickable when there is nowhere to go", async () => {
        // No handler passed: the version is still worth stating, but it must
        // not look like a control that does nothing.
        renderBadge({ opportunity: FLOW_DEAL })

        await screen.findByText("Government · v3.0")
        expect(screen.queryByRole("button")).not.toBeInTheDocument()
    })

    it("does not offer to open a version it has not loaded yet", async () => {
        let resolve
        salesFlowService.getSnapshot.mockReturnValue(new Promise((r) => (resolve = r)))
        const onOpenVersion = vi.fn()

        renderBadge({ opportunity: FLOW_DEAL, onOpenVersion })

        // While in flight the deal is healthy, not malformed — so no error
        // wording, and nothing clickable.
        await waitFor(() => expect(salesFlowService.getSnapshot).toHaveBeenCalled())
        expect(screen.queryByRole("button")).not.toBeInTheDocument()
        expect(screen.queryByText(/no version on record/)).not.toBeInTheDocument()

        resolve({ id: "snap-1", version: 3, created_at: null, snapshot_data: {} })
        expect(await screen.findByRole("button", { name: /v3.0/ })).toBeInTheDocument()
    })

    it("names the version even before the Sale Type has loaded", async () => {
        salesFlowService.getFlow.mockReturnValue(new Promise(() => {}))

        renderBadge({ opportunity: FLOW_DEAL })

        expect(await screen.findByText("v3.0")).toBeInTheDocument()
    })
})
