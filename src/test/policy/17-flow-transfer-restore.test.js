/**
 * Issue #331 (release/2026-09) — restoring a Flow Snapshot into a Sales Flow
 * that has no Stages builds the whole graph, ids kept.
 *
 * This is the production end of the release transfer: the Government and
 * Outright snapshots arrive in an empty flow, and `restore_flow_snapshot` is
 * the only thing that turns the payload back into Stages, edges, Stage
 * Actions, Stage Conditions, Stage Fields, form fields and Follow-ups.
 *
 * To get "ids kept" with no clash, the source flow is built, its snapshot
 * payload captured, and then the source is torn down before the restore, the
 * same as the ids arriving from another database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()

let saleTypeId
let flowId
let snapshotId
const source = {}

async function one(query, what) {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

beforeAll(async () => {
    await ensureCastLoaded()

    // ── the source flow ────────────────────────────────────────────────────
    const sourceType = await one(svc().from("sale_types").insert({ name: `${MARKER} Transfer Source` }).select("id").single(), "Seeding the source Sale Type")
    const sourceFlow = await one(svc().from("sales_flows").insert({ sale_type_id: sourceType.id }).select("id").single(), "Seeding the source flow")

    source.stages = await one(
        svc()
            .from("flow_stages")
            .insert([
                { flow_id: sourceFlow.id, name: `${MARKER} Canvass`, sort_order: 0 },
                { flow_id: sourceFlow.id, name: `${MARKER} Bid`, sort_order: 1 },
                { flow_id: sourceFlow.id, name: `${MARKER} Won`, sort_order: 2, is_terminal: true },
            ])
            .select("*"),
        "Seeding Stages",
    )
    const [canvass, bid, won] = source.stages
    source.edges = await one(
        svc()
            .from("flow_edges")
            .insert([
                { flow_id: sourceFlow.id, from_stage_id: canvass.id, to_stage_id: bid.id },
                { flow_id: sourceFlow.id, from_stage_id: bid.id, to_stage_id: won.id },
            ])
            .select("*"),
        "Seeding edges",
    )
    source.actions = await one(svc().from("flow_stage_actions").insert({ stage_id: bid.id, kind: "create_individual_task" }).select("*"), "Seeding an action")
    source.conditions = await one(svc().from("stage_conditions").insert({ stage_id: canvass.id, kind: "tickbox", label: `${MARKER} Specs received` }).select("*"), "Seeding a condition")
    source.stageFields = await one(
        svc()
            .from("flow_stage_fields")
            .insert({ stage_id: bid.id, label: `${MARKER} Bid bond no.`, source: "custom", field_type: "text" })
            .select("*"),
        "Seeding a Stage Field",
    )
    source.formFields = await one(
        svc()
            .from("flow_form_fields")
            .insert({ flow_id: sourceFlow.id, source: "custom", label: `${MARKER} Agency`, field_type: "text", is_required: false })
            .select("*"),
        "Seeding a form field",
    )
    const followUpRow = await one(
        svc()
            .from("flow_stage_follow_ups")
            .insert({ stage_id: bid.id, enabled: true, every_days: 3, recipients: [{ type: "employee", id: ids.dealOwner }], proof_required: false })
            .select("*")
            .single(),
        "Seeding a Follow-up Cadence",
    )
    // followUpService's shape, keyed by Stage id — what a publish stores.
    source.followUps = [{
        id: bid.id,
        stageId: bid.id,
        enabled: followUpRow.enabled,
        everyDays: followUpRow.every_days,
        recipients: followUpRow.recipients,
        proofRequired: followUpRow.proof_required,
    }]

    const snapshotData = {
        stages: source.stages,
        edges: source.edges,
        actions: source.actions,
        conditions: source.conditions,
        stageFields: source.stageFields,
        formFields: source.formFields,
        followUps: source.followUps,
        access: { flow: null, stages: [] },
        wonStageId: won.id,
        saleTypeId: sourceType.id,
    }

    // ── tear the source down, as if it lived in another database ───────────
    const stageIdList = source.stages.map((s) => s.id)
    await svc().from("flow_stage_follow_ups").delete().in("stage_id", stageIdList)
    await svc().from("flow_stage_fields").delete().in("stage_id", stageIdList)
    await svc().from("flow_form_fields").delete().eq("flow_id", sourceFlow.id)
    await svc().from("stage_conditions").delete().in("stage_id", stageIdList)
    await svc().from("flow_stage_actions").delete().in("stage_id", stageIdList)
    await svc().from("flow_edges").delete().eq("flow_id", sourceFlow.id)
    await svc().from("flow_stages").delete().eq("flow_id", sourceFlow.id)
    await svc().from("sales_flows").delete().eq("id", sourceFlow.id)
    await svc().from("sale_types").delete().eq("id", sourceType.id)

    // ── the empty target flow, and the snapshot row carried across ─────────
    saleTypeId = (await one(svc().from("sale_types").insert({ name: `${MARKER} Transfer Target` }).select("id").single(), "Seeding the target Sale Type")).id
    flowId = (await one(svc().from("sales_flows").insert({ sale_type_id: saleTypeId, state: "draft" }).select("id").single(), "Seeding the target flow")).id
    snapshotId = (await one(
        svc().from("flow_snapshots").insert({ flow_id: flowId, version: 1, snapshot_data: snapshotData, created_by: ids.superAdmin }).select("id").single(),
        "Carrying the snapshot",
    )).id

    const { error } = await svc().rpc("restore_flow_snapshot", { p_flow_id: flowId, p_snapshot_id: snapshotId })
    if (error) throw new Error(`Restoring: ${error.message}`)
})

afterAll(async () => {
    const { data: stages } = await svc().from("flow_stages").select("id").eq("flow_id", flowId)
    const stageIdList = (stages || []).map((s) => s.id)
    await svc().from("flow_snapshots").delete().eq("flow_id", flowId)
    await svc().from("flow_stage_follow_ups").delete().in("stage_id", stageIdList)
    await svc().from("flow_stage_fields").delete().in("stage_id", stageIdList)
    await svc().from("flow_form_fields").delete().eq("flow_id", flowId)
    await svc().from("stage_conditions").delete().in("stage_id", stageIdList)
    await svc().from("flow_stage_actions").delete().in("stage_id", stageIdList)
    await svc().from("flow_edges").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").update({ won_stage_id: null }).eq("id", flowId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

const idsOf = (rows) => rows.map((r) => r.id).sort()

describe("restoring a snapshot into a Sales Flow with no Stages", () => {
    it("builds every Stage and edge under its original id", async () => {
        const stages = await one(svc().from("flow_stages").select("id, name").eq("flow_id", flowId), "Reading Stages")
        const edges = await one(svc().from("flow_edges").select("id").eq("flow_id", flowId), "Reading edges")
        expect(idsOf(stages)).toEqual(idsOf(source.stages))
        expect(idsOf(edges)).toEqual(idsOf(source.edges))
    })

    it("builds the Stage Actions and Stage Conditions under their original ids", async () => {
        const stageIdList = source.stages.map((s) => s.id)
        const actions = await one(svc().from("flow_stage_actions").select("id").in("stage_id", stageIdList), "Reading actions")
        const conditions = await one(svc().from("stage_conditions").select("id").in("stage_id", stageIdList), "Reading conditions")
        expect(idsOf(actions)).toEqual(idsOf(source.actions))
        expect(idsOf(conditions)).toEqual(idsOf(source.conditions))
    })

    it("builds the Stage Fields and registration form fields under their original ids", async () => {
        const stageIdList = source.stages.map((s) => s.id)
        const fields = await one(svc().from("flow_stage_fields").select("id, label").in("stage_id", stageIdList), "Reading Stage Fields")
        const formFields = await one(svc().from("flow_form_fields").select("id, label").eq("flow_id", flowId), "Reading form fields")
        expect(idsOf(fields)).toEqual(idsOf(source.stageFields))
        expect(idsOf(formFields)).toEqual(idsOf(source.formFields))
    })

    it("builds the Follow-up Cadence with its settings", async () => {
        const stageIdList = source.stages.map((s) => s.id)
        const rows = await one(svc().from("flow_stage_follow_ups").select("*").in("stage_id", stageIdList), "Reading follow-ups")
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
            stage_id: source.followUps[0].id,
            enabled: true,
            every_days: 3,
            proof_required: false,
            recipients: [{ type: "employee", id: ids.dealOwner }],
        })
    })

    it("sets the Won Stage and leaves no access configuration", async () => {
        const flow = await one(svc().from("sales_flows").select("won_stage_id").eq("id", flowId).single(), "Reading the flow")
        expect(flow.won_stage_id).toBe(source.stages[2].id)
        const access = await one(svc().from("flow_access_settings").select("flow_id").eq("flow_id", flowId), "Reading access")
        expect(access).toHaveLength(0)
    })
})
