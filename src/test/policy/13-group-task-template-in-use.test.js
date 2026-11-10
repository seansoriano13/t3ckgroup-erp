/**
 * Issue #933 — a Group Task template that a Stage Action uses can't be deleted,
 * against real Postgres. Unused templates still delete.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId, usedId, unusedId

beforeAll(async () => {
    await ensureCastLoaded()

    const tpl = await svc()
        .from("group_task_templates")
        .insert([
            { name: `${MARKER} In use`, created_by: ids.superAdmin },
            { name: `${MARKER} Unused`, created_by: ids.superAdmin },
        ])
        .select("id, name")
    if (tpl.error) throw new Error(tpl.error.message)
    usedId = tpl.data.find((t) => t.name.endsWith("In use")).id
    unusedId = tpl.data.find((t) => t.name.endsWith("Unused")).id

    const st = await svc().from("sale_types").insert({ name: `${MARKER} Template Sale Type` }).select("id").single()
    if (st.error) throw new Error(st.error.message)
    saleTypeId = st.data.id
    const flow = await svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()
    if (flow.error) throw new Error(flow.error.message)
    flowId = flow.data.id
    const stage = await svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Kickoff`, sort_order: 10 }).select("id").single()
    if (stage.error) throw new Error(stage.error.message)
    stageId = stage.data.id
    const action = await svc()
        .from("flow_stage_actions")
        .insert({ stage_id: stageId, kind: "create_group_task", config: { templateId: usedId } })
    if (action.error) throw new Error(action.error.message)
})

afterAll(async () => {
    await svc().from("flow_stage_actions").delete().eq("stage_id", stageId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
    await svc().from("group_task_templates").delete().like("name", `${MARKER}%`)
})

describe("group task template in use", () => {
    it("refuses deleting a template a Stage Action uses, naming the flow and stage", async () => {
        const res = await svc().from("group_task_templates").delete().eq("id", usedId).select("id")
        expect(res.error).not.toBeNull()
        expect(res.error.message).toContain(`${MARKER} Template Sale Type > ${MARKER} Kickoff`)
        const still = await svc().from("group_task_templates").select("id").eq("id", usedId)
        expect(still.data).toHaveLength(1)
    })

    it("deletes a template nothing uses", async () => {
        const res = await svc().from("group_task_templates").delete().eq("id", unusedId).select("id")
        expect(res.error).toBeNull()
        expect(res.data).toHaveLength(1)
    })
})
