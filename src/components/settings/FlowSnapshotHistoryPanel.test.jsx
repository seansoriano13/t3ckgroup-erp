import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import FlowSnapshotHistoryPanel from "./FlowSnapshotHistoryPanel"
import { renderWithProviders } from "@/test/support"
import { salesFlowService } from "@/services/salesFlowService"
import { waitForNetworkIdle } from "@/test/network"
import { makeSuperAdmin } from "@/test/factories"
import { stubLockSalesFlowRpc } from "@/test/stubs/lockFlowRpc"

const mockUser = vi.hoisted(() => ({ current: null }))

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}))

/**
 * The panel is its own Sale Type picker rather than reading the canvas's
 * selection (this reshape) — so a fixture here is a locked flow built
 * straight through the service, the same way FlowCanvas's own tests build
 * one, not a UI walkthrough of the canvas.
 */
async function buildFlowWithTwoSnapshots(adminId) {
  const saleType = await salesFlowService.createSaleType("Government Bidding", adminId)
  const flow = (await salesFlowService.getFlow(saleType.id)).flow
  const lead = await salesFlowService.addStage(flow.id, "Lead", adminId)
  const won = await salesFlowService.addStage(flow.id, "Awarded", adminId)
  await salesFlowService.addEdge(flow.id, lead.id, won.id, adminId)
  await salesFlowService.setWonStage(flow.id, won.id, adminId)
  await salesFlowService.lockFlow(flow.id, adminId)
  await salesFlowService.unlockFlow(flow.id, "Adding a stage", adminId)
  const negotiation = await salesFlowService.addStage(flow.id, "Negotiation", adminId)
  await salesFlowService.addEdge(flow.id, lead.id, negotiation.id, adminId)
  await salesFlowService.lockFlow(flow.id, adminId)
  return { saleType, flow }
}

describe("FlowSnapshotHistoryPanel", () => {
  let admin

  beforeEach(() => {
    admin = makeSuperAdmin({ name: "Super Admin" })
    mockUser.current = admin
    stubLockSalesFlowRpc()
  })

  it("lists a Sale Type's Snapshots newest first once chosen", async () => {
    const { saleType } = await buildFlowWithTwoSnapshots(admin.id)
    const user = userEvent.setup()
    renderWithProviders(<FlowSnapshotHistoryPanel open onOpenChange={() => {}} />)

    await screen.findByRole("option", { name: "Government Bidding" })
    await user.selectOptions(screen.getByLabelText("Sale Type"), saleType.id)

    const versions = await screen.findAllByText(/^v\d$/)
    expect(versions.map((el) => el.textContent)).toEqual(["v2", "v1"])
  })

  it("restores an earlier Snapshot into the flow's draft after confirming", async () => {
    const { saleType, flow } = await buildFlowWithTwoSnapshots(admin.id)
    await salesFlowService.unlockFlow(flow.id, "About to restore v1", admin.id)
    const user = userEvent.setup()
    renderWithProviders(<FlowSnapshotHistoryPanel open onOpenChange={() => {}} />)
    await screen.findByRole("option", { name: "Government Bidding" })
    await user.selectOptions(screen.getByLabelText("Sale Type"), saleType.id)
    await screen.findByText("v2")

    const restoreButtons = screen.getAllByRole("button", { name: "Restore" })
    await user.click(restoreButtons[1]) // v1 is the second row (newest first)

    await screen.findByText("Restore Flow Snapshot v1?")
    const confirmButtons = screen.getAllByRole("button", { name: "Restore" })
    await user.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(async () => {
      const stages = (await salesFlowService.getFlow(saleType.id)).stages
      expect(stages.map((s) => s.name).sort()).toEqual(["Awarded", "Lead"])
    })
  })

  it("shows a plain-language diff once two Snapshots are checked", async () => {
    const { saleType } = await buildFlowWithTwoSnapshots(admin.id)
    const user = userEvent.setup()
    renderWithProviders(<FlowSnapshotHistoryPanel open onOpenChange={() => {}} />)
    await screen.findByRole("option", { name: "Government Bidding" })
    await user.selectOptions(screen.getByLabelText("Sale Type"), saleType.id)
    await screen.findByText("v2")

    await user.click(screen.getByLabelText("Compare Snapshot v1"))
    await user.click(screen.getByLabelText("Compare Snapshot v2"))

    expect(await screen.findByText("v1 → v2")).toBeInTheDocument()
    expect(screen.getByText(/Added: Negotiation/)).toBeInTheDocument()
  })

  it("shows who locked each Snapshot and why the flow was reopened along the way", async () => {
    const { saleType } = await buildFlowWithTwoSnapshots(admin.id)
    await waitForNetworkIdle() // lockFlow/unlockFlow's audit writes are fire-and-forget
    renderWithProviders(<FlowSnapshotHistoryPanel open onOpenChange={() => {}} />)
    await screen.findByRole("option", { name: "Government Bidding" })
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText("Sale Type"), saleType.id)
    await screen.findByText("v2")

    expect(screen.getAllByText(/Locked by Super Admin/).length).toBeGreaterThan(0)
    expect(await screen.findByText(/Adding a stage/)).toBeInTheDocument()
  })
})
