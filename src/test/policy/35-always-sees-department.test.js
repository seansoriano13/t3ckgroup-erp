/**
 * The Department selector in Always sees.
 *
 * `team` matches Sub-department only, so a Sales employee with a blank or other
 * Sub-department was missed by "Everyone in SALES". `department` matches
 * `employees.department`. Assertions run as real cast members.
 *
 * ordinary / head: Sales (head has no sub-department). outsider: Operations.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { canRead } from "./support/access.js"

let saleTypeId
let flowId
let sorId
let lateHireId

beforeAll(async () => {
    await ensureCastLoaded()
    const svc = serviceClient()
    const saleType = await svc.from("sale_types").insert({ name: `${MARKER} Department Sale Type` }).select("id").single()
    if (saleType.error) throw new Error(saleType.error.message)
    saleTypeId = saleType.data.id
    const flow = await svc.from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()
    if (flow.error) throw new Error(flow.error.message)
    flowId = flow.data.id
    const stage = await svc
        .from("flow_stages")
        .insert({ flow_id: flowId, name: `${MARKER} Department 1`, sort_order: 10 })
        .select("id")
        .single()
    if (stage.error) throw new Error(stage.error.message)
    const access = await svc
        .from("flow_access_settings")
        .insert({ flow_id: flowId, always_sees: [{ type: "department", department: "sales" }] })
    if (access.error) throw new Error(access.error.message)
    sorId = await makeSor({
        registeredBy: ids.dealOwner,
        saleTypeId,
        flowStageId: stage.data.id,
        companyName: `${MARKER} Department Company`,
    })
})

afterAll(async () => {
    const svc = serviceClient()
    if (lateHireId) await svc.from("employees").delete().eq("id", lateHireId)
    await svc.from("sales_opportunities").delete().eq("id", sorId)
    await svc.from("flow_access_settings").delete().eq("flow_id", flowId)
    await svc.from("flow_stages").delete().eq("flow_id", flowId)
    await svc.from("sales_flows").delete().eq("id", flowId)
    await svc.from("sale_types").delete().eq("id", saleTypeId)
})

const covers = async (employeeId) =>
    (
        await sql().query(`select public.sor_always_sees(o, $1) as sees from public.sales_opportunities o where o.id = $2`, [
            employeeId,
            sorId,
        ])
    ).rows[0].sees

describe("Always sees = a Department", () => {
    it("a Sales employee with no sub-department reads the SOR", async () => {
        expect(await canRead(await clientFor("head"), "sales_opportunities", sorId)).toBe(true)
    })

    it("an employee in another Department does not", async () => {
        expect(await canRead(await clientFor("outsider"), "sales_opportunities", sorId)).toBe(false)
    })

    it("a Sales hire added after the setting was saved is covered; a deleted employee is not", async () => {
        const { rows } = await sql().query(
            `insert into public.employees (email, name, department, sub_department, role, employment_status)
             values ($1, $2, 'SALES', '', 'SALES EXECUTIVE', 'Regular') returning id`,
            [`dept-late-hire@policy-tier.invalid`, `${MARKER} Dept Late Hire`],
        )
        lateHireId = rows[0].id
        expect(await covers(lateHireId)).toBe(true)
        expect(await covers(ids.deleted)).toBe(false)
    })
})
