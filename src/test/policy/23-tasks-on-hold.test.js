/**
 * Issue #388 (parent #384) — tasks go on hold when the SOR leaves a Stage, and
 * are cancelled on reaching a Terminal Stage. Moves run as a signed-in user;
 * the service role only seeds the flow and reads back the evidence.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

let saleTypeId, flowId, stageA, stageB, stageTerminal, actionId
const sorIds = []
const svc = () => serviceClient()

async function stage(name, sortOrder, extra = {}) {
    const { data, error } = await svc()
        .from("flow_stages")
        .insert({ flow_id: flowId, name: `${MARKER} ${name}`, sort_order: sortOrder, ...extra })
        .select("id")
        .single()
    if (error) throw new Error(error.message)
    return data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    const st = await svc().from("sale_types").insert({ name: `${MARKER} Hold` }).select("id").single()
    saleTypeId = st.data.id
    flowId = (await svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()).data.id
    stageA = await stage("A", 10)
    stageB = await stage("B", 20)
    stageTerminal = await stage("Terminal", 30, { is_terminal: true })
    actionId = (await svc().from("flow_stage_actions").insert({ stage_id: stageA, kind: "create_individual_task" }).select("id").single()).data.id
})

afterAll(async () => {
    await svc().from("tasks").delete().in("opportunity_id", sorIds)
    await svc().from("committee_tasks").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stage_actions").delete().eq("id", actionId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

async function sorWithTasks() {
    const id = await makeSor({
        registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, closingSalesId: ids.closingSales, saleTypeId, flowStageId: stageA,
    })
    sorIds.push(id)
    const { data: visit } = await svc().from("sor_stage_visits").select("id").eq("opportunity_id", id).single()
    const mk = (status, extra = {}) =>
        svc().from("tasks")
            .insert({ logged_by: ids.closingSales, opportunity_id: id, stage_visit_id: visit.id, task_description: `${MARKER} t`, status, ...extra })
            .select("id").single().then((r) => r.data.id)
    return {
        id, visit: visit.id,
        open: await mk("INCOMPLETE", { stage_action_id: actionId }),
        done: await mk("COMPLETED", { stage_action_id: actionId }),
        manual: await mk("INCOMPLETE"),
    }
}

async function moveTo(sorId, stageId) {
    const client = await clientFor("dealOwner")
    const { error } = await client.from("sales_opportunities").update({ flow_stage_id: stageId }).eq("id", sorId)
    if (error) throw new Error(error.message)
}
const task = async (id) => (await svc().from("tasks").select("*").eq("id", id).single()).data

describe("tasks on hold", () => {
    it("puts open action-created tasks on hold when the Stage is left, recording when and from where", async () => {
        const s = await sorWithTasks()
        await moveTo(s.id, stageB)
        const held = await task(s.open)
        expect(held.status).toBe("ON_HOLD")
        expect(held.held_at).not.toBeNull()
        expect(held.held_from_visit_id).toBe(s.visit)
        expect((await task(s.done)).status).toBe("COMPLETED")
        expect((await task(s.manual)).status).toBe("INCOMPLETE")
    })

    it("holds group tasks too", async () => {
        const s = await sorWithTasks()
        const ct = await svc().from("committee_tasks")
            .insert({ title: `${MARKER} g`, created_by: ids.dealOwner, opportunity_id: s.id, stage_visit_id: s.visit, stage_action_id: actionId })
            .select("id").single()
        await moveTo(s.id, stageB)
        expect((await svc().from("committee_tasks").select("status").eq("id", ct.data.id).single()).data.status).toBe("ON_HOLD")
    })

    it("cancels every held task on entering a Terminal Stage, with a reason", async () => {
        const s = await sorWithTasks()
        await moveTo(s.id, stageB)
        await moveTo(s.id, stageTerminal)
        const t = await task(s.open)
        expect(t.status).toBe("DELETED")
        expect(t.cancel_reason).toMatch(/Terminal Stage/)
    })

    it("a Revert brings back what the reverted move held", async () => {
        const s = await sorWithTasks()
        await moveTo(s.id, stageB)
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_revert_stage", { p_opportunity_id: s.id })).error).toBeNull()
        const t = await task(s.open)
        expect(t.status).toBe("INCOMPLETE")
        expect(t.held_at).toBeNull()
    })
})
