import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import FlowCanvas from "@/components/settings/FlowCanvas"
import { renderWithProviders } from "@/test/support"
import { salesFlowService } from "@/services/salesFlowService"
import {
    makeFlowEdge,
    makeFlowStage,
    makeOpportunity,
    makeSaleType,
    makeSalesFlow,
    makeSuperAdmin,
} from "@/test/factories"
import { supabase } from "@/lib/supabase"
import { stubLockSalesFlowRpc } from "@/test/stubs/lockFlowRpc"
import { stubRestoreFlowSnapshotRpc } from "@/test/stubs/restoreFlowSnapshotRpc"

/**
 * The one end-to-end journey from the Flow Canvas versioning spec (#185),
 * run once every piece it walks through exists: publish, numbering, moving
 * deals up, viewing a past version, restoring it into the draft, and adding
 * a Stage from a move line.
 *
 * Follows approvals.e2e.test.jsx's shape — mount the real screen, drive it
 * the way a Super Admin would, and read the outcome off the database rather
 * than a mocked call. The narrow rules behind each step (version numbering,
 * the move-offer eligibility, the restore RPC's id-keeping reshape) are
 * covered far more cheaply one layer down, in FlowCanvas.test.jsx and the
 * constants/services test files it exercises. This journey exists only to
 * prove the whole path taken together still ends where the spec says it
 * should: v2.0, not the v1.2 the spec's prose implies (issue #197's
 * correction — restoring v1.0 drops the Stage v1.1 added, and dropping a
 * Stage is a major change under ADR 0020).
 *
 * Lives under src/test/pages rather than beside FlowCanvas.jsx for the same
 * reason approvals.e2e.test.jsx does: Generouted routes every file under
 * src/pages with a hardcoded glob, and a journey test does not belong in
 * the production bundle.
 */

global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

const mockUser = vi.hoisted(() => ({ current: null }))

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser.current }) }))
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser.current }) }))

const channelMock = {
    on: function () { return this },
    subscribe: function () { return this },
    unsubscribe: vi.fn(),
    track: vi.fn(),
    send: vi.fn(() => Promise.resolve()),
    presenceState: vi.fn(() => ({})),
    state: "joined",
}

beforeEach(() => {
    vi.spyOn(supabase, "channel").mockReturnValue(channelMock)
    stubLockSalesFlowRpc()
    stubRestoreFlowSnapshotRpc()
    mockUser.current = makeSuperAdmin({ name: "Super Admin" })
})

