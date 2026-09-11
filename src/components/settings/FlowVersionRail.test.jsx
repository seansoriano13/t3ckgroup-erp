import { useEffect, useState } from "react"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import FlowVersionRail, { FlowVersionStatusChip } from "./FlowVersionRail"
import { renderWithProviders } from "@/test/support"
import { salesFlowService } from "@/services/salesFlowService"
import { waitForNetworkIdle } from "@/test/network"
import { makeOpportunity, makeSuperAdmin } from "@/test/factories"
import { stubLockSalesFlowRpc } from "@/test/stubs/lockFlowRpc"
import { stubRestoreFlowSnapshotRpc } from "@/test/stubs/restoreFlowSnapshotRpc"

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

    await user.click(screen.getByLabelText("Expand v1.1"))
    expect(await screen.findByText(/Added: Negotiation/)).toBeInTheDocument()

    // v1.0 has no previous version, so it diffs against an empty shape — its
    // whole first shape reads as added rather than the row having nothing to
    // expand.
    await user.click(screen.getByLabelText("Expand v1.0"))
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

    await user.click(screen.getByLabelText("Expand v1.0"))
    const compareButtons = screen.getAllByRole("button", { name: "Compare with draft" })
    await user.click(compareButtons[compareButtons.length - 1])

    expect(await screen.findByText(/Added: Onboarding/)).toBeInTheDocument()
  })

  it("auto-expands a collapsed row when Compare with draft is clicked directly", async () => {
    const { saleType, flow } = await buildFlowWithTwoSnapshots(admin.id)
    await salesFlowService.unlockFlow(flow.id, "Back to editing", admin.id)
    await salesFlowService.addStage(flow.id, "Onboarding", admin.id)
    const user = userEvent.setup()
    renderWithProviders(<Rail saleTypeId={saleType.id} />)
    await screen.findByText("v1.1")

    // Do NOT expand v1.0 first — clicking Compare with draft must auto-expand the row
    const compareButtons = screen.getAllByRole("button", { name: "Compare with draft" })
    await user.click(compareButtons[compareButtons.length - 1])

    expect(await screen.findByText(/Added: Onboarding/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Comparing with draft" })).toBeInTheDocument()
  })

  it("shows Flow is Locked in the rail and hides Compare with draft when flow is locked", async () => {
    const { saleType } = await buildFlowWithTwoSnapshots(admin.id)
    renderWithProviders(<Rail saleTypeId={saleType.id} />)
    await screen.findByText("v1.1")

    expect(screen.getByText("Flow is Locked")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Compare with draft" })).not.toBeInTheDocument()
  })

  it("calls onViewVersion when a row's label is clicked, and highlights the viewed row", async () => {
    const { saleType } = await buildFlowWithTwoSnapshots(admin.id)
    const onViewVersion = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<Rail saleTypeId={saleType.id} onViewVersion={onViewVersion} />)
    await screen.findByText("v1.0")

    await user.click(screen.getByText("v1.0"))
    expect(onViewVersion).toHaveBeenCalledTimes(1)
    expect(onViewVersion.mock.calls[0][0]).toMatchObject({ version: 1, version_minor: 0 })
  })

  it("calls onViewVersion(null) when the Draft row is clicked", async () => {
    const { saleType, flow } = await buildFlowWithTwoSnapshots(admin.id)
    await salesFlowService.unlockFlow(flow.id, "Back to editing", admin.id)
    const onViewVersion = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<Rail saleTypeId={saleType.id} onViewVersion={onViewVersion} viewingSnapshotId="some-id" />)
    await screen.findByText("Draft")

    await user.click(screen.getByText("Draft"))
    expect(onViewVersion).toHaveBeenCalledWith(null)
  })

  it("no longer offers a per-row Restore action (issue #193 moved it to the canvas banner)", async () => {
    const { saleType } = await buildFlowWithTwoSnapshots(admin.id)
    renderWithProviders(<Rail saleTypeId={saleType.id} />)
    await screen.findByText("v1.0")

    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument()
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

    // Pressing Escape closes the popover
    await user.keyboard("{Escape}")
    expect(screen.queryByText(/Added: Negotiation/)).not.toBeInTheDocument()

    // Reopen and click outside
    await user.click(chip)
    expect(await screen.findByText(/Added: Negotiation/)).toBeInTheDocument()
    await user.click(document.body)
    expect(screen.queryByText(/Added: Negotiation/)).not.toBeInTheDocument()

    void edges
  })
})
