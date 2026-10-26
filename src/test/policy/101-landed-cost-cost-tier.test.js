/**
 * Landed Cost and Offer prices are cost (#546, spec #544).
 *
 * Only the closed_book and cost tiers may read them. The price tier (since 20261102170000, only
 * the people the Sales Flow names as Always sees) gets nothing from the database:
 *
 *   costing_landed_costs         per-Component Landed Cost: no rows
 *   ipas_summaries_for_sor       the IPAS rows still come, the Landed Cost total and mark are null
 *   sor_canvass_offer_prices     row policy: no rows; canvass_subject_can_read_money: false
 *   canvass_offer_projection     unchanged: closed_book and cost get it, price is refused
 *
 * The cast, on one SOR:
 *   dealOwner    Deal Team                       -> closed_book tier
 *   ordinary     named in the Flow's Always sees -> price tier
 *   outsider     Purchasing access               -> closed_book tier
 *   ipasSigner   Final Acquire list              -> closed_book tier
 *   superAdmin                                   -> closed_book tier
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"
import { purgeIpas } from "./support/ipas.js"

const svc = () => serviceClient()
const RUN = Date.now() % 100000

const PRICE = ["ordinary"]
const COST = ["outsider"]
const CLOSED_BOOK = ["ipasSigner", "superAdmin", "dealOwner"]

let saleTypeId, flowId, stageId
let sorId, compId, canvassId, offerId, ipasId, poNumber
const sorIds = []
const ipasIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Cost tier` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Cost Stage`, sort_order: 10 }).select("id").single(), "stage")).id
    await asSvc(svc().from("flow_access_settings").insert({ flow_id: flowId, always_sees: [{ type: "employee", id: ids.ordinary }] }), "always sees")
    await asSvc(svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.ipasSigner }), "signer list")

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)

    const matrixId = (await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })).data
    const lineId = (
        await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Hose", quantity: 2 }).select("id").single(), "line")
    ).id
    compId = (await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 1, name: "Hose", quantity: 2 }).select("id").single(), "component")).id

    canvassId = (await asSvc(svc().from("sor_canvasses").insert({ component_id: compId, created_by: ids.outsider }).select("id").single(), "Canvass")).id
    offerId = (await asSvc(svc().from("sor_canvass_offers").insert({ canvass_id: canvassId, supplier_name: "Redleaf Inc." }).select("id").single(), "Offer")).id
    await asSvc(svc().from("sor_canvass_offer_prices").insert({ offer_id: offerId, unit_price: 78000 }), "Offer price")

    poNumber = `P101${RUN}`
    const requestId = (await asSvc(svc().from("purchase_requests").insert({ opportunity_id: sorId, created_by: ids.dealOwner }).select("id").single(), "request")).id
    await asSvc(
        svc().from("purchase_request_items").insert({
            request_id: requestId,
            source: "component",
            component_id: compId,
            name: "Hose",
            quantity: 2,
            status: "ordered",
            po_number: poNumber,
            odoo_po_line_ids: [11],
            requested_by: ids.dealOwner,
        }),
        "item",
    )
    const copy = {
        po: { id: 1, name: poNumber, state: "purchase", currency: "Php" },
        supplier: { id: 1, name: "Supplier" },
        lines: [{ line_id: 11, name: "Line 11", quantity: 2, price_unit: 1250, unit: "Unit" }],
    }
    const client = await sql().connect()
    try {
        await client.query("begin")
        const { rows } = await client.query(
            `insert into public.ipas (po_number, priority, source, purpose, odoo_copy, created_by)
             values ($1, 'high', 'local', 'project', $2, $3) returning id`,
            [poNumber, copy, ids.outsider],
        )
        ipasId = rows[0].id
        ipasIds.push(ipasId)
        await client.query(`insert into public.ipas_sors (ipas_id, opportunity_id) values ($1, $2)`, [ipasId, sorId])
        await client.query("commit")
    } catch (error) {
        await client.query("rollback").catch(() => {})
        throw error
    } finally {
        client.release()
    }
})

afterAll(async () => {
    await svc().from("purchase_request_items").delete().eq("component_id", compId)
    await svc().from("purchase_requests").delete().eq("opportunity_id", sorId)
    await svc().from("sor_canvasses").delete().eq("id", canvassId)
    await purgeIpas(ipasIds)
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_access_settings").delete().eq("flow_id", flowId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("costing_can_read_cost", () => {
    it.each([...COST, ...CLOSED_BOOK])("%s may read cost", async (who) => {
        const { data, error } = await (await clientFor(who)).rpc("costing_can_read_cost", { p_opportunity_id: sorId })
        expect(error).toBeNull()
        expect(data).toBe(true)
    })

    it.each(PRICE)("%s may not read cost", async (who) => {
        const { data } = await (await clientFor(who)).rpc("costing_can_read_cost", { p_opportunity_id: sorId })
        expect(data).toBe(false)
    })
})

describe("the tiers are what this test assumes", () => {
    it.each([
        ["dealOwner", "closed_book"],
        ["ordinary", "price"],
        ["outsider", "closed_book"],
        ["ipasSigner", "closed_book"],
        ["superAdmin", "closed_book"],
    ])("%s is %s", async (who, tier) => {
        const { data } = await (await clientFor(who)).rpc("costing_tier", { p_opportunity_id: sorId })
        expect(data).toBe(tier)
    })
})

describe("per-Component Landed Cost", () => {
    it.each([...COST, ...CLOSED_BOOK])("%s gets the Component's row", async (who) => {
        const { data, error } = await (await clientFor(who)).rpc("costing_landed_costs", { p_opportunity_id: sorId })
        expect(error).toBeNull()
        expect(data.map((r) => r.component_id)).toContain(compId)
    })

    it.each(PRICE)("%s (price tier) gets no rows", async (who) => {
        const { data, error } = await (await clientFor(who)).rpc("costing_landed_costs", { p_opportunity_id: sorId })
        expect(error).toBeNull()
        expect(data).toEqual([])
    })
})

describe("Landed Cost total in the SOR's IPAS summaries", () => {
    // The summary also needs full access to the SOR (sor_access_level), which a Super Admin has and
    // the Purchasing and Final Acquire cast here (no Deal Team seat) do not: they get no rows at all.
    it.each(["superAdmin"])("%s gets the total and the mark", async (who) => {
        const { data, error } = await (await clientFor(who)).rpc("ipas_summaries_for_sor", { p_opportunity_id: sorId })
        expect(error).toBeNull()
        const row = data.find((r) => r.ipas_id === ipasId)
        expect(Number(row.landed_cost_total_php)).toBe(2500)
        expect(row.landed_cost_mark).toBe("provisional")
    })

    it.each(PRICE)("%s (price tier) keeps the IPAS row and gets no Landed Cost", async (who) => {
        const { data, error } = await (await clientFor(who)).rpc("ipas_summaries_for_sor", { p_opportunity_id: sorId })
        expect(error).toBeNull()
        const row = data.find((r) => r.ipas_id === ipasId)
        expect(row).toBeTruthy()
        expect(row.landed_cost_total_php).toBeNull()
        expect(row.landed_cost_mark).toBeNull()
    })
})

describe("Canvass Offer prices", () => {
    it.each([...COST, ...CLOSED_BOOK])("%s reads the price and the read function says yes", async (who) => {
        const client = await clientFor(who)
        const { data } = await client.from("sor_canvass_offer_prices").select("*").eq("offer_id", offerId)
        expect(data).toEqual([expect.objectContaining({ unit_price: 78000 })])
        const money = await client.rpc("canvass_subject_can_read_money", { p_component_id: compId, p_requested_item_id: null })
        expect(money.data).toBe(true)
    })

    it.each(PRICE)("%s (price tier) reads the Offer and not the price", async (who) => {
        const client = await clientFor(who)
        const offer = await client.from("sor_canvass_offers").select("id").eq("id", offerId)
        expect(offer.data).toHaveLength(1)
        const { data, error } = await client.from("sor_canvass_offer_prices").select("*").eq("offer_id", offerId)
        expect(error).toBeNull()
        expect(data).toEqual([])
        const money = await client.rpc("canvass_subject_can_read_money", { p_component_id: compId, p_requested_item_id: null })
        expect(money.data).toBe(false)
    })

    it("refuses a price-tier write of an Offer price", async () => {
        const { data } = await (await clientFor("ordinary")).from("sor_canvass_offer_prices").insert({ offer_id: offerId, unit_price: 1 }).select()
        expect(data ?? []).toEqual([])
    })
})

describe("the Offer projection is unchanged", () => {
    it.each([...COST, ...CLOSED_BOOK])("%s still gets it", async (who) => {
        const { data, error } = await (await clientFor(who)).rpc("canvass_offer_projection", { p_canvass_id: canvassId })
        expect(error).toBeNull()
        expect(data.map((r) => r.offer_id)).toContain(offerId)
    })

    it.each(PRICE)("still refuses %s (price tier)", async (who) => {
        const { data, error } = await (await clientFor(who)).rpc("canvass_offer_projection", { p_canvass_id: canvassId })
        expect(error ? true : (data ?? []).length === 0).toBe(true)
    })
})
