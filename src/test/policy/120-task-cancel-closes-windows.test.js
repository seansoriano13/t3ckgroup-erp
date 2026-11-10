/** Issue #652 -- cancelling a Stage Action task closes its access windows. */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
let saleTypeId, flowId, stageId, actionId, otherActionId, sorId, visitId

beforeAll(async () => {
    await ensureCastLoaded()
    const st = await svc().from("sale_types").insert({ name: `${MARKER} 652` }).select("id").single()
    saleTypeId = st.data.id
    flowId = (await svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()).data.id
    stageId = (await svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} S`, sort_order: 10 }).select("id").single()).data.id
    actionId = (await svc().from("flow_stage_actions").insert({ stage_id: stageId, kind: "create_individual_task" }).select("id").single()).data.id
    otherActionId = (await svc().from("flow_stage_actions").insert({ stage_id: stageId, kind: "create_individual_task" }).select("id").single()).data.id
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    visitId = (await svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).limit(1).single()).data.id
})

afterAll(async () => {
    await svc().from("sor_stage_participants").delete().eq("opportunity_id", sorId)
    await svc().from("tasks").delete().eq("opportunity_id", sorId)
    await svc().from("committee_tasks").delete().eq("opportunity_id", sorId)
    await svc().from("sales_opportunities").delete().eq("id", sorId)
    await svc().from("flow_stage_actions").delete().in("id", [actionId, otherActionId])
    await svc().from("flow_stages").delete().eq("id", stageId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

const openWindow = (source_id, source = "action") =>
    svc().from("sor_stage_participants")
        .insert({ opportunity_id: sorId, employee_id: ids.support, source, source_id, opened_visit_id: visitId, until_rule: "terminal" })
        .select("id").single().then((r) => r.data.id)
const makeTask = (stage_action_id) =>
    svc().from("tasks")
        .insert({ task_description: `${MARKER} t`, logged_by: ids.support, status: "INCOMPLETE", opportunity_id: sorId, stage_action_id, stage_visit_id: visitId })
        .select("id").single().then((r) => r.data.id)
const windowRow = (id) => svc().from("sor_stage_participants").select("closed_at, closed_reason").eq("id", id).single().then((r) => r.data)

describe("cancelling a Stage Action task", () => {
    it("closes the assignee's matching window with reason task_cancelled", async () => {
        const w = await openWindow(actionId)
        const t = await makeTask(actionId)
        await svc().from("tasks").update({ status: "DELETED" }).eq("id", t)
        const row = await windowRow(w)
        expect(row.closed_at).not.toBeNull()
        expect(row.closed_reason).toBe("task_cancelled")
    })

    it("leaves windows opened by something else open", async () => {
        const fromOther = await openWindow(otherActionId)
        const mention = await openWindow(null, "assignment")
        const t = await makeTask(actionId)
        await svc().from("tasks").update({ status: "DELETED" }).eq("id", t)
        expect((await windowRow(fromOther)).closed_at).toBeNull()
        expect((await windowRow(mention)).closed_at).toBeNull()
    })

    it("refuses a client calling the close function directly", async () => {
        const client = await clientFor("support")
        const { error } = await client.rpc("close_windows_for_cancelled_stage_task", {
            p_opportunity_id: sorId, p_action_id: actionId, p_visit_id: visitId, p_employee_ids: [ids.support],
        })
        expect(error).not.toBeNull()
    })

    it("keeps a window open while another live task from the same call-in still holds it", async () => {
        const w = await openWindow(actionId)
        const t1 = await makeTask(actionId)
        await makeTask(actionId)
        await svc().from("tasks").update({ status: "DELETED" }).eq("id", t1)
        expect((await windowRow(w)).closed_at).toBeNull()
    })
})

describe("cancelling a Stage Action Group Task", () => {
    // Earlier tests leave live personal tasks on the same call-in, which rightly hold the window open.
    beforeEach(async () => {
        await svc().from("tasks").delete().eq("opportunity_id", sorId)
        await svc().from("committee_tasks").delete().eq("opportunity_id", sorId)
    })

    const makeGroupTask = async () => {
        const id = (await svc().from("committee_tasks")
            .insert({ title: `${MARKER} g`, created_by: ids.dealOwner, status: "ACTIVE", opportunity_id: sorId, stage_action_id: actionId, stage_visit_id: visitId })
            .select("id").single()).data.id
        await svc().from("committee_task_members").insert({ committee_task_id: id, employee_id: ids.support, task_description: "" })
        return id
    }

    it("closes each member's matching window", async () => {
        const w = await openWindow(actionId)
        const g = await makeGroupTask()
        await svc().from("committee_tasks").update({ status: "CANCELLED", cancel_reason: "test" }).eq("id", g)
        const row = await windowRow(w)
        expect(row.closed_at).not.toBeNull()
        expect(row.closed_reason).toBe("task_cancelled")
    })

    it("keeps the window when another live Group Task from the same call-in holds it", async () => {
        const w = await openWindow(actionId)
        const g1 = await makeGroupTask()
        await makeGroupTask()
        await svc().from("committee_tasks").update({ status: "CANCELLED", cancel_reason: "test" }).eq("id", g1)
        expect((await windowRow(w)).closed_at).toBeNull()
    })
})
