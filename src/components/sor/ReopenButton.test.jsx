import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import ReopenButton from "./ReopenButton"
import FlowStageControl from "./FlowStageControl"
import { opportunityService } from "../../services/opportunityService"
import { salesFlowService } from "../../services/salesFlowService"
import toast from "react-hot-toast"

vi.mock("../../services/opportunityService", () => ({
    opportunityService: { reopen: vi.fn(), markLost: vi.fn() },
}))
vi.mock("../../services/salesFlowService", () => ({
    salesFlowService: { getFlow: vi.fn() },
}))
vi.mock("./RevertStageButton", () => ({ default: () => null }))
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }))

const wrap = (ui) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

describe("Reopen button", () => {
    beforeEach(() => vi.clearAllMocks())

    it("reopens the deal and says so", async () => {
        opportunityService.reopen.mockResolvedValue({ id: "opp-1" })
        wrap(<ReopenButton opportunity={{ id: "opp-1" }} />)
        await userEvent.click(screen.getByRole("button", { name: /^reopen$/i }))
        await waitFor(() => expect(opportunityService.reopen).toHaveBeenCalledWith("opp-1"))
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Deal reopened."))
    })

    it("shows what the database refused with", async () => {
        opportunityService.reopen.mockRejectedValue(new Error("this deal is not Lost."))
        wrap(<ReopenButton opportunity={{ id: "opp-1" }} />)
        await userEvent.click(screen.getByRole("button", { name: /^reopen$/i }))
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("this deal is not Lost."))
    })
})

describe("Reopen in the Flow Canvas stage control", () => {
    const stages = [
        { id: "s1", name: "Lead", sort_order: 1 },
        { id: "won", name: "Won", sort_order: 2 },
        { id: "lost", name: "Closed Lost", sort_order: 3, is_terminal: true, terminal_outcome: "lost" },
        { id: "cw", name: "Closed Won", sort_order: 4, is_terminal: true, terminal_outcome: "won" },
    ]
    beforeEach(() => {
        vi.clearAllMocks()
        salesFlowService.getFlow.mockResolvedValue({ flow: { won_stage_id: "won" }, stages, edges: [] })
    })

    it("shows Reopen, not Mark as Lost, on a Lost deal", async () => {
        wrap(<FlowStageControl opportunity={{ id: "o", sale_type_id: "t", flow_stage_id: "lost" }} />)
        expect(await screen.findByRole("button", { name: /^reopen$/i })).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /mark as lost/i })).not.toBeInTheDocument()
    })

    it("shows Mark as Lost, not Reopen, on an open deal", async () => {
        wrap(<FlowStageControl opportunity={{ id: "o", sale_type_id: "t", flow_stage_id: "s1" }} />)
        expect(await screen.findByRole("button", { name: /mark as lost/i })).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /^reopen$/i })).not.toBeInTheDocument()
    })

    it("shows neither on a Won terminal deal", async () => {
        wrap(<FlowStageControl opportunity={{ id: "o", sale_type_id: "t", flow_stage_id: "cw" }} />)
        await screen.findByText(/deals stop here/i)
        expect(screen.queryByRole("button", { name: /^reopen$/i })).not.toBeInTheDocument()
    })
})
