/**
 * Costing Matrix release backfill (#468, spec #461 Q23, ADR 0033): costing_matrix_backfill.
 *
 * A flow Upstream -> Mount -> Later, with Open Costing Matrix mounted on Mount in the
 * Flow Snapshot the SORs sit under. Only the SORs at or past Mount get a matrix.
 * The results are filtered to this file's own flow, since the local database may
 * hold other flows.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()

let saleTypeId, flowId, upstreamId, mountId, laterId, actionId, snapshotId
const sorIds = []
const sors = {}

async function one(query, what) {
    const { data, error } = await query.select("id").single()
    if (error) throw new Error(`${what}: ${error.message}`)
    return data.id
}

async function sorAt(stageId, { deleted = false } = {}) {
    const id = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        saleTypeId,
        flowStageId: stageId,
    })
    sorIds.push(id)
    const set = await svc().from("sales_opportunities").update({ flow_snapshot_id: snapshotId, is_deleted: deleted }).eq("id", id)
    if (set.error) throw new Error(set.error.message)
    const visit = await svc().from("sor_stage_visits").update({ flow_snapshot_id: snapshotId }).eq("opportunity_id", id)
    if (visit.error) throw new Error(visit.error.message)
    return id
}

const mine = (rows) => rows.filter((r) => r.flow_id === flowId)
const matricesOf = async (sorId) => (await svc().from("costing_matrices").select("*").eq("opportunity_id", sorId)).data

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.stageParticipant)
    if (flag.error) throw flag.error
    saleTypeId = await one(svc().from("sale_types").insert({ name: `${MARKER} Backfill` }), "sale type")
    flowId = await one(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }), "flow")
    upstreamId = await one(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Upstream`, sort_order: 10 }), "upstream")
    mountId = await one(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Mount`, sort_order: 20 }), "mount")
    laterId = await one(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Later`, sort_order: 30 }), "later")
    for (const [from, to] of [
        [upstreamId, mountId],
        [mountId, laterId],
    ]) {
        await one(svc().from("flow_edges").insert({ flow_id: flowId, from_stage_id: from, to_stage_id: to }), "edge")
    }
    actionId = await one(svc().from("flow_stage_actions").insert({ stage_id: mountId, kind: "open_costing_matrix" }), "action")
    snapshotId = await one(
        svc().from("flow_snapshots").insert({
            flow_id: flowId,
            version: 9950,
            snapshot_data: {
                stages: [
                    { id: upstreamId, name: "Upstream" },
                    { id: mountId, name: "Mount" },
                    { id: laterId, name: "Later" },
                ],
                edges: [
                    { from_stage_id: upstreamId, to_stage_id: mountId },
                    { from_stage_id: mountId, to_stage_id: laterId },
                ],
                actions: [
                    {
                        id: actionId,
                        stage_id: mountId,
                        kind: "open_costing_matrix",
                        config: { purchasingIncharge: { type: "employee", id: ids.stageParticipant } },
                    },
                ],
            },
        }),
        "snapshot",
    )
    sors.upstream = await sorAt(upstreamId)
    sors.atMount = await sorAt(mountId)
    sors.later = await sorAt(laterId)
    sors.deleted = await sorAt(laterId, { deleted: true })
    sors.has = await sorAt(laterId)
    const existing = await svc().from("costing_matrices").insert({ opportunity_id: sors.has }).select("id").single()
    if (existing.error) throw new Error(existing.error.message)
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.stageParticipant)
    await svc().from("notifications").delete().in("reference_id", sorIds)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_snapshots").delete().eq("flow_id", flowId)
    await svc().from("flow_stage_actions").delete().eq("id", actionId)
    await svc().from("flow_edges").delete().eq("flow_id", flowId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("dry run", () => {
    it("lists the SORs at or past the mounting stage, with why, and writes nothing", async () => {
        const { data, error } = await svc().rpc("costing_matrix_backfill", { p_dry_run: true })
        expect(error).toBeNull()
        const rows = mine(data)
        const byOpp = Object.fromEntries(rows.map((r) => [r.opportunity_id, r]))

        expect(Object.keys(byOpp).sort()).toEqual([sors.atMount, sors.later, sors.has].sort())
        expect(byOpp[sors.atMount].outcome).toBe("would_open")
        expect(byOpp[sors.atMount].reason).toMatch(/^At the stage/)
        expect(byOpp[sors.later].outcome).toBe("would_open")
        expect(byOpp[sors.later].reason).toMatch(/^Downstream/)
        expect(byOpp[sors.later].mounting_stage).toContain("Mount")
        expect(byOpp[sors.has].outcome).toBe("already_has_matrix")
        // Not upstream, not deleted.
        expect(byOpp[sors.upstream]).toBeUndefined()
        expect(byOpp[sors.deleted]).toBeUndefined()

        expect(await matricesOf(sors.atMount)).toHaveLength(0)
        expect(await matricesOf(sors.later)).toHaveLength(0)
    })

    it("is the default", async () => {
        const { data, error } = await svc().rpc("costing_matrix_backfill")
        expect(error).toBeNull()
        expect(mine(data).every((r) => r.outcome !== "opened")).toBe(true)
        expect(await matricesOf(sors.later)).toHaveLength(0)
    })
})

describe("who may run it", () => {
    it("refuses a signed-in employee and allows a Super Admin", async () => {
        const refused = await (await clientFor("dealOwner")).rpc("costing_matrix_backfill", { p_dry_run: true })
        expect(refused.error?.code).toBe("42501")

        const allowed = await (await clientFor("superAdmin")).rpc("costing_matrix_backfill", { p_dry_run: true })
        expect(allowed.error).toBeNull()
    })
})

describe("real run", () => {
    it("gives each listed SOR exactly one matrix with the action's config, and no other SOR", async () => {
        const { data, error } = await svc().rpc("costing_matrix_backfill", { p_dry_run: false })
        expect(error).toBeNull()
        const rows = mine(data)
        expect(
            rows
                .filter((r) => r.outcome === "opened")
                .map((r) => r.opportunity_id)
                .sort(),
        ).toEqual([sors.atMount, sors.later].sort())

        for (const key of ["atMount", "later"]) {
            const matrices = await matricesOf(sors[key])
            expect(matrices).toHaveLength(1)
            expect(matrices[0].purchasing_incharge_id).toBe(ids.stageParticipant)
            expect(matrices[0].sales_incharge_id).toBe(ids.dealOwner)
        }
        // The one that had a matrix is untouched; upstream and deleted get none.
        const had = await matricesOf(sors.has)
        expect(had).toHaveLength(1)
        expect(had[0].purchasing_incharge_id).toBeNull()
        expect(await matricesOf(sors.upstream)).toHaveLength(0)
        expect(await matricesOf(sors.deleted)).toHaveLength(0)
    })

    it("creates nothing the second time", async () => {
        const before = {}
        for (const key of Object.keys(sors)) before[key] = await matricesOf(sors[key])

        const { data, error } = await svc().rpc("costing_matrix_backfill", { p_dry_run: false })
        expect(error).toBeNull()
        expect(mine(data).every((r) => r.outcome === "already_has_matrix")).toBe(true)
        expect(mine(data)).toHaveLength(3)

        for (const key of Object.keys(sors)) expect(await matricesOf(sors[key])).toEqual(before[key])
    })
})
