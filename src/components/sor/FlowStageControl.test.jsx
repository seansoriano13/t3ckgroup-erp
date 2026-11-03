import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import FlowStageControl from "./FlowStageControl"
import { salesFlowService } from "../../services/salesFlowService"

vi.mock("../../services/salesFlowService", () => ({
  salesFlowService: { getFlow: vi.fn() },
}))
vi.mock("./RevertStageButton", () => ({ default: () => null }))
vi.mock("./MarkLostButton", () => ({ default: () => null }))
vi.mock("./ReopenButton", () => ({ default: () => null }))

const wrap = (ui) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

describe("FlowStageControl gates on return stages (#831)", () => {
  const stages = [
    { id: "s1", name: "Lead", sort_order: 1 },
    { id: "s2", name: "Qualified", sort_order: 2 },
  ]
  const edges = [
    { id: "e1", from_stage_id: "s1", to_stage_id: "s2" },
    { id: "e2", from_stage_id: "s2", to_stage_id: "s1" },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    salesFlowService.getFlow.mockResolvedValue({ flow: { won_stage_id: "won" }, stages, edges })
  })

  it("keeps a forward destination blocked even if it was visited before (#831)", async () => {
    const onMove = vi.fn()
    wrap(
      <FlowStageControl
        opportunity={{ id: "opp-1", sale_type_id: "st-1", flow_stage_id: "s1" }}
        onMove={onMove}
        blockedBy={["Costing settled"]}
        returnStageIds={["s2"]}
      />,
    )

    const qualifiedTile = (await screen.findByText("Qualified")).closest("li")
    expect(qualifiedTile).toHaveAttribute("title", "Blocked — missing: Costing settled")
    expect(qualifiedTile.className).toContain("opacity-40")

    await userEvent.click(qualifiedTile)
    expect(onMove).not.toHaveBeenCalled()
  })

  it("skips gates on a backward return move (#390)", async () => {
    const onMove = vi.fn()
    wrap(
      <FlowStageControl
        opportunity={{ id: "opp-1", sale_type_id: "st-1", flow_stage_id: "s2" }}
        onMove={onMove}
        blockedBy={["Costing settled"]}
        returnStageIds={["s1"]}
      />,
    )

    const leadTile = (await screen.findByText("Lead")).closest("li")
    expect(leadTile).not.toHaveAttribute("title", "Blocked — missing: Costing settled")
    expect(leadTile.className).not.toContain("opacity-40")

    await userEvent.click(leadTile)
    expect(onMove).toHaveBeenCalledWith("s1")
  })
})
