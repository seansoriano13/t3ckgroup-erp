import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import FlowStageControl from "./FlowStageControl"
import { salesFlowService } from "../../services/salesFlowService"

vi.mock("../../services/salesFlowService", () => ({ salesFlowService: { getFlow: vi.fn() } }))
vi.mock("./RevertStageButton", () => ({ default: () => null }))

// Laid out the way flows are drawn: Closed Won left of Closed Lost, both terminal.
const STAGES = [
    { id: "entry", name: "Inquiry", sort_order: 0, pos_x: 0, is_terminal: false },
    { id: "quote", name: "Quotation", sort_order: 1, pos_x: 200, is_terminal: false },
    { id: "won", name: "Closed Won", sort_order: 2, pos_x: 400, is_terminal: true },
    { id: "lost", name: "Closed Lost", sort_order: 3, pos_x: 600, is_terminal: true },
]
const EDGES = [
    { from_stage_id: "entry", to_stage_id: "quote" },
    { from_stage_id: "quote", to_stage_id: "won" },
    { from_stage_id: "quote", to_stage_id: "lost" },
]

async function renderAt(flowStageId) {
    salesFlowService.getFlow.mockResolvedValue({ flow: { won_stage_id: "won" }, stages: STAGES, edges: EDGES })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
        <QueryClientProvider client={client}>
            <FlowStageControl opportunity={{ id: "opp", sale_type_id: "st", flow_stage_id: flowStageId }} onMove={() => {}} />
        </QueryClientProvider>,
    )
    await screen.findByText("Closed Lost")
}

const tile = (name) => screen.getByText(name).closest("li")

describe("FlowStageControl ribbon", () => {
    it("does not green Closed Won on a Closed Lost deal", async () => {
        await renderAt("lost")
        expect(tile("Closed Won").className).not.toMatch(/bg-green-9/)
        expect(tile("Closed Won").className).toMatch(/bg-muted/)
        expect(tile("Quotation").className).toMatch(/\/20/)
        expect(tile("Closed Lost").className).toMatch(/shadow-inner/)
    })

    it("still shows the stages before Closed Won as completed on a won deal", async () => {
        await renderAt("won")
        expect(tile("Quotation").className).toMatch(/\/20/)
        expect(tile("Closed Won").className).toMatch(/bg-green-9 /)
        expect(tile("Closed Lost").className).toMatch(/bg-muted/)
    })
})
