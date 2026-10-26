/**
 * Actual cost from the attached P0 (#686, 20261104230000_costing_actual_cost_from_p0.sql):
 * `costing_set_p0_price` (server only) records the P0 line's unit price on the Component's
 * costs row, for Purchasing only. The price is money: it lives on costing_component_costs,
 * never on the Requested Item. A foreign P0 is turned into pesos at the Canvass winner's
 * comparison rate (20261105040000_costing_actual_cost_in_pesos.sql), and is never stored as pesos
 * without one.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded, castEmail } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()
const NO_ID = "00000000-0000-0000-0000-000000000000"
let sorId, requestId, componentId, tenderLineId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const makeItem = async (component = null) =>
    (
        await asSvc(
            svc()
                .from("purchase_request_items")
                .insert({ request_id: requestId, name: `${MARKER} Stretcher`, quantity: 1, source: "new", requested_by: ids.dealOwner, status: "purchased", component_id: component })
                .select("id")
                .single(),
            "item",
        )
    ).id
const setPrice = (who, itemId, price, currency = "PHP") =>
    svc().rpc("costing_set_p0_price", { p_actor_email: castEmail(who), p_item_id: itemId, p_price: price, p_currency: currency })
const priceOnComponent = async () => (await asSvc(svc().from("costing_component_costs").select("p0_unit_price").eq("component_id", componentId).single(), "cost")).p0_unit_price
const actualOn = async (id) =>
    asSvc(svc().from("costing_component_costs").select("p0_unit_price, p0_quoted_unit_price, p0_currency").eq("component_id", id).single(), "cost")

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(sorId)
    const matrixId = (await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })).data
    tenderLineId = (await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Stretcher", quantity: 1 }).select("id").single(), "Tender Line")).id
    componentId = (await asSvc(svc().from("costing_components").insert({ tender_line_id: tenderLineId, position: 1, name: "Component 1", quantity: 1 }).select("id").single(), "Component")).id
    await asSvc(svc().from("costing_component_costs").upsert({ component_id: componentId, acquire_unit: 100 }, { onConflict: "component_id" }), "costs row")
    requestId = (await asSvc(svc().from("purchase_requests").insert({ opportunity_id: sorId, created_by: ids.dealOwner }).select("id").single(), "request")).id
    await asSvc(svc().from("purchase_request_members").upsert({ request_id: requestId, employee_id: ids.outsider, side: "purchasing" }, { onConflict: "request_id,employee_id" }), "member")
    await asSvc(svc().from("purchase_request_members").upsert({ request_id: requestId, employee_id: ids.dealOwner, side: "sales" }, { onConflict: "request_id,employee_id" }), "sales member")
})

afterAll(async () => {
    await svc().from("purchase_request_items").delete().eq("request_id", requestId ?? NO_ID)
    await svc().from("purchase_request_members").delete().eq("request_id", requestId ?? NO_ID)
    await svc().from("purchase_requests").delete().eq("id", requestId ?? NO_ID)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
})

describe("the P0 price becomes the Component's Actual cost", () => {
    it("is recorded on the Component's costs row, not on the Requested Item", async () => {
        const id = await makeItem(componentId)
        const { error } = await setPrice("outsider", id, 123.45)
        expect(error).toBeNull()
        expect(Number(await priceOnComponent())).toBe(123.45)
        const item = await asSvc(svc().from("purchase_request_items").select("*").eq("id", id).single(), "item")
        expect(Object.keys(item).some((k) => /price/.test(k) && item[k] === 123.45)).toBe(false)
    })

    it("is refused for the sales side", async () => {
        const id = await makeItem(componentId)
        const { error } = await setPrice("dealOwner", id, 1)
        expect(error?.code).toBe("42501")
    })

    it("is not callable from the browser", async () => {
        const id = await makeItem(componentId)
        const client = await clientFor("outsider")
        const { error } = await client.rpc("costing_set_p0_price", { p_actor_email: castEmail("outsider"), p_item_id: id, p_price: 1, p_currency: "PHP" })
        expect(error).not.toBeNull()
    })

    it("does nothing for a line with no Component", async () => {
        const id = await makeItem(null)
        const { error } = await setPrice("outsider", id, 999)
        expect(error).toBeNull()
        expect(Number(await priceOnComponent())).toBe(123.45)
    })

    it("refuses a negative price", async () => {
        const id = await makeItem(componentId)
        const { error } = await setPrice("outsider", id, -1)
        expect(error?.code).toBe("22023")
    })
})

describe("a foreign P0's Actual cost is in pesos", () => {
    // P01235 (Shenzhen Coming Technology, USD): the Light Tower 400 at 388; the Canvass winner at 63.509.
    let usdComponent, usdItem, canvassId

    const makeComponent = async (position) => {
        const id = (await asSvc(svc().from("costing_components").insert({ tender_line_id: tenderLineId, position, name: `Component ${position}`, quantity: 1 }).select("id").single(), "Component")).id
        await asSvc(svc().from("costing_component_costs").upsert({ component_id: id, acquire_unit: 24641.49 }, { onConflict: "component_id" }), "costs row")
        return id
    }
    const makeWinner = async (component, currency, price) => {
        const canvass = (await asSvc(svc().from("sor_canvasses").insert({ component_id: component, created_by: ids.outsider }).select("id").single(), "Canvass")).id
        const offer = (await asSvc(svc().from("sor_canvass_offers").insert({ canvass_id: canvass, supplier_name: "Shenzhen Coming Technology", currency, is_winner: true }).select("id").single(), "Offer")).id
        await asSvc(svc().from("sor_canvass_offer_prices").insert({ offer_id: offer, ...price }), "Offer price")
        return canvass
    }

    beforeAll(async () => {
        usdComponent = await makeComponent(2)
        canvassId = await makeWinner(usdComponent, "USD", { unit_price: 388, comparison_rate: 63.509 })
        usdItem = await makeItem(usdComponent)
    })

    afterAll(async () => {
        await svc().from("sor_canvasses").delete().eq("id", canvassId ?? NO_ID)
    })

    it("is the P0's price at the Canvass winner's rate, with the price as quoted kept beside it", async () => {
        const { error } = await setPrice("outsider", usdItem, 388, "USD")
        expect(error).toBeNull()
        const actual = await actualOn(usdComponent)
        expect(Number(actual.p0_unit_price)).toBe(24641.49)
        expect(Number(actual.p0_quoted_unit_price)).toBe(388)
        expect(actual.p0_currency).toBe("USD")
    })

    it("follows a P0 price that moved from the Offer, at the same rate", async () => {
        await setPrice("outsider", usdItem, 398, "USD")
        expect(Number((await actualOn(usdComponent)).p0_unit_price)).toBe(25276.58)
    })

    it("is never stored as pesos when no Canvass winner is in the P0's currency", async () => {
        const otherComponent = await makeComponent(3)
        const otherCanvass = await makeWinner(otherComponent, "USD", { unit_price: 388, comparison_rate: 63.509 })
        try {
            const { error } = await setPrice("outsider", await makeItem(otherComponent), 350, "EUR")
            expect(error).toBeNull()
            expect(await actualOn(otherComponent)).toMatchObject({ p0_unit_price: null, p0_currency: "EUR" })
            expect(Number((await actualOn(otherComponent)).p0_quoted_unit_price)).toBe(350)
        } finally {
            await svc().from("sor_canvasses").delete().eq("id", otherCanvass)
        }
    })

    it("is not taken as pesos when the currency is not known", async () => {
        const bare = await makeComponent(4)
        await setPrice("outsider", await makeItem(bare), 388, null)
        expect(await actualOn(bare)).toMatchObject({ p0_unit_price: null, p0_currency: null })
    })
})
