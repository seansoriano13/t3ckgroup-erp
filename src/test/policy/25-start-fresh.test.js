/**
 * Issue #391 (parent #384) — a Return's Start fresh closes off the earlier
 * visit's Stage Work instead of moving it: live/held tasks are cancelled,
 * action runs are closed off, and ticks/files/field values stay put. Moves
 * run as a signed-in user.
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
    saleTypeId = (await svc().from("sale_types").insert({ name: `${MARKER} StartFresh` }).select("id").single()).data.id
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
    // Held for two days.
    const held = new Date(Date.now() - 2 * 86400000).toISOString()
    await svc().from("tasks").update({ held_at: held }).eq("id", open)
    await svc().from("committee_tasks").update({ held_at: held }).eq("id", group)
    await moveTo(id, stageA)
    const visit3 = (await svc().from("sor_stage_visits").select("id").eq("opportunity_id", id).eq("sequence", 3).single()).data.id
    return { id, visit1, visit3, open, done, group, run }
}

describe("sor_start_fresh_stage_work", () => {
    it("cancels the earlier visit's live/held tasks and closes off its action runs, leaving ticks/files/field values in place", async () => {
        const s = await returned()
        const client = await clientFor("dealOwner")
        const { data, error } = await client.rpc("sor_start_fresh_stage_work", { p_opportunity_id: s.id })
        expect(error).toBeNull()
        expect(data.return_choice).toBe("start_fresh")

        const open = (await svc().from("tasks").select("status, cancel_reason, stage_visit_id").eq("id", s.open).single()).data
        expect(open.status).toBe("DELETED")
        expect(open.cancel_reason).toBe("Superseded by a fresh start.")
        expect(open.stage_visit_id).toBe(s.visit1)

        const done = (await svc().from("tasks").select("status, stage_visit_id").eq("id", s.done).single()).data
        expect(done).toEqual({ status: "COMPLETED", stage_visit_id: s.visit1 })

        const run = (await svc().from("sor_action_runs").select("closed_off_at, closed_off_reason, stage_visit_id").eq("id", s.run).single()).data
        expect(run.closed_off_at).not.toBeNull()
        expect(run.closed_off_reason).toBe("start_fresh")
        expect(run.stage_visit_id).toBe(s.visit1)

        const cond = await svc().from("sor_condition_status").select("stage_visit_id").eq("opportunity_id", s.id)
        expect(cond.data).toEqual([{ stage_visit_id: s.visit1 }])
        const field = await svc().from("sor_stage_field_values").select("stage_visit_id").eq("opportunity_id", s.id)
        expect(field.data).toEqual([{ stage_visit_id: s.visit1 }])
    })

    it("cancels a held Group Task the same way", async () => {
        const s = await returned()
        const group = (await svc().from("committee_tasks").select("id").eq("opportunity_id", s.id).single()).data.id
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_start_fresh_stage_work", { p_opportunity_id: s.id })).error).toBeNull()
        const row = (await svc().from("committee_tasks").select("status, cancel_reason").eq("id", group).single()).data
        expect(row.status).toBe("CANCELLED")
        expect(row.cancel_reason).toBe("Superseded by a fresh start.")
    })

    it("refuses when the SOR is not on a Return", async () => {
        const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageA })
        sorIds.push(id)
        const client = await clientFor("dealOwner")
        const { error } = await client.rpc("sor_start_fresh_stage_work", { p_opportunity_id: id })
        expect(error?.message).toMatch(/not a Return/)
    })

    it("refuses someone who did not make the move", async () => {
        const s = await returned()
        const client = await clientFor("closingSales")
        const { error } = await client.rpc("sor_start_fresh_stage_work", { p_opportunity_id: s.id })
        expect(error?.message).toMatch(/only whoever made the move/)
    })

    it("refuses a second choice on the same visit", async () => {
        const s = await returned()
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_start_fresh_stage_work", { p_opportunity_id: s.id })).error).toBeNull()
        expect((await client.rpc("sor_start_fresh_stage_work", { p_opportunity_id: s.id })).error?.message).toMatch(/already recorded/)
    })

    it("lets the Stage's action fire again once the earlier run is closed off", async () => {
        const s = await returned()
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_start_fresh_stage_work", { p_opportunity_id: s.id })).error).toBeNull()

        const { data: run, error } = await client.rpc("sor_begin_action_run", {
            p_opportunity_id: s.id, p_stage_id: stageA, p_action_id: actionId, p_stage_visit_id: s.visit3,
        })
        expect(error).toBeNull()
        const row = Array.isArray(run) ? run[0] : run
        expect(row.outcome).toBe("pending")
        expect(row.stage_visit_id).toBe(s.visit3)
        expect(row.id).not.toBe(s.run)
    })
})

describe("sor_move_and_start_fresh", () => {
    it("moves and starts fresh in one call", async () => {
        const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageA })
        sorIds.push(id)
        await moveTo(id, stageB)
        const client = await clientFor("dealOwner")
        const { data, error } = await client.rpc("sor_move_and_start_fresh", { p_opportunity_id: id, p_flow_stage_id: stageA })
        expect(error).toBeNull()
        expect(data.return_choice).toBe("start_fresh")
        expect((await svc().from("sales_opportunities").select("flow_stage_id").eq("id", id).single()).data.flow_stage_id).toBe(stageA)
    })

    it("leaves the SOR where it was when Start fresh is refused (not a Return)", async () => {
        const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageA })
        sorIds.push(id)
        const client = await clientFor("dealOwner")
        const { error } = await client.rpc("sor_move_and_start_fresh", { p_opportunity_id: id, p_flow_stage_id: stageB })
        expect(error?.message).toMatch(/not a Return/)
        expect((await svc().from("sales_opportunities").select("flow_stage_id").eq("id", id).single()).data.flow_stage_id).toBe(stageA)
    })
})
