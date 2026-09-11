/**
 * `restore_flow_snapshot` (issue #187) against real Postgres.
 *
 * The fake database in the rest of the suite does not run plpgsql, so the two
 * things this function exists to guarantee — that a restore keeps every id,
 * and that it writes nothing at all when a dropped Stage would strand an SOR —
 * are only provable here. `flow_stages.id` is ON DELETE RESTRICT from
 * `sales_opportunities.flow_stage_id`, and that foreign key sees soft-deleted
 * SORs too.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, ensureCastLoaded, clientFor } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()

let saleTypeId
let flowId
let stageIds = {}
let snapshotId

/** The shape `salesFlowService.lockFlow` stores in `flow_snapshots.snapshot_data`. */
async function snapshotOf(flow_id, wonStageId) {
    const { data: stages } = await svc()
        .from("flow_stages")
        .select("*")
        .eq("flow_id", flow_id)
        .order("sort_order", { ascending: true })
    const { data: edges } = await svc().from("flow_edges").select("*").eq("flow_id", flow_id)
    const stageIdList = stages.map((s) => s.id)
    const { data: actions } = await svc()
        .from("flow_stage_actions")
        .select("*")
        .in("stage_id", stageIdList)
    const { data: conditions } = await svc()
        .from("stage_conditions")
        .select("*")
        .in("stage_id", stageIdList)
    return { stages, edges, actions, conditions, wonStageId, saleTypeId }
}

beforeAll(async () => {
    await ensureCastLoaded()

    const saleType = await svc()
        .from("sale_types")
        .insert({ name: `${MARKER} Restore Tier` })
        .select("id")
        .single()
    if (saleType.error) throw new Error(saleType.error.message)
    saleTypeId = saleType.data.id

    const flow = await svc()
        .from("sales_flows")
        .insert({ sale_type_id: saleTypeId, state: "draft" })
        .select("id")
        .single()
    if (flow.error) throw new Error(flow.error.message)
    flowId = flow.data.id

    const stages = await svc()
        .from("flow_stages")
        .insert([
            { flow_id: flowId, name: `${MARKER} Lead`, sort_order: 0 },
            { flow_id: flowId, name: `${MARKER} Qualified`, sort_order: 1 },
            { flow_id: flowId, name: `${MARKER} Awarded`, sort_order: 2 },
        ])
        .select("id, name")
    if (stages.error) throw new Error(stages.error.message)
    for (const s of stages.data) stageIds[s.name.replace(`${MARKER} `, "")] = s.id

    await svc()
        .from("flow_edges")
        .insert([
            { flow_id: flowId, from_stage_id: stageIds.Lead, to_stage_id: stageIds.Qualified },
            { flow_id: flowId, from_stage_id: stageIds.Qualified, to_stage_id: stageIds.Awarded },
        ])
    await svc()
        .from("stage_conditions")
        .insert({ stage_id: stageIds.Lead, kind: "tickbox", label: `${MARKER} Brief signed` })
    await svc()
        .from("flow_stage_actions")
        .insert({ stage_id: stageIds.Qualified, kind: "create_individual_task" })
    await svc().from("sales_flows").update({ won_stage_id: stageIds.Awarded }).eq("id", flowId)

    const snap = await svc()
        .from("flow_snapshots")
        .insert({
            flow_id: flowId,
            version: 1,
            snapshot_data: await snapshotOf(flowId, stageIds.Awarded),
            created_by: ids.superAdmin,
        })
        .select("id")
        .single()
    if (snap.error) throw new Error(snap.error.message)
    snapshotId = snap.data.id
})

