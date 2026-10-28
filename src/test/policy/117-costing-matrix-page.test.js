/**
 * The Costing Matrix page's read (#606, spec #595): costing_matrix_page() gives the Closed Book
 * one row per SOR that has a Costing Matrix, with the totals Planned and Actual Revenue are
 * worked from. Nobody else gets a row: the database refuses them, whichever SOR they can open.
 *
 *   superAdmin   Closed Book (Super Admin)                 -> rows
 *   ipasSigner   Closed Book (Final Acquire list)           -> rows
 *   outsider     Purchasing access                          -> refused (cost tier, no summary)
 *   finance      Finance access                             -> refused
 *   dealOwner    Deal Team of both SORs                     -> refused (price tier)
 *   ordinary     Evaluation list only                       -> refused
 *   anonymous                                               -> refused
 *
 * SOR A (dealOwner's) has a matrix with two Tender Lines, three Components, a cost-only row and a
 * Project IPAS still at "encoding": one Component (Hose) is bought on it at a provisional Landed Cost.
 * SOR B has a matrix with a Tender Line that has no Final Offer and nothing else. SOR C has no matrix.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"
import { purgeIpas } from "./support/ipas.js"

const svc = () => serviceClient()
const RUN = Date.now() % 100000
const NOT_ALLOWED = "42501"

let saleTypeId, flowId, stageId, stageName
let sorA, sorB, sorC, requestA, ipasId
const sorIds = []
const ipasIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}
const setMoney = async (who, table, row, patch) => {
    const { error } = await (await clientFor(who)).rpc("costing_set_money", { p_table: table, p_row: row, p_patch: patch })
    if (error) throw new Error(`costing_set_money as ${who} on ${table}: ${error.message}`)
}
const page = async (who) => (await clientFor(who)).rpc("costing_matrix_page")
const rowOf = (data, sor) => (data ?? []).find((r) => r.opportunity_id === sor)

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Matrix Page` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageName = `${MARKER} Page Stage`
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: stageName, sort_order: 10 }).select("id").single(), "stage")).id

    sorA = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorB = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorC = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sorA, sorB, sorC)
    await asSvc(svc().from("sales_opportunities").update({ sales_reference: `S117${RUN}` }).eq("id", sorA), "SO number")

    await asSvc(
        svc().from("costing_signer_lists").insert([
            { list_key: "final_acquire", employee_id: ids.ipasSigner },
            { list_key: "evaluation", employee_id: ids.ordinary },
        ]),
        "lists",
    )

    const matrixA = (await svc().rpc("costing_open_matrix", { p_opportunity_id: sorA })).data
    const matrixB = (await svc().rpc("costing_open_matrix", { p_opportunity_id: sorB })).data
    const makeLine = async (matrixId, position, quantity) =>
        (await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position, tender_specification: `Line ${position}`, quantity, created_by: ids.dealOwner }).select("id").single(), "line")).id
    const makeComponent = async (lineId, position, name, quantity) =>
        (await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position, name, quantity }).select("id").single(), name)).id

    // SOR A: offer 2 x 1,000.55 + 1 x 500 = 2,501.10; Final Acquire 6,000 + 3 x 100.33 + 50 + 200.50 = 6,551.49.
    const lineA1 = await makeLine(matrixA, 1, 2)
    const lineA2 = await makeLine(matrixA, 2, 1)
    const hose = await makeComponent(lineA1, 1, "Hose", 6)
    const gauge = await makeComponent(lineA1, 2, "Gauge", 3)
    const tape = await makeComponent(lineA2, 1, "Tape", 1)
    await setMoney("dealOwner", "costing_tender_line_prices", lineA1, { final_offer_unit: 1000.55 })
    await setMoney("dealOwner", "costing_tender_line_prices", lineA2, { final_offer_unit: 500 })
    await setMoney("ipasSigner", "costing_component_costs", hose, { final_acquire_unit: 1000 })
    await setMoney("ipasSigner", "costing_component_costs", gauge, { final_acquire_unit: 100.33 })
    await setMoney("ipasSigner", "costing_component_costs", tape, { final_acquire_unit: 50 })
    const costRow = await (await clientFor("outsider")).rpc("costing_add_cost_row", { p_matrix_id: matrixA, p_description: "Delivery Charge", p_quantity: 1, p_category_key: "logistics" })
    if (costRow.error) throw new Error(`costing_add_cost_row: ${costRow.error.message}`)
    await setMoney("ipasSigner", "costing_cost_rows", costRow.data, { final_acquire_unit: 200.5 })

    // SOR B: a Tender Line with no Final Offer, and no Component.
    await makeLine(matrixB, 1, 4)

    // A Project IPAS of SOR A, still at "encoding", and Hose bought on its only line (6 x 1,250, no charges).
    const po = `P117${RUN}`
    const copy = {
        po: { id: 1, name: po, state: "purchase", currency: "Php", company: "T3CK Group Inc" },
        supplier: { id: 1, name: "Supplier" },
        lines: [{ line_id: 11, name: "Hose line", quantity: 6, price_unit: 1250, unit: "Unit" }],
    }
    const client = await sql().connect()
    try {
        await client.query("begin")
        const { rows } = await client.query(
            `insert into public.ipas (po_number, priority, source, purpose, odoo_copy, created_by, landed_cost_split, computation_status)
             values ($1, 'high', 'local', 'project', $2, $3, 'value', 'encoding') returning id`,
            [po, copy, ids.outsider],
        )
        ipasId = rows[0].id
        await client.query(`insert into public.ipas_sors (ipas_id, opportunity_id) values ($1, $2)`, [ipasId, sorA])
        await client.query("commit")
        ipasIds.push(ipasId)
    } catch (error) {
        await client.query("rollback").catch(() => {})
        throw error
    } finally {
        client.release()
    }
    requestA = (await asSvc(svc().from("purchase_requests").insert({ opportunity_id: sorA, created_by: ids.dealOwner }).select("id").single(), "request")).id
    await asSvc(
        svc().from("purchase_request_items").insert({
            request_id: requestA,
            source: "component",
            component_id: hose,
            name: "Hose",
            quantity: 6,
            status: "purchased",
            po_number: po,
            odoo_po_line_ids: [11],
            requested_by: ids.dealOwner,
        }),
        "item",
    )
})

afterAll(async () => {
    if (requestA) {
        await svc().from("purchase_request_messages").delete().eq("request_id", requestA)
        await svc().from("purchase_request_items").delete().eq("request_id", requestA)
        await svc().from("purchase_requests").delete().eq("id", requestA)
    }
    await purgeIpas(ipasIds)
    await svc().from("costing_signer_lists").delete().in("employee_id", [ids.ipasSigner, ids.ordinary])
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("the Closed Book", () => {
    it.each(["superAdmin", "ipasSigner"])("%s gets one row per SOR with a matrix, and none for an SOR without", async (who) => {
        const { data, error } = await page(who)
        expect(error).toBeNull()
        expect(rowOf(data, sorA)).toBeDefined()
        expect(rowOf(data, sorB)).toBeDefined()
        expect(rowOf(data, sorC)).toBeUndefined()
        expect(data.filter((r) => r.opportunity_id === sorA)).toHaveLength(1)
    })

    it("names the SOR: SOR number, SO number, project, stage and entity", async () => {
        const row = rowOf((await page("superAdmin")).data, sorA)
        expect(row.sor_code).toMatch(/^SOR-\d+$/)
        expect(row.sales_reference).toBe(`S117${RUN}`)
        expect(row.project_title).toBe(`${MARKER} Rope Rescue Equipment`)
        expect(row.stage).toBe(stageName)
        expect(row.entities).toEqual(["T3CK Group Inc"])
        expect(rowOf((await page("superAdmin")).data, sorB).sales_reference).toBeNull()
    })

    it("totals what the summary maths needs: offer, Final Acquire, Landed Cost of the bought items", async () => {
        const row = rowOf((await page("ipasSigner")).data, sorA)
        expect(Number(row.final_offer_total)).toBe(2501.1)
        expect(Number(row.final_acquire_total)).toBe(6551.49)
        // Hose: 6 x 1,250 on the IPAS, provisional while the IPAS is at "encoding".
        expect(Number(row.landed_cost_total)).toBe(7500)
        expect(Number(row.bought_final_acquire_total)).toBe(6000)
        expect(row.items_bought).toBe(1)
        expect(row.items_total).toBe(3)
        expect(row.ipas_short).toBe(true)
    })

    it("adds each item's Landed Cost to the centavo, exactly as the SOR summary does", async () => {
        const client = await clientFor("ipasSigner")
        const { data: items, error } = await client.rpc("costing_landed_costs", { p_opportunity_id: sorA })
        expect(error).toBeNull()
        const cents = items.filter((i) => i.total_php !== null).reduce((sum, i) => sum + Math.round(Number(i.total_php) * 100), 0)
        const row = rowOf((await page("ipasSigner")).data, sorA)
        expect(Math.round(Number(row.landed_cost_total) * 100)).toBe(cents)
        expect(cents).toBeGreaterThan(0)
    })

    it("leaves a figure null while an input is blank, and zero where nothing is bought", async () => {
        const row = rowOf((await page("superAdmin")).data, sorB)
        expect(row.final_offer_total).toBeNull()
        expect(row.final_acquire_total).toBeNull()
        expect(Number(row.landed_cost_total)).toBe(0)
        expect(Number(row.bought_final_acquire_total)).toBe(0)
        expect(row.items_bought).toBe(0)
        expect(row.items_total).toBe(0)
        expect(row.ipas_short).toBe(false)
        expect(row.entities).toEqual([])
    })
})

describe("Purchasing and the Deal Team (since 20261102170000)", () => {
    it("gives Purchasing every SOR with a matrix", async () => {
        const { data, error } = await page("outsider")
        expect(error).toBeNull()
        expect(rowOf(data, sorA)).toBeDefined()
        expect(rowOf(data, sorB)).toBeDefined()
        expect(rowOf(data, sorC)).toBeUndefined()
    })

    it("gives the Deal Team its own SORs and no one else's", async () => {
        const { data, error } = await page("dealOwner")
        expect(error).toBeNull()
        expect(rowOf(data, sorA)).toBeDefined()
        expect(rowOf(data, sorB)).toBeDefined()
        const theirs = await svc().from("sales_opportunities").select("id")
            .or(`registered_by.eq.${ids.dealOwner},deal_owner_id.eq.${ids.dealOwner},closing_sales_id.eq.${ids.dealOwner},support_sales_1_id.eq.${ids.dealOwner},support_sales_2_id.eq.${ids.dealOwner},sales_director_id.eq.${ids.dealOwner}`)
        const own = new Set(theirs.data.map((r) => r.id))
        expect(data.every((r) => own.has(r.opportunity_id))).toBe(true)
    })
})

describe("everyone else is refused", () => {
    it.each(["finance", "ordinary"])("%s gets no rows", async (who) => {
        const { data, error } = await page(who)
        expect(data ?? null).toBeNull()
        expect(error?.code).toBe(NOT_ALLOWED)
    })

    it("refuses someone who is not signed in", async () => {
        const { data, error } = await anonymousClient().rpc("costing_matrix_page")
        expect(data ?? null).toBeNull()
        expect(error).not.toBeNull()
    })

    it("stops serving the Final Acquire list once the member comes off it", async () => {
        await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner).eq("list_key", "final_acquire")
        try {
            const { error } = await page("ipasSigner")
            expect(error?.code).toBe(NOT_ALLOWED)
        } finally {
            await asSvc(svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.ipasSigner }), "restore list")
        }
    })
})
