/**
 * Issue #378 (part of #377) — the Everyone selector in Always sees.
 *
 * Flow A's Always sees is [{ type: "everyone" }]; flow B's is empty. Assertions
 * run as real cast members. "Move their Stages" is checked through
 * `sor_update`, the same policy Always sees already feeds.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { canRead } from "./support/access.js"

let saleTypeIds = []
let flowIds = []
let stageIds = [] // [flowA s1, flowA s2, flowB s1]
let sorA
let sorB
let lateHireId

async function seedFlow(label, alwaysSees) {
    const svc = serviceClient()
    const saleType = await svc
        .from("sale_types")
        .insert({ name: `${MARKER} Everyone ${label} Sale Type` })
        .select("id")
        .single()
    if (saleType.error) throw new Error(saleType.error.message)
    saleTypeIds.push(saleType.data.id)

    const flow = await svc.from("sales_flows").insert({ sale_type_id: saleType.data.id }).select("id").single()
    if (flow.error) throw new Error(flow.error.message)
    flowIds.push(flow.data.id)

    const stages = []
    for (const i of label === "A" ? [1, 2] : [1]) {
        const stage = await svc
            .from("flow_stages")
            .insert({ flow_id: flow.data.id, name: `${MARKER} Everyone ${label}${i}`, sort_order: i * 10 })
            .select("id")
            .single()
        if (stage.error) throw new Error(stage.error.message)
        stages.push(stage.data.id)
        stageIds.push(stage.data.id)
    }

    const access = await svc.from("flow_access_settings").insert({ flow_id: flow.data.id, always_sees: alwaysSees })
    if (access.error) throw new Error(access.error.message)
    return { saleTypeId: saleType.data.id, stages, flowId: flow.data.id }
}

beforeAll(async () => {
    await ensureCastLoaded()
    const a = await seedFlow("A", [{ type: "everyone" }])
    const b = await seedFlow("B", [])
    sorA = await makeSor({
        registeredBy: ids.dealOwner,
        saleTypeId: a.saleTypeId,
        flowStageId: a.stages[0],
        companyName: `${MARKER} Everyone A Company`,
    })
    sorB = await makeSor({
        registeredBy: ids.dealOwner,
        saleTypeId: b.saleTypeId,
        flowStageId: b.stages[0],
        companyName: `${MARKER} Everyone B Company`,
    })
})

afterAll(async () => {
    const svc = serviceClient()
    if (lateHireId) await svc.from("employees").delete().eq("id", lateHireId)
    await svc.from("sales_opportunities").delete().in("id", [sorA, sorB])
    await svc.from("flow_access_settings").delete().in("flow_id", flowIds)
    await svc.from("flow_stages").delete().in("flow_id", flowIds)
    await svc.from("sales_flows").delete().in("id", flowIds)
    await svc.from("sale_types").delete().in("id", saleTypeIds)
})

describe("Always sees = Everyone", () => {
    // outsider: Operations, not on the Deal Team. hr: no sub-department.
    it.each(["outsider", "hr"])("%s reads the flow's SOR", async (key) => {
        expect(await canRead(await clientFor(key), "sales_opportunities", sorA)).toBe(true)
    })

    it.each(["outsider", "hr"])("%s reads nothing on a flow whose Always sees is empty", async (key) => {
        expect(await canRead(await clientFor(key), "sales_opportunities", sorB)).toBe(false)
    })

    it("an employee outside the Deal Team can move the SOR's Stage", async () => {
        const client = await clientFor("outsider")
        const { data, error } = await client
            .from("sales_opportunities")
            .update({ flow_stage_id: stageIds[1] })
            .eq("id", sorA)
            .select("id")
        expect(error).toBeNull()
        expect(data.length).toBe(1)
    })

    it("an employee hired after the setting was saved is covered; a deleted one is not", async () => {
        const { rows: hired } = await sql().query(
            `insert into public.employees (email, name, department, role, employment_status)
             values ($1, $2, 'SALES', 'SALES EXECUTIVE', 'Regular') returning id`,
            [`late-hire@policy-tier.invalid`, `${MARKER} Late Hire`],
        )
        lateHireId = hired[0].id
        const covers = async (employeeId) =>
            (
                await sql().query(
                    `select public.sor_always_sees(o, $1) as sees from public.sales_opportunities o where o.id = $2`,
                    [employeeId, sorA],
                )
            ).rows[0].sees
        expect(await covers(lateHireId)).toBe(true)
        expect(await covers(ids.deleted)).toBe(false)
    })

    it("a Restricted Stage still shuts out someone who has access only through Everyone", async () => {
        const svc = serviceClient()
        const restricted = await svc
            .from("flow_stage_access")
            .insert({ stage_id: stageIds[1], shut_out_roles: [], excluded_group_ids: [] })
        if (restricted.error) throw new Error(restricted.error.message)
        const group = await svc.from("employee_groups").insert({ name: `${MARKER} Everyone Excluded` }).select("id").single()
        if (group.error) throw new Error(group.error.message)
        await svc.from("employee_group_members").insert({ group_id: group.data.id, employee_id: ids.outsider })
        await svc.from("flow_stage_access").update({ excluded_group_ids: [group.data.id] }).eq("stage_id", stageIds[1])
        await svc.from("sales_opportunities").update({ flow_stage_id: stageIds[1] }).eq("id", sorA)

        try {
            const { data } = await (await clientFor("outsider")).rpc("sor_locked_summary", { p_opportunity_id: sorA })
            expect(data?.[0]?.is_restricted).toBe(true)
        } finally {
            await svc.from("flow_stage_access").delete().eq("stage_id", stageIds[1])
            await svc.from("employee_group_members").delete().eq("group_id", group.data.id)
            await svc.from("employee_groups").delete().eq("id", group.data.id)
        }
    })
})