afterAll(async () => {
    await svc().from("flow_snapshots").delete().eq("flow_id", flowId)
    const { data: stages } = await svc().from("flow_stages").select("id").eq("flow_id", flowId)
    const stageIdList = (stages || []).map((s) => s.id)
    await svc().from("sales_opportunities").delete().eq("sale_type_id", saleTypeId)
    await svc().from("flow_edges").delete().eq("flow_id", flowId)
    await svc().from("stage_conditions").delete().in("stage_id", stageIdList)
    await svc().from("flow_stage_actions").delete().in("stage_id", stageIdList)
    await svc().from("sales_flows").update({ won_stage_id: null }).eq("id", flowId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

/** Reopen a draft and return it to exactly the seeded three-stage shape. */
async function resetToSeededDraft() {
    await svc().from("sales_flows").update({ state: "draft" }).eq("id", flowId)
    await svc().rpc("restore_flow_snapshot", {
        p_flow_id: flowId,
        p_snapshot_id: snapshotId,
    })
}

describe("restore_flow_snapshot", () => {
    it("keeps every Stage, move, Condition and Action id across a restore", async () => {
        const before = await snapshotOf(flowId, stageIds.Awarded)

        // Drift the draft: rename a Stage, delete another, add a new one.
        await svc()
            .from("flow_stages")
            .update({ name: `${MARKER} Renamed` })
            .eq("id", stageIds.Lead)
        await svc().from("flow_edges").delete().eq("flow_id", flowId)
        await svc().from("sales_flows").update({ won_stage_id: null }).eq("id", flowId)
        await svc().from("flow_stages").delete().eq("id", stageIds.Qualified)
        await svc()
            .from("flow_stages")
            .insert({ flow_id: flowId, name: `${MARKER} Intruder`, sort_order: 9 })

        // The RPC is SECURITY INVOKER, so this is the assertion an ordinary
        // signed-in employee — not the service role — can actually call it.
        const client = await clientFor("ordinary")
        const { error } = await client.rpc("restore_flow_snapshot", {
            p_flow_id: flowId,
            p_snapshot_id: snapshotId,
        })
        expect(error, error?.message).toBeNull()

        const after = await snapshotOf(flowId, stageIds.Awarded)
        expect(after.stages.map((s) => s.id).sort()).toEqual(before.stages.map((s) => s.id).sort())
        expect(after.stages.map((s) => s.name).sort()).toEqual(before.stages.map((s) => s.name).sort())
        expect(after.edges.map((e) => e.id).sort()).toEqual(before.edges.map((e) => e.id).sort())
        expect(after.actions.map((a) => a.id)).toEqual(before.actions.map((a) => a.id))
        expect(after.conditions.map((c) => c.id)).toEqual(before.conditions.map((c) => c.id))

        const { data: flow } = await svc()
            .from("sales_flows")
            .select("won_stage_id")
            .eq("id", flowId)
            .single()
        expect(flow.won_stage_id).toBe(stageIds.Awarded)
    })

    it("restores two Stages that have swapped names", async () => {
        await resetToSeededDraft()
        await svc().from("flow_stages").update({ name: `${MARKER} tmp` }).eq("id", stageIds.Lead)
        await svc().from("flow_stages").update({ name: `${MARKER} Lead` }).eq("id", stageIds.Qualified)
        await svc().from("flow_stages").update({ name: `${MARKER} Qualified` }).eq("id", stageIds.Lead)

        const client = await clientFor("ordinary")
        const { error } = await client.rpc("restore_flow_snapshot", {
            p_flow_id: flowId,
            p_snapshot_id: snapshotId,
        })
        expect(error, error?.message).toBeNull()

        const { data: stages } = await svc()
            .from("flow_stages")
            .select("id, name")
            .eq("flow_id", flowId)
        const byId = Object.fromEntries(stages.map((s) => [s.id, s.name]))
        expect(byId[stageIds.Lead]).toBe(`${MARKER} Lead`)
        expect(byId[stageIds.Qualified]).toBe(`${MARKER} Qualified`)
    })

    it("changes nothing when a dropped Stage still has an SOR on it — soft-deleted ones block too", async () => {
        await resetToSeededDraft()

        // A snapshot that no longer has the Qualified Stage.
        await svc().from("flow_stages").update({ name: `${MARKER} Two Stage tmp` }).eq("id", stageIds.Lead)
        await svc().from("sales_flows").update({ won_stage_id: null }).eq("id", flowId)
        await svc().from("flow_stages").update({ name: `${MARKER} Lead` }).eq("id", stageIds.Lead)
        const twoStageSnap = await svc()
            .from("flow_snapshots")
            .insert({
                flow_id: flowId,
                version: 99,
                snapshot_data: {
                    stages: [
                        { id: stageIds.Lead, name: `${MARKER} Lead`, sort_order: 0 },
                        { id: stageIds.Awarded, name: `${MARKER} Awarded`, sort_order: 1 },
                    ],
                    edges: [],
                    actions: [],
                    conditions: [],
                    wonStageId: stageIds.Awarded,
                },
                created_by: ids.superAdmin,
            })
            .select("id")
            .single()
        await svc().from("sales_flows").update({ won_stage_id: stageIds.Awarded }).eq("id", flowId)

        // Park a *soft-deleted* SOR on Qualified.
        const sor = await svc()
            .from("sales_opportunities")
            .insert({
                registered_by: ids.dealOwner,
                lead_source: "REFERRAL",
                client_name: `${MARKER} Blocker`,
                project_title: `${MARKER} Blocker`,
                expected_value: 1000,
                status: "LEAD",
                sale_type_id: saleTypeId,
                flow_stage_id: stageIds.Qualified,
                is_deleted: true,
            })
            .select("id")
            .single()
        if (sor.error) throw new Error(sor.error.message)

        const stagesBefore = await svc()
            .from("flow_stages")
            .select("id, name")
            .eq("flow_id", flowId)
            .order("sort_order")

        const client = await clientFor("ordinary")
        const { error } = await client.rpc("restore_flow_snapshot", {
            p_flow_id: flowId,
            p_snapshot_id: twoStageSnap.data.id,
        })
        expect(error).not.toBeNull()
        expect(error.message).toMatch(/Qualified.*soft-deleted/)

        const stagesAfter = await svc()
            .from("flow_stages")
            .select("id, name")
            .eq("flow_id", flowId)
            .order("sort_order")
        expect(stagesAfter.data).toEqual(stagesBefore.data)

        await svc().from("sales_opportunities").delete().eq("id", sor.data.id)
        await svc().from("flow_snapshots").delete().eq("id", twoStageSnap.data.id)
    })

    it("is refused on a published (locked) Sales Flow", async () => {
        await resetToSeededDraft()
        await svc().from("sales_flows").update({ state: "locked" }).eq("id", flowId)

        const client = await clientFor("ordinary")
        const { error } = await client.rpc("restore_flow_snapshot", {
            p_flow_id: flowId,
            p_snapshot_id: snapshotId,
        })
        expect(error).not.toBeNull()
        expect(error.message).toMatch(/locked/i)

        await svc().from("sales_flows").update({ state: "draft" }).eq("id", flowId)
    })
})
