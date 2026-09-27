/**
 * Issue #393 (parent #384, ADR 0027) — reverting a Return undoes its Start
 * fresh too: the earlier visit's cancelled work un-cancels, its closed-off
 * action runs reopen, and what the Start fresh itself created is cancelled
 * and closed off. Moves run as a signed-in user.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

let saleTypeId, flowId, stageA, stageB, actionId, conditionId, fieldId
const sorIds = []
const svc = () => serviceClient()

async function stage(name, sortOrder) {
    const { data, error } = await svc()
        .from("flow_stages")
        .insert({ flow_id: flowId, name: `${MARKER} ${name}`, sort_order: sortOrder })
        .select("id")
        .single()
    if (error) throw new Error(error.message)
    return data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    saleTypeId = (await svc().from("sale_types").insert({ name: `${MARKER} StartFreshRevert` }).select("id").single()).data.id
    flowId = (await svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()).data.id
    stageA = await stage("A", 10)
    stageB = await stage("B", 20)
    actionId = (await svc().from("flow_stage_actions").insert({ stage_id: stageA, kind: "create_individual_task" }).select("id").single()).data.id
    const cond = await svc().from("stage_conditions").insert({ stage_id: stageA, kind: "tickbox", label: `${MARKER} ok` }).select("id").single()
    if (cond.error) throw new Error(cond.error.message)
    conditionId = cond.data.id
    const f = await svc().from("flow_stage_fields").insert({ stage_id: stageA, label: `${MARKER} f`, source: "custom", field_type: "text" }).select("id").single()
    if (f.error) throw new Error(f.error.message)
    fieldId = f.data.id
})

afterAll(async () => {
    await svc().from("tasks").delete().in("opportunity_id", sorIds)
    await svc().from("committee_tasks").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("stage_conditions").delete().eq("id", conditionId)
    await svc().from("flow_stage_fields").delete().eq("id", fieldId)
    await svc().from("flow_stage_actions").delete().eq("id", actionId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

async function moveTo(sorId, stageId, who = "dealOwner") {
    const client = await clientFor(who)
    const { error } = await client.from("sales_opportunities").update({ flow_stage_id: stageId }).eq("id", sorId)
    if (error) throw new Error(error.message)
}

/** An SOR that did work on A, went to B, and Returned to A (visit 3). */
async function returned() {
    const id = await makeSor({
        registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, closingSalesId: ids.closingSales, saleTypeId, flowStageId: stageA,
    })
    sorIds.push(id)
    const visit1 = (await svc().from("sor_stage_visits").select("id").eq("opportunity_id", id).single()).data.id
    const mk = (status, extra = {}) =>
        svc().from("tasks")
            .insert({ logged_by: ids.closingSales, opportunity_id: id, stage_visit_id: visit1, stage_action_id: actionId, task_description: `${MARKER} t`, status, ...extra })
            .select("id").single().then((r) => r.data.id)
    const open = await mk("INCOMPLETE")
    const awaiting = await mk("AWAITING APPROVAL")
    const group = (await svc().from("committee_tasks")
        .insert({ title: `${MARKER} g`, created_by: ids.dealOwner, opportunity_id: id, stage_visit_id: visit1, stage_action_id: actionId, due_date: "2026-10-10T00:00:00Z" })
        .select("id").single()).data.id
    const done = await mk("COMPLETED")
    const run = (await svc().from("sor_action_runs")
        .insert({ opportunity_id: id, stage_id: stageA, action_id: actionId, stage_visit_id: visit1, outcome: "created", task_id: open })
        .select("id").single()).data.id
    await svc().from("sor_condition_status").insert({ opportunity_id: id, condition_id: conditionId, stage_visit_id: visit1, satisfied_by: ids.dealOwner })
    await svc().from("sor_stage_field_values").insert({ opportunity_id: id, stage_visit_id: visit1, field_id: fieldId, value: "kept" })
    await moveTo(id, stageB)
    const held = new Date(Date.now() - 2 * 86400000).toISOString()
    await svc().from("tasks").update({ held_at: held }).in("id", [open, awaiting])
    await svc().from("committee_tasks").update({ held_at: held }).eq("id", group)
    await moveTo(id, stageA)
    const visit3 = (await svc().from("sor_stage_visits").select("id").eq("opportunity_id", id).eq("sequence", 3).single()).data.id
    return { id, visit1, visit3, open, awaiting, done, group, run }
}

