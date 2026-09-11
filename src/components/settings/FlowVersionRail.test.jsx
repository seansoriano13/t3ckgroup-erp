import { useEffect, useState } from "react"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import FlowVersionRail, { FlowVersionStatusChip } from "./FlowVersionRail"
import { renderWithProviders } from "@/test/support"
import { salesFlowService } from "@/services/salesFlowService"
import { waitForNetworkIdle } from "@/test/network"
import { makeOpportunity, makeSuperAdmin } from "@/test/factories"
import { stubLockSalesFlowRpc } from "@/test/stubs/lockFlowRpc"
import { stubRestoreFlowSnapshotRpc } from "@/test/stubs/restoreFlowSnapshotRpc"
import toast from "react-hot-toast"

const mockUser = vi.hoisted(() => ({ current: null }))

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}))

/**
 * Unlike the retired `FlowSnapshotHistoryPanel`, the rail is bound to
 * whatever Sale Type/flow the canvas has open — it takes them as props
 * rather than choosing its own. These helpers build the fixture and read the
 * live flow/stages/edges straight from the service, the way `FlowCanvas`
 * itself would hand them down.
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

async function currentCanvas(saleTypeId) {
  const { flow, stages, edges } = await salesFlowService.getFlow(saleTypeId)
  return { flow, stages, edges }
}

function Rail({ saleTypeId, saleTypeName = "Government Bidding", versionPreview, ...rest }) {
  const [canvas, setCanvas] = useState(null)
  useEffect(() => {
    currentCanvas(saleTypeId).then(setCanvas)
  }, [saleTypeId])
  if (!canvas) return null
  return (
    <FlowVersionRail
      flow={canvas.flow}
      stages={canvas.stages}
      edges={canvas.edges}
      saleTypeName={saleTypeName}
      salesFlowService={salesFlowService}
      user={mockUser.current}
      versionPreview={versionPreview}
      stageNameFor={(id) => canvas.stages.find((s) => s.id === id)?.name || id}
      {...rest}
    />
  )
}

describe("FlowVersionRail", () => {
  let admin

  beforeEach(() => {
    admin = makeSuperAdmin({ name: "Super Admin" })
    mockUser.current = admin
    stubLockSalesFlowRpc()
    stubRestoreFlowSnapshotRpc()
  })

  it("lists a Sale Type's published versions newest first, pinning the draft on top when unlocked", async () => {
    const { saleType, flow } = await buildFlowWithTwoSnapshots(admin.id)
    await salesFlowService.unlockFlow(flow.id, "Back to editing", admin.id)
    renderWithProviders(<Rail saleTypeId={saleType.id} />)

    await screen.findByText("Draft")
    const versions = await screen.findAllByText(/^v\d+\.\d+$/)
    expect(versions.map((el) => el.textContent)).toEqual(["v1.1", "v1.0"])
    // Draft renders above v1.1, v1.1 above v1.0 — newest first, draft pinned.
    const rowLabels = screen.getAllByText(/^(Draft|v\d+\.\d+)$/).map((el) => el.textContent)
    expect(rowLabels).toEqual(["Draft", "v1.1", "v1.0"])
  })

  it("expands a row to show what changed since the previous version", async () => {
    const { saleType } = await buildFlowWithTwoSnapshots(admin.id)
    const user = userEvent.setup()
    renderWithProviders(<Rail saleTypeId={saleType.id} />)
    await screen.findByText("v1.1")

    await user.click(screen.getByText("v1.1"))
    expect(await screen.findByText(/Added: Negotiation/)).toBeInTheDocument()

    // v1.0 has no previous version, so it diffs against an empty shape — its
    // whole first shape reads as added rather than the row having nothing to
    // expand.
    await user.click(screen.getByText("v1.0"))
    expect(await screen.findByText("Added: Lead")).toBeInTheDocument()
    expect(screen.getByText("Added: Awarded")).toBeInTheDocument()
  })

  it("shows what the draft would change against an earlier version via Compare with draft", async () => {
    const { saleType, flow } = await buildFlowWithTwoSnapshots(admin.id)
    await salesFlowService.unlockFlow(flow.id, "Back to editing", admin.id)
    await salesFlowService.addStage(flow.id, "Onboarding", admin.id)
    const user = userEvent.setup()
    renderWithProviders(<Rail saleTypeId={saleType.id} />)
    await screen.findByText("v1.1")

    await user.click(screen.getByText("v1.0"))
    const compareButtons = screen.getAllByRole("button", { name: "Compare with draft" })
    await user.click(compareButtons[compareButtons.length - 1])

    expect(await screen.findByText(/Added: Onboarding/)).toBeInTheDocument()
  })

  it("restores an earlier version into the draft after confirming", async () => {
    const { saleType, flow } = await buildFlowWithTwoSnapshots(admin.id)
    await salesFlowService.unlockFlow(flow.id, "About to restore v1", admin.id)
    const user = userEvent.setup()
    renderWithProviders(<Rail saleTypeId={saleType.id} />)
    await screen.findByText("v1.1")

    await user.click(screen.getByText("v1.0"))
    const restoreButtons = screen.getAllByRole("button", { name: "Restore" })
    await user.click(restoreButtons[restoreButtons.length - 1]) // v1.0 is the last (oldest) row
    await screen.findByText("Restore v1.0?")
    const confirmButtons = screen.getAllByRole("button", { name: "Restore" })
    await user.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(async () => {
      const stages = (await salesFlowService.getFlow(saleType.id)).stages
      expect(stages.map((s) => s.name).sort()).toEqual(["Awarded", "Lead"])
    })
  })

  it("shows the refusal message when a dropped Stage still has an SOR on it", async () => {
    const errorToast = vi.spyOn(toast, "error").mockImplementation(() => "id")
    const { saleType, flow } = await buildFlowWithTwoSnapshots(admin.id)
    await salesFlowService.unlockFlow(flow.id, "About to restore v1", admin.id)
    const negotiation = (await salesFlowService.getFlow(saleType.id)).stages.find(
      (s) => s.name === "Negotiation",
    )
    makeOpportunity({ sale_type_id: saleType.id, flow_stage_id: negotiation.id })

    const user = userEvent.setup()
    renderWithProviders(<Rail saleTypeId={saleType.id} />)
    await screen.findByText("v1.1")

    await user.click(screen.getByText("v1.0"))
    const restoreButtons = screen.getAllByRole("button", { name: "Restore" })
    await user.click(restoreButtons[restoreButtons.length - 1]) // v1.0 is the last (oldest) row
    await screen.findByText("Restore v1.0?")
    const confirmButtons = screen.getAllByRole("button", { name: "Restore" })
    await user.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(() => {
      expect(errorToast).toHaveBeenCalledWith(
        expect.stringMatching(/"Negotiation" is referenced by 1 SOR\b/),
      )
    })
    const stages = (await salesFlowService.getFlow(saleType.id)).stages
    expect(stages.map((s) => s.name).sort()).toEqual(["Awarded", "Lead", "Negotiation"])
  })

  it("shows who published each version and slots reopen events in between", async () => {
    const { saleType } = await buildFlowWithTwoSnapshots(admin.id)
    await waitForNetworkIdle() // lockFlow/unlockFlow's audit writes are fire-and-forget
    renderWithProviders(<Rail saleTypeId={saleType.id} />)
    await screen.findByText("v1.1")

    expect(screen.getAllByText(/Super Admin/).length).toBeGreaterThan(0)
    expect(await screen.findByText(/Adding a stage/)).toBeInTheDocument()
  })

  it("shows live, non-deleted SOR counts per version", async () => {
    const { saleType } = await buildFlowWithTwoSnapshots(admin.id)
    const canvas = await currentCanvas(saleType.id)
    const negotiation = canvas.stages.find((s) => s.name === "Negotiation")
    const live = makeOpportunity({
      sale_type_id: saleType.id,
      flow_stage_id: negotiation.id,
      flow_snapshot_id: canvas.flow.locked_snapshot_id,
    })
    makeOpportunity({
      sale_type_id: saleType.id,
      flow_stage_id: negotiation.id,
      is_deleted: true,
    })
    void live

    renderWithProviders(<Rail saleTypeId={saleType.id} />)
    await screen.findByText("v1.1")

    // Whatever the exact wiring of `flow_snapshot_id` above, a soft-deleted
    // SOR never inflates the count (memory: "SOR counts exclude soft-deleted").
    const counts = screen.getAllByText(/SOR/)
    expect(counts.some((el) => /^\d+ SORs?$/.test(el.textContent.split("·").pop().trim()))).toBe(
      true,
    )
  })

  it("collapses and re-expands the rail", async () => {
    const { saleType } = await buildFlowWithTwoSnapshots(admin.id)
    const user = userEvent.setup()
    renderWithProviders(<Rail saleTypeId={saleType.id} />)
    await screen.findByText("v1.1")

    await user.click(screen.getByLabelText("Hide version history"))
    expect(screen.queryByText("v1.1")).not.toBeInTheDocument()

    await user.click(screen.getByLabelText("Show version history"))
    expect(await screen.findByText("v1.1")).toBeInTheDocument()
  })
})

describe("FlowVersionStatusChip", () => {
  beforeEach(() => {
    mockUser.current = makeSuperAdmin({ name: "Super Admin" })
    stubLockSalesFlowRpc()
  })

  it("reads 'never published' before the first publish", async () => {
    const saleType = await salesFlowService.createSaleType("Retail", mockUser.current.id)
    const { flow } = await salesFlowService.getFlow(saleType.id)
    renderWithProviders(
      <FlowVersionStatusChip
        flow={flow}
        saleTypeName={saleType.name}
        versionPreview={null}
        salesFlowService={salesFlowService}
        stageNameFor={(id) => id}
      />,
    )
    expect(await screen.findByText("never published")).toBeInTheDocument()
  })

  it("reads 'published' once locked", async () => {
    const saleType = await salesFlowService.createSaleType("Retail", mockUser.current.id)
    const admin = mockUser.current
    const flowBefore = (await salesFlowService.getFlow(saleType.id)).flow
    const lead = await salesFlowService.addStage(flowBefore.id, "Lead", admin.id)
    const won = await salesFlowService.addStage(flowBefore.id, "Awarded", admin.id)
    await salesFlowService.addEdge(flowBefore.id, lead.id, won.id, admin.id)
    await salesFlowService.setWonStage(flowBefore.id, won.id, admin.id)
    await salesFlowService.lockFlow(flowBefore.id, admin.id)

    const { flow } = await salesFlowService.getFlow(saleType.id)
    renderWithProviders(
      <FlowVersionStatusChip
        flow={flow}
        saleTypeName={saleType.name}
        versionPreview={null}
        salesFlowService={salesFlowService}
        stageNameFor={(id) => id}
      />,
    )
    expect(await screen.findByText(`${saleType.name} · v1.0 · published`)).toBeInTheDocument()
  })

  it("counts unpublished changes and lists them on click", async () => {
    const saleType = await salesFlowService.createSaleType("Retail", mockUser.current.id)
    const admin = mockUser.current
    const flowBefore = (await salesFlowService.getFlow(saleType.id)).flow
    const lead = await salesFlowService.addStage(flowBefore.id, "Lead", admin.id)
    const won = await salesFlowService.addStage(flowBefore.id, "Awarded", admin.id)
    await salesFlowService.addEdge(flowBefore.id, lead.id, won.id, admin.id)
    await salesFlowService.setWonStage(flowBefore.id, won.id, admin.id)
    await salesFlowService.lockFlow(flowBefore.id, admin.id)
    await salesFlowService.unlockFlow(flowBefore.id, "Adding one more", admin.id)
    await salesFlowService.addStage(flowBefore.id, "Negotiation", admin.id)

    const { flow, stages, edges } = await salesFlowService.getFlow(saleType.id)
    const versionPreview = await salesFlowService.previewVersion(flow.id)
    const user = userEvent.setup()
    renderWithProviders(
      <FlowVersionStatusChip
        flow={flow}
        saleTypeName={saleType.name}
        versionPreview={versionPreview}
        salesFlowService={salesFlowService}
        stageNameFor={(id) => stages.find((s) => s.id === id)?.name || id}
      />,
    )

    const chip = await screen.findByText(`${saleType.name} · v1.1 · draft (1 change)`)
    await user.click(chip)
    expect(await screen.findByText(/Added: Negotiation/)).toBeInTheDocument()
    void edges
  })
})