describe("Flow Canvas versioning journey", () => {
    it(
        "publishes, adds a Stage, publishes again, accepts the move offer, views v1.0, restores it, and republishing reads v2.0",
        { timeout: 20000 },
        async () => {
            const user = userEvent.setup()

            const saleType = makeSaleType({ name: "Government Bidding" })
            const flow = makeSalesFlow({ sale_type_id: saleType.id })
            const lead = makeFlowStage({ flow_id: flow.id, name: "Lead", sort_order: 0 })
            const awarded = makeFlowStage({ flow_id: flow.id, name: "Awarded", sort_order: 1 })
            makeFlowEdge(lead, awarded)
            await salesFlowService.setWonStage(flow.id, awarded.id, mockUser.current.id)

            renderWithProviders(<FlowCanvas />)
            await user.click(await screen.findByRole("button", { name: saleType.name }))

            // 1. Publish v1.0.
            await user.click(await screen.findByRole("button", { name: /Publish v1\.0/ }))
            await screen.findByText("Changes since the latest version")
            await user.click(screen.getByRole("button", { name: "Publish" }))

            await waitFor(async () => {
                const history = await salesFlowService.listSnapshots(flow.id)
                expect(history).toHaveLength(1)
                expect(history[0].version).toBe(1)
                expect(history[0].version_minor).toBe(0)
            })
            const [v1] = await salesFlowService.listSnapshots(flow.id)

            // An SOR still on v1.0's Lead Stage — what makes the move offer after
            // the next (minor) publish eligible to appear at all.
            makeOpportunity({
                registered_by: mockUser.current.id,
                sale_type_id: saleType.id,
                flow_snapshot_id: v1.id,
                flow_stage_id: lead.id,
            })

            // 2. Edit draft, giving a reason.
            await user.click(await screen.findByRole("button", { name: /Edit draft/ }))
            await user.type(await screen.findByPlaceholderText(/why is this flow being reopened/i), "Adding a missing step")
            await user.click(screen.getByRole("button", { name: "Edit draft" }))

            await waitFor(async () => {
                const { flow: reopened } = await salesFlowService.getFlow(saleType.id)
                expect(reopened.state).toBe("draft")
            })

            // 3. Add a Stage with a Stage plus — Lead's own outgoing plus
            // (issue #195), which places the new Stage and draws the move from
            // Lead to it in one step, so it is reachable and the flow stays
            // publishable.
            const leadNode = (await screen.findByText("Lead")).closest(".react-flow__node")
            fireEvent.click(within(leadNode).getByLabelText(`Add Stage after ${lead.name}`))
            await user.type(await screen.findByPlaceholderText(/Name a Stage/), "Qualified")
            await user.click(screen.getByRole("button", { name: "Add" }))

            let qualified
            await waitFor(async () => {
                const { stages } = await salesFlowService.getFlow(saleType.id)
                qualified = stages.find((s) => s.name === "Qualified")
                expect(qualified).toBeTruthy()
            })

            // 4. Publish v1.1 — inserting a Stage on an existing move keeps every
            // Stage the last version had, so this stays a minor bump.
            await user.click(await screen.findByRole("button", { name: /Publish v1\.1/ }))
            await screen.findByText("Changes since the latest version")
            await user.click(screen.getByRole("button", { name: "Publish" }))

            await waitFor(async () => {
                const history = await salesFlowService.listSnapshots(flow.id)
                expect(history[0].version).toBe(1)
                expect(history[0].version_minor).toBe(1)
            })

            // 5. Accept the move-deals offer.
            expect(await screen.findByText("Move 1 SOR on 1.x up to v1.1?")).toBeInTheDocument()
            await user.click(screen.getByRole("button", { name: "Move deals" }))
            expect(await screen.findByText("Deals moved")).toBeInTheDocument()
            expect(screen.getByText("1 moved successfully.")).toBeInTheDocument()
            await user.click(screen.getByRole("button", { name: "Done" }))

            const [v1_1] = await salesFlowService.listSnapshots(flow.id)
            expect(v1_1.version_minor).toBe(1)

            // 6. View v1.0 on the canvas.
            await user.click(await screen.findByText("v1.0"))
            expect(await screen.findByText("Viewing v1.0 — read-only")).toBeInTheDocument()

            // Restoring needs a draft to restore into — the toolbar that offers
            // "Edit draft" is hidden while a version is being viewed, so back
            // out to the draft, reopen it, then return to the same version.
            await user.click(screen.getByRole("button", { name: "Back to draft" }))
            await user.click(await screen.findByRole("button", { name: /Edit draft/ }))
            await user.type(await screen.findByPlaceholderText(/why is this flow being reopened/i), "About to restore v1.0")
            await user.click(screen.getByRole("button", { name: "Edit draft" }))
            await waitFor(async () => {
                const { flow: reopened } = await salesFlowService.getFlow(saleType.id)
                expect(reopened.state).toBe("draft")
            })
            await user.click(await screen.findByText("v1.0"))
            await screen.findByText("Viewing v1.0 — read-only")

            // 7. Revert to this version.
            await user.click(screen.getByRole("button", { name: /Revert to this version|Restore into draft/i }))
            await screen.findByText(/Revert to v1\.0\?|Restore v1\.0\?/)
            await user.click(screen.getByRole("button", { name: /Revert|Restore/i }))

            expect(screen.queryByText("Viewing v1.0 — read-only")).not.toBeInTheDocument()
            await waitFor(async () => {
                const { stages } = await salesFlowService.getFlow(saleType.id)
                expect(stages.map((s) => s.name).sort()).toEqual(["Awarded", "Lead"])
            })

            // 8. Publish reads v2.0 — restoring v1.0 dropped the Stage v1.1 added,
            // and dropping a Stage is a major change (ADR 0020), not the v1.2 the
            // spec's prose implied.
            expect(await screen.findByRole("button", { name: /Publish v2\.0/ })).toBeInTheDocument()
        },
    )
})