describe("reverting a Return undoes its Start fresh (ADR 0027)", () => {
    it("un-cancels the earlier visit's tasks back to their prior status and reopens its action runs", async () => {
        const s = await returned()
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_start_fresh_stage_work", { p_opportunity_id: s.id })).error).toBeNull()

        const { error } = await client.rpc("sor_revert_stage", { p_opportunity_id: s.id })
        expect(error).toBeNull()

        const open = (await svc().from("tasks").select("status, cancel_reason, held_prev_status, stage_visit_id").eq("id", s.open).single()).data
        expect(open).toEqual({ status: "INCOMPLETE", cancel_reason: null, held_prev_status: null, stage_visit_id: s.visit1 })

        const awaiting = (await svc().from("tasks").select("status, cancel_reason, held_prev_status").eq("id", s.awaiting).single()).data
        expect(awaiting).toEqual({ status: "AWAITING APPROVAL", cancel_reason: null, held_prev_status: null })

        const group = (await svc().from("committee_tasks").select("status, cancel_reason, held_prev_status").eq("id", s.group).single()).data
        expect(group).toEqual({ status: "ACTIVE", cancel_reason: null, held_prev_status: null })

        const done = (await svc().from("tasks").select("status, stage_visit_id").eq("id", s.done).single()).data
        expect(done).toEqual({ status: "COMPLETED", stage_visit_id: s.visit1 })

        const run = (await svc().from("sor_action_runs").select("closed_off_at, closed_off_reason, stage_visit_id").eq("id", s.run).single()).data
        expect(run).toEqual({ closed_off_at: null, closed_off_reason: null, stage_visit_id: s.visit1 })
    })

    it("still cancels and closes off what the Start fresh itself created on the reverted visit", async () => {
        const s = await returned()
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_start_fresh_stage_work", { p_opportunity_id: s.id })).error).toBeNull()

        const newTask = (await svc().from("tasks")
            .insert({ logged_by: ids.closingSales, opportunity_id: s.id, stage_visit_id: s.visit3, stage_action_id: actionId, task_description: `${MARKER} new`, status: "INCOMPLETE" })
            .select("id").single()).data.id
        const newRun = (await svc().from("sor_action_runs")
            .insert({ opportunity_id: s.id, stage_id: stageA, action_id: actionId, stage_visit_id: s.visit3, outcome: "created", task_id: newTask, decided_by: ids.dealOwner })
            .select("id").single()).data.id

        const { error } = await client.rpc("sor_revert_stage", { p_opportunity_id: s.id, p_progress_choice: "remove" })
        expect(error).toBeNull()

        const t = (await svc().from("tasks").select("status").eq("id", newTask).single()).data
        expect(t.status).toBe("DELETED")
        const r = (await svc().from("sor_action_runs").select("closed_off_at, closed_off_reason").eq("id", newRun).single()).data
        expect(r.closed_off_at).not.toBeNull()
        expect(r.closed_off_reason).toBe("reverted")

        // The earlier visit's own Start-fresh-cancelled work still un-cancels.
        const open = (await svc().from("tasks").select("status").eq("id", s.open).single()).data
        expect(open.status).toBe("INCOMPLETE")
    })

    it("composes with the keep-progress Revert path: v_cur's re-fired run stays live and the earlier one stays closed off", async () => {
        const s = await returned()
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_start_fresh_stage_work", { p_opportunity_id: s.id })).error).toBeNull()

        const newTask = (await svc().from("tasks")
            .insert({ logged_by: ids.closingSales, opportunity_id: s.id, stage_visit_id: s.visit3, stage_action_id: actionId, task_description: `${MARKER} new`, status: "INCOMPLETE" })
            .select("id").single()).data.id
        const newRun = (await svc().from("sor_action_runs")
            .insert({ opportunity_id: s.id, stage_id: stageA, action_id: actionId, stage_visit_id: s.visit3, outcome: "created", task_id: newTask, decided_by: ids.dealOwner })
            .select("id").single()).data.id

        const { error } = await client.rpc("sor_revert_stage", { p_opportunity_id: s.id, p_progress_choice: "keep" })
        expect(error).toBeNull()

        const t = (await svc().from("tasks").select("status").eq("id", newTask).single()).data
        expect(t.status).toBe("ON_HOLD")
        const r = (await svc().from("sor_action_runs").select("closed_off_at, closed_off_reason").eq("id", newRun).single()).data
        expect(r.closed_off_at).toBeNull()

        // The earlier visit's run stays closed off — its slot is occupied by the kept, still-live run.
        const oldRun = (await svc().from("sor_action_runs").select("closed_off_at, closed_off_reason").eq("id", s.run).single()).data
        expect(oldRun.closed_off_at).not.toBeNull()
        expect(oldRun.closed_off_reason).toBe("start_fresh")
    })

    it("composes with the no-Stage-Work Revert path (full undo)", async () => {
        const s = await returned()
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_start_fresh_stage_work", { p_opportunity_id: s.id })).error).toBeNull()

        const { error } = await client.rpc("sor_revert_stage", { p_opportunity_id: s.id })
        expect(error).toBeNull()

        const cur = (await svc().from("sor_stage_visits").select("undone_at").eq("id", s.visit3).single()).data
        expect(cur.undone_at).not.toBeNull()

        const open = (await svc().from("tasks").select("status, stage_visit_id").eq("id", s.open).single()).data
        expect(open).toEqual({ status: "INCOMPLETE", stage_visit_id: s.visit1 })
    })
})
