/**
 * S0 Evaluation, lines typed before the S0 exists (#720, spec #718 "Tender-first lines").
 *
 * The cast, on one SOR (dealOwner and support are its Deal Team):
 *   dealOwner  Deal Team         -> Sales band
 *   outsider   Purchasing access -> Purchasing band
 *   ordinary   nobody            -> no tier
 *
 * The matrix, Components, Canvasses, Offers and Requested Items are made with the service
 * role; every call under test runs as a real cast member, so the real triggers judge it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { tryInsert, tryUpdate, tryDelete, RLS_VIOLATION } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"
import { coverSlots } from "./support/canvassSlots.js"

const svc = () => serviceClient()
const BAD_INPUT = "22023"

let saleTypeId, flowId, stageId
let sorId, matrixId, requestId
const sorIds = []
let position = 0

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

/** A typed Tender Line as `who` (Sales), or as the service role when `who` is null. */
async function typedLine(overrides = {}, who = "dealOwner") {
    position += 1
    const row = {
        matrix_id: matrixId,
        position,
        source: "typed",
        tender_specification: "Rescue tripod",
        unit: "set",
        quantity: 2,
        ...overrides,
    }
    const client = who ? await clientFor(who) : svc()
    const { data, error } = await client.from("costing_tender_lines").insert(row).select("*").single()
    if (error) throw new Error(`Adding a typed line as ${who}: ${error.message}`)
    return data
}

const component = async (lineId) =>
    (await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 1, name: "Tripod", quantity: 1 }).select("id").single(), "Component")).id

const lineExists = async (id) => (await svc().from("costing_tender_lines").select("id").eq("id", id)).data.length === 1

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Typed` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (
        await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Typed Stage`, sort_order: 10 }).select("id").single(), "stage")
    ).id
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, supportSales1Id: ids.support, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data
    requestId = (await asSvc(svc().from("purchase_requests").insert({ opportunity_id: sorId, created_by: ids.dealOwner }).select("id").single(), "request")).id
})

