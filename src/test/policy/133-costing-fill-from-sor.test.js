/**
 * The Costing Matrix fills itself from the SOR's products (Costing Desk, 20261102190000):
 * costing_fill_from_sor makes a Tender Line and one Component (the product, at the line's
 * quantity) for every SOR product not yet in the matrix, and runs again without doubling anything;
 * costing_odoo_cost_targets and costing_fill_odoo_costs are the server's (service role only), write
 * Odoo's cost into blank costs only, and judge the named employee as the fill does.
 *
 * The cast, on one SOR (dealOwner is its Deal Team):
 *   dealOwner         Deal Team                       -> fills (Sales)
 *   outsider          Purchasing access               -> fills (Purchasing)
 *   stageParticipant  open Stage Participant window   -> refused
 *   ordinary          nobody                          -> refused
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { RLS_VIOLATION } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId
let sorId, emptySorId, matrixId
let hoseId, tripodId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const fill = async (who, opp = sorId) => (await clientFor(who)).rpc("costing_fill_from_sor", { p_opportunity_id: opp })
const lines = () => asSvc(svc().from("costing_tender_lines").select("*").eq("matrix_id", matrixId).order("position"), "lines")
const components = async () => {
    const lineIds = (await lines()).map((l) => l.id)
    return asSvc(svc().from("costing_components").select("*").in("tender_line_id", lineIds), "components")
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Fill` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Fill Stage`, sort_order: 10 }).select("id").single(), "stage")).id

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    emptySorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId, emptySorId)

    const visit = await asSvc(svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).single(), "visit")
    await asSvc(
        svc().from("sor_stage_participants").insert({ opportunity_id: sorId, employee_id: ids.stageParticipant, source: "action", opened_visit_id: visit.id, until_rule: "stage_left" }),
        "participant window",
    )

    hoseId = (
        await asSvc(
            svc().from("sales_opportunity_items").insert({ opportunity_id: sorId, product_name: "Fire hose, 65 mm", unit: "pc", quantity: 4, unit_price: 1200, sort_order: 1, odoo_product_id: 8123 }).select("id").single(),
            "hose",
        )
    ).id
    tripodId = (
        await asSvc(
            svc().from("sales_opportunity_items").insert({ opportunity_id: sorId, product_name: "Rescue tripod", unit: " ", quantity: 0, unit_price: 0, sort_order: 2 }).select("id").single(),
            "tripod",
        )
    ).id

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunity_items").delete().in("opportunity_id", sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("costing_fill_from_sor", () => {
    it("refuses a Stage Participant and someone with no part in the SOR", async () => {
        for (const who of ["stageParticipant", "ordinary"]) {
            const { error } = await fill(who)
            expect(error?.code, who).toBe(RLS_VIOLATION)
        }
        expect(await lines()).toEqual([])
    })

    it("refuses an SOR that has no Costing Matrix", async () => {
        const { error } = await fill("dealOwner", emptySorId)
        expect(error?.code).toBe("22023")
    })

    it("makes a Tender Line and one Component, the product, for each SOR product, in the SOR's order", async () => {
        const { data, error } = await fill("dealOwner")
        expect(error).toBeNull()
        expect(data).toBe(2)

        const [hose, tripod] = await lines()
        expect(hose).toMatchObject({ position: 1, source: "sor_line", sor_item_id: hoseId, odoo_product_id: 8123, tender_specification: "Fire hose, 65 mm", unit: "pc", created_by: ids.dealOwner })
        expect(Number(hose.quantity)).toBe(4)
        expect(hose.sor_line_snapshot).toEqual({ name: "Fire hose, 65 mm", quantity: 4, unit: "pc" })
        // A blank unit stays blank; a zero quantity becomes one.
        expect(tripod).toMatchObject({ position: 2, sor_item_id: tripodId, unit: null })
        expect(Number(tripod.quantity)).toBe(1)

        const parts = await components()
        expect(parts).toHaveLength(2)
        const hosePart = parts.find((c) => c.tender_line_id === hose.id)
        // A Component's quantity is for the whole line.
        expect(hosePart).toMatchObject({ position: 1, name: "Fire hose, 65 mm", unit: "pc", odoo_product_id: 8123 })
        expect(Number(hosePart.quantity)).toBe(4)
    })

    it("runs again without doubling, and adds only a product added since, for Purchasing too", async () => {
        expect((await fill("dealOwner")).data).toBe(0)
        await asSvc(svc().from("sales_opportunity_items").insert({ opportunity_id: sorId, product_name: "Harness", unit: "pc", quantity: 8, unit_price: 4700, sort_order: 3 }), "harness")
        const { data, error } = await fill("outsider")
        expect(error).toBeNull()
        expect(data).toBe(1)
        expect((await lines()).map((l) => l.tender_specification)).toEqual(["Fire hose, 65 mm", "Rescue tripod", "Harness"])
    })

    it("adds nothing twice after the SOR is saved again (#677: lines keep their id)", async () => {
        await asSvc(svc().from("sales_opportunity_items").update({ odoo_line_id: 5001 }).eq("id", hoseId), "hose line id")
        await asSvc(svc().from("sales_opportunity_items").update({ odoo_line_id: 5002 }).eq("id", tripodId), "tripod line id")
        const before = await lines()

        // A save: every stored line sent back, the S0's by Odoo line id and the rest by their own id.
        const rows = await asSvc(
            svc().from("sales_opportunity_items").select("id, product_name, unit, quantity, unit_price, odoo_product_id, odoo_line_id").eq("opportunity_id", sorId).order("sort_order"),
            "items",
        )
        const { error } = await (await clientFor("dealOwner")).rpc("sor_replace_items", { p_opportunity_id: sorId, p_items: rows })
        expect(error).toBeNull()

        const { data, error: fillError } = await fill("dealOwner")
        expect(fillError).toBeNull()
        expect(data).toBe(0)
        expect((await lines()).map((l) => l.sor_item_id)).toEqual(before.map((l) => l.sor_item_id))
    })
})

describe("the Odoo costs (server only)", () => {
    it("is not callable by a signed-in employee", async () => {
        const targets = await (await clientFor("dealOwner")).rpc("costing_odoo_cost_targets", { p_actor: ids.dealOwner, p_opportunity_id: sorId })
        expect(targets.error).not.toBeNull()
        const write = await (await clientFor("dealOwner")).rpc("costing_fill_odoo_costs", { p_actor: ids.dealOwner, p_opportunity_id: sorId, p_costs: { 8123: 1 } })
        expect(write.error).not.toBeNull()
    })

    it("judges the named employee: Sales and Purchasing yes, a Stage Participant no", async () => {
        for (const who of ["dealOwner", "outsider"]) {
            const { error } = await svc().rpc("costing_odoo_cost_targets", { p_actor: ids[who], p_opportunity_id: sorId })
            expect(error, who).toBeNull()
        }
        const { error } = await svc().rpc("costing_odoo_cost_targets", { p_actor: ids.stageParticipant, p_opportunity_id: sorId })
        expect(error?.code).toBe(RLS_VIOLATION)
    })

    it("lists the Components with an Odoo product and a blank cost, and fills only the blanks with a positive cost", async () => {
        const targets = await asSvc(svc().rpc("costing_odoo_cost_targets", { p_actor: ids.dealOwner, p_opportunity_id: sorId }), "targets")
        expect(targets.map((t) => t.odoo_product_id)).toEqual([8123])

        const filled = await asSvc(svc().rpc("costing_fill_odoo_costs", { p_actor: ids.dealOwner, p_opportunity_id: sorId, p_costs: { 8123: 1050.555, 999: 5 } }), "fill")
        expect(filled).toBe(1)
        const hosePart = (await components()).find((c) => c.odoo_product_id === 8123)
        const cost = await asSvc(svc().from("costing_component_costs").select("*").eq("component_id", hosePart.id).single(), "cost")
        expect(Number(cost.odoo_unit)).toBe(1050.56)
        expect(Number(cost.acquire_unit)).toBe(1050.56)

        // Typed since: Odoo never overwrites it, and a zero or missing cost writes nothing.
        await asSvc(svc().from("costing_component_costs").update({ acquire_unit: 990, odoo_unit: null }).eq("component_id", hosePart.id), "typed")
        expect(await asSvc(svc().rpc("costing_fill_odoo_costs", { p_actor: ids.dealOwner, p_opportunity_id: sorId, p_costs: { 8123: 0 } }), "zero")).toBe(0)
        expect(await asSvc(svc().rpc("costing_fill_odoo_costs", { p_actor: ids.dealOwner, p_opportunity_id: sorId, p_costs: { 8123: 1200 } }), "again")).toBe(1)
        const after = await asSvc(svc().from("costing_component_costs").select("*").eq("component_id", hosePart.id).single(), "cost")
        expect(Number(after.acquire_unit)).toBe(990)
        expect(Number(after.odoo_unit)).toBe(1200)
    })
})
