/**
 * Canvass from a product line (#682, spec #675; 20261104180000_canvass_from_product_line.sql).
 *
 * Starting a Canvass on a product line (a Requested Item) moves it to Still canvassing by itself,
 * from Not checked, Available, To purchase or Cannot source; a Cancelled, bought or
 * already-canvassing line is left alone. The winner's price fills the Acquire of the Component
 * linked to the line's SOR line. A Canvass is never overwritten: a second one on the same line is
 * refused, and its Offers, winner and reason stay.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { coverSlots } from "./support/canvassSlots.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()
const UNIQUE_VIOLATION = "23505"
const NO_ID = "00000000-0000-0000-0000-000000000000"

let sorId, requestId, matrixId, lineId, tenderLineId, componentId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const itemOf = async (name) => asSvc(svc().from("purchase_request_items").select("*").eq("request_id", requestId).eq("name", `${MARKER} ${name}`).single(), "item")
const statusOf = async (id) => (await asSvc(svc().from("purchase_request_items").select("status").eq("id", id).single(), "status")).status
const makeItem = async (status) =>
    (
        await asSvc(
            svc().from("purchase_request_items").insert({ request_id: requestId, name: `${MARKER} extra ${status}`, quantity: 1, source: "new", requested_by: ids.dealOwner, status }).select("id").single(),
            "item",
        )
    ).id
const canvassOn = async (itemId) => asSvc(svc().from("sor_canvasses").insert({ requested_item_id: itemId, created_by: ids.outsider }).select("*").single(), "Canvass")

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(sorId)
    await asSvc(
        svc().from("sales_opportunity_items").insert({ opportunity_id: sorId, product_name: `${MARKER} Stretcher`, unit: "pc", quantity: 2, unit_price: 100, odoo_line_id: 9001 }),
        "SOR line",
    )
    lineId = (await asSvc(svc().from("sales_opportunity_items").select("id").eq("opportunity_id", sorId).single(), "SOR line id")).id

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data
    tenderLineId = (
        await asSvc(
            svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Stretcher", quantity: 2, sor_item_id: lineId }).select("id").single(),
            "Tender Line",
        )
    ).id
    componentId = (
        await asSvc(svc().from("costing_components").insert({ tender_line_id: tenderLineId, position: 1, name: "Component 1", quantity: 1 }).select("id").single(), "Component")
    ).id

    requestId = (await asSvc(svc().from("purchase_requests").insert({ opportunity_id: sorId, created_by: ids.dealOwner }).select("id").single(), "request")).id
    await asSvc(svc().from("purchase_request_members").upsert({ request_id: requestId, employee_id: ids.outsider, side: "purchasing" }, { onConflict: "request_id,employee_id" }), "member")
})

afterAll(async () => {
    const items = (await svc().from("purchase_request_items").select("id").eq("request_id", requestId ?? NO_ID)).data ?? []
    await svc().from("sor_canvasses").delete().in("requested_item_id", items.map((i) => i.id))
    await svc().from("purchase_request_items").delete().eq("request_id", requestId ?? NO_ID)
    await svc().from("purchase_request_members").delete().eq("request_id", requestId ?? NO_ID)
    await svc().from("purchase_requests").delete().eq("id", requestId ?? NO_ID)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunity_items").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
})

describe("starting a Canvass moves the line to Still canvassing", () => {
    it("moves an S0 line that is Not checked, and records it in the request chat", async () => {
        const item = await itemOf("Stretcher")
        expect(item.status).toBe("not_checked")
        await canvassOn(item.id)
        expect(await statusOf(item.id)).toBe("still_canvassing")
        const events = await asSvc(svc().from("purchase_request_messages").select("metadata").eq("request_id", requestId), "events")
        expect(events.some((e) => e.metadata?.event === "item_status_changed" && e.metadata?.item_id === item.id && e.metadata?.to === "still_canvassing")).toBe(true)
    })

    it.each(["available", "to_purchase", "cannot_source"])("moves a line that is %s", async (status) => {
        const id = await makeItem(status)
        await canvassOn(id)
        expect(await statusOf(id)).toBe("still_canvassing")
    })

    it.each(["cancelled", "purchased", "received"])("leaves a %s line alone", async (status) => {
        const id = await makeItem(status)
        await canvassOn(id)
        expect(await statusOf(id)).toBe(status)
    })
})

describe("a Canvass is never overwritten", () => {
    it("refuses a second Canvass on the line and keeps the Offers, winner and reason", async () => {
        const id = await makeItem("to_purchase")
        const canvass = await canvassOn(id)
        const offer = await asSvc(svc().from("sor_canvass_offers").insert({ canvass_id: canvass.id, supplier_name: "Redleaf Inc." }).select("id").single(), "Offer")
        await asSvc(svc().from("sor_canvass_offer_prices").insert({ offer_id: offer.id, unit_price: 500 }), "price")
        await coverSlots(canvass.id)
        const won = await (await clientFor("outsider")).rpc("canvass_apply_winner", { p_canvass_id: canvass.id, p_offer_id: offer.id })
        expect(won.error).toBeNull()
        await asSvc(svc().from("sor_canvasses").update({ reason: "Best price" }).eq("id", canvass.id), "reason")

        const second = await svc().from("sor_canvasses").insert({ requested_item_id: id, created_by: ids.outsider })
        expect(second.error?.code).toBe(UNIQUE_VIOLATION)

        const kept = await asSvc(svc().from("sor_canvasses").select("id, reason, offers:sor_canvass_offers(id, is_winner)").eq("requested_item_id", id).single(), "kept")
        expect(kept).toMatchObject({ id: canvass.id, reason: "Best price", offers: [{ id: offer.id, is_winner: true }] })
    })
})

describe("the winner fills the linked Component", () => {
    it("sets the Component's Acquire from the line's Canvass winner", async () => {
        const item = await itemOf("Stretcher")
        const canvass = await asSvc(svc().from("sor_canvasses").select("id").eq("requested_item_id", item.id).single(), "Canvass")
        const offer = await asSvc(svc().from("sor_canvass_offers").insert({ canvass_id: canvass.id, supplier_name: "Ferno" }).select("id").single(), "Offer")
        await asSvc(svc().from("sor_canvass_offer_prices").insert({ offer_id: offer.id, unit_price: 78000 }), "price")

        await coverSlots(canvass.id)
        const { data, error } = await (await clientFor("outsider")).rpc("canvass_apply_winner", { p_canvass_id: canvass.id, p_offer_id: offer.id })
        expect(error).toBeNull()
        expect(data.filled.acquire).toBe(true)
        const cost = await asSvc(svc().from("costing_component_costs").select("acquire_unit, acquire_from_offer_id").eq("component_id", componentId).single(), "cost")
        expect(cost).toMatchObject({ acquire_unit: 78000, acquire_from_offer_id: offer.id })
    })

    it("fills nothing for a line with no linked Component", async () => {
        const id = await makeItem("to_purchase")
        const canvass = await canvassOn(id)
        const offer = await asSvc(svc().from("sor_canvass_offers").insert({ canvass_id: canvass.id, supplier_name: "Ferno" }).select("id").single(), "Offer")
        await asSvc(svc().from("sor_canvass_offer_prices").insert({ offer_id: offer.id, unit_price: 10 }), "price")
        await coverSlots(canvass.id)
        const { data, error } = await (await clientFor("outsider")).rpc("canvass_apply_winner", { p_canvass_id: canvass.id, p_offer_id: offer.id })
        expect(error).toBeNull()
        expect(data.filled.acquire).toBe(false)
    })
})
