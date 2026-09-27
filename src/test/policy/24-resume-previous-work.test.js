/**
 * Issue #390 (parent #384, ADR 0027) — a Return's Resume moves the earlier
 * visit's Stage Work to the new visit. Moves run as a signed-in user.
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
    saleTypeId = (await svc().from("sale_types").insert({ name: `${MARKER} Resume` }).select("id").single()).data.id
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
    const open = await mk("INCOMPLETE", { end_at: "2026-10-10T00:00:00Z" })
    const done = await mk("COMPLETED")
    await svc().from("sor_condition_status").insert({ opportunity_id: id, condition_id: conditionId, stage_visit_id: visit1, satisfied_by: ids.dealOwner })
    await svc().from("sor_stage_field_values").insert({ opportunity_id: id, stage_visit_id: visit1, field_id: fieldId, value: "kept" })
    await svc().from("sales_opportunity_logs").insert({
        opportunity_id: id, author_id: ids.dealOwner, type: "SYSTEM", content: "Follow-up",
        metadata: { event: "FOLLOW_UP_LOGGED", stageVisitId: visit1 },
    })
    await moveTo(id, stageB)
    // Held for two days.
    const held = new Date(Date.now() - 2 * 86400000).toISOString()
    await svc().from("tasks").update({ held_at: held }).eq("id", open)
    await moveTo(id, stageA)
    const visit3 = (await svc().from("sor_stage_visits").select("id").eq("opportunity_id", id).eq("sequence", 3).single()).data.id
    return { id, visit1, visit3, open, done }
}

describe("sor_resume_stage_work", () => {
    it("moves the earlier visit's Stage Work to the new visit, reopening held tasks with due dates pushed back", async () => {
        const s = await returned()
        const client = await clientFor("dealOwner")
        const { data, error } = await client.rpc("sor_resume_stage_work", { p_opportunity_id: s.id })
        expect(error).toBeNull()
        expect(data.return_choice).toBe("resume")

        const t = (await svc().from("tasks").select("*").eq("id", s.open).single()).data
        expect(t.status).toBe("INCOMPLETE")
        expect(t.held_at).toBeNull()
        expect(t.stage_visit_id).toBe(s.visit3)
        expect(t.carried_from_visit_id).toBe(s.visit1)
        const shiftDays = (new Date(t.end_at) - new Date("2026-10-10T00:00:00Z")) / 86400000
        expect(shiftDays).toBeGreaterThan(1.99)
        expect(shiftDays).toBeLessThan(2.1)
        expect((await svc().from("tasks").select("stage_visit_id").eq("id", s.done).single()).data.stage_visit_id).toBe(s.visit3)

        const cond = await svc().from("sor_condition_status").select("stage_visit_id, satisfied_by").eq("opportunity_id", s.id)
        expect(cond.data).toEqual([{ stage_visit_id: s.visit3, satisfied_by: ids.dealOwner }])
        const field = await svc().from("sor_stage_field_values").select("stage_visit_id, value").eq("opportunity_id", s.id)
        expect(field.data).toEqual([{ stage_visit_id: s.visit3, value: "kept" }])
        const log = await svc().from("sales_opportunity_logs").select("stage_visit_id, metadata").eq("opportunity_id", s.id).eq("metadata->>event", "FOLLOW_UP_LOGGED").single()
        expect(log.data.stage_visit_id).toBe(s.visit3)
        expect(log.data.metadata.stageVisitId).toBe(s.visit3)

        const earlier = (await svc().from("sor_stage_visits").select("*").eq("id", s.visit1).single()).data
        expect(earlier.resumed_at).not.toBeNull()
        expect(earlier.resumed_by).toBe(ids.dealOwner)
        expect(earlier.resumed_into_visit_id).toBe(s.visit3)
    })

    it("refuses when the SOR is not on a Return", async () => {
        const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageA })
        sorIds.push(id)
        const client = await clientFor("dealOwner")
        const { error } = await client.rpc("sor_resume_stage_work", { p_opportunity_id: id })
        expect(error?.message).toMatch(/not a Return/)
    })

    it("refuses someone who did not make the move", async () => {
        const s = await returned()
        const client = await clientFor("closingSales")
        const { error } = await client.rpc("sor_resume_stage_work", { p_opportunity_id: s.id })
        expect(error?.message).toMatch(/only whoever made the move/)
    })

    it("refuses a second choice on the same visit", async () => {
        const s = await returned()
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_resume_stage_work", { p_opportunity_id: s.id })).error).toBeNull()
        expect((await client.rpc("sor_resume_stage_work", { p_opportunity_id: s.id })).error?.message).toMatch(/already recorded/)
    })
})