afterAll(async () => {
    await svc().from("purchase_request_items").delete().eq("request_id", requestId)
    await svc().from("purchase_requests").delete().eq("id", requestId)
    await purgeCostingForSors(sorIds)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await svc().from("sales_opportunity_items").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("id", stageId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("a line typed before the S0", () => {
    it("saves with the client's words, unit and quantity, no SOR line and no Odoo product", async () => {
        const line = await typedLine()
        expect(line).toMatchObject({ source: "typed", sor_item_id: null, odoo_product_id: null, tender_specification: "Rescue tripod", unit: "set" })
        expect(Number(line.quantity)).toBe(2)
    })

    it("is added by Sales and refused to Purchasing", async () => {
        const refused = await tryInsert(await clientFor("outsider"), "costing_tender_lines", { matrix_id: matrixId, position: 900, source: "typed", tender_specification: "x" })
        expect(refused).toMatchObject({ ok: false, code: RLS_VIOLATION })
        expect(refused.message).toBe("costing_band:costing_tender_lines.*:sales")
    })

    it("can be removed by Sales while it has no Canvass and no P0", async () => {
        const line = await typedLine()
        await component(line.id)
        expect(await tryDelete(await clientFor("dealOwner"), "costing_tender_lines", line.id)).toEqual({ ok: true, affected: 1 })
    })

    it("can't be removed by Purchasing", async () => {
        const line = await typedLine()
        const refused = await tryDelete(await clientFor("outsider"), "costing_tender_lines", line.id)
        expect(refused).toMatchObject({ ok: false, code: RLS_VIOLATION })
        expect(await lineExists(line.id)).toBe(true)
    })
})

describe("Purchasing names the Odoo product", () => {
    it("on a typed line, and on nothing else of it", async () => {
        const line = await typedLine()
        const purchasing = await clientFor("outsider")
        expect(await tryUpdate(purchasing, "costing_tender_lines", line.id, { odoo_product_id: 8123 })).toEqual({ ok: true, affected: 1 })
        const row = await asSvc(svc().from("costing_tender_lines").select("odoo_product_id").eq("id", line.id).single(), "line")
        expect(row.odoo_product_id).toBe(8123)

        const words = await tryUpdate(purchasing, "costing_tender_lines", line.id, { tender_specification: "Something else" })
        expect(words).toMatchObject({ ok: false, code: RLS_VIOLATION })
        expect(words.message).toBe("costing_band:costing_tender_lines.tender_specification:sales")
    })

    it("is also open to Sales", async () => {
        const line = await typedLine()
        expect(await tryUpdate(await clientFor("dealOwner"), "costing_tender_lines", line.id, { odoo_product_id: 9001 })).toEqual({ ok: true, affected: 1 })
    })

    it("is refused on a line picked from the S0, which keeps the S0's product", async () => {
        const sorItem = await asSvc(
            svc().from("sales_opportunity_items").insert({ opportunity_id: sorId, product_name: `${MARKER} S0 rope` }).select("id").single(),
            "S0 line",
        )
        const linked = await typedLine({ source: "sor_line", sor_item_id: sorItem.id, odoo_product_id: 7001 }, null)
        const refused = await tryUpdate(await clientFor("outsider"), "costing_tender_lines", linked.id, { odoo_product_id: 7002 })
        expect(refused).toMatchObject({ ok: false, code: BAD_INPUT })
        expect(refused.message).toMatch(/^costing_line: /)
        expect(await tryUpdate(await clientFor("dealOwner"), "costing_tender_lines", linked.id, { odoo_product_id: 7002 })).toEqual({ ok: true, affected: 1 })
    })

    it("is refused to someone with no part in the deal", async () => {
        const line = await typedLine()
        const refused = await tryUpdate(await clientFor("ordinary"), "costing_tender_lines", line.id, { odoo_product_id: 1 })
        expect(refused.affected).toBe(0)
    })
})

describe("a typed line is canvassed like any line", () => {
    it("takes a Canvass on its Component, and the winner fills the Component's cost", async () => {
        const line = await typedLine()
        const comp = await component(line.id)
        const canvass = await asSvc(svc().from("sor_canvasses").insert({ component_id: comp, created_by: ids.outsider }).select("id").single(), "Canvass")
        const offer = await asSvc(svc().from("sor_canvass_offers").insert({ canvass_id: canvass.id, supplier_name: "Redleaf Inc." }).select("id").single(), "Offer")
        await asSvc(svc().from("sor_canvass_offer_prices").insert({ offer_id: offer.id, unit_price: 4250 }), "Offer price")

        await coverSlots(canvass.id)
        const picked = await (await clientFor("outsider")).rpc("canvass_apply_winner", { p_canvass_id: canvass.id, p_offer_id: offer.id })
        expect(picked.error).toBeNull()
        const cost = await asSvc(svc().from("costing_component_costs").select("acquire_unit").eq("component_id", comp).single(), "cost")
        expect(Number(cost.acquire_unit)).toBe(4250)
    })
})

describe("a line with a Canvass or a P0 stays", () => {
    it("is refused once its Component has a Canvass", async () => {
        const line = await typedLine()
        const comp = await component(line.id)
        await asSvc(svc().from("sor_canvasses").insert({ component_id: comp, created_by: ids.outsider }), "Canvass")

        const refused = await tryDelete(await clientFor("dealOwner"), "costing_tender_lines", line.id)
        expect(refused).toMatchObject({ ok: false, code: BAD_INPUT })
        expect(refused.message).toBe("costing_line: a line with a Canvass can't be removed")
        expect(await lineExists(line.id)).toBe(true)
    })

    // A Requested Item that names a Component is never canvassed itself (the Canvass is on the
    // Component, #720), so a Canvass can't sit on it. The line is still held by the Requested Item.
    it("is refused once a Requested Item is made from its Component", async () => {
        const line = await typedLine()
        const comp = await component(line.id)
        await asSvc(
            svc().from("purchase_request_items").insert({ request_id: requestId, source: "component", component_id: comp, name: "Tripod", quantity: 1, requested_by: ids.dealOwner }),
            "Requested Item",
        )

        const refused = await tryDelete(await clientFor("dealOwner"), "costing_tender_lines", line.id)
        expect(refused).toMatchObject({ ok: false, code: BAD_INPUT })
        expect(refused.message).toMatch(/Requested Item/)
        expect(await lineExists(line.id)).toBe(true)
    })

    // The older "linked to a Requested Item" guard fires before the P0 guard (trigger names sort that
    // way), so a Requested Item with a P0 is refused with its message.
    it("is refused once a Requested Item of its Component has a P0", async () => {
        const line = await typedLine()
        const comp = await component(line.id)
        await asSvc(
            svc().from("purchase_request_items").insert({
                request_id: requestId, source: "component", component_id: comp, name: "Tripod", quantity: 1, status: "purchased", po_number: "P0720", odoo_po_line_ids: [1], requested_by: ids.dealOwner,
            }),
            "Requested Item",
        )

        const refused = await tryDelete(await clientFor("dealOwner"), "costing_tender_lines", line.id)
        expect(refused).toMatchObject({ ok: false, code: BAD_INPUT })
        expect(refused.message).toMatch(/linked to a Requested Item/)
        expect(await lineExists(line.id)).toBe(true)
    })

    it("is refused once a Component carries a typed P.O./RFQ No.", async () => {
        const line = await typedLine()
        const comp = await component(line.id)
        await asSvc(svc().from("costing_components").update({ po_rfq_no: "P0721" }).eq("id", comp), "typed P0")

        const refused = await tryDelete(await clientFor("dealOwner"), "costing_tender_lines", line.id)
        expect(refused).toMatchObject({ ok: false, code: BAD_INPUT })
        expect(refused.message).toMatch(/P0/)
    })

    it("holds for a Super Admin too", async () => {
        const line = await typedLine()
        const comp = await component(line.id)
        await asSvc(svc().from("sor_canvasses").insert({ component_id: comp, created_by: ids.outsider }), "Canvass")
        const refused = await tryDelete(await clientFor("superAdmin"), "costing_tender_lines", line.id)
        expect(refused).toMatchObject({ ok: false, code: BAD_INPUT })
    })
})
