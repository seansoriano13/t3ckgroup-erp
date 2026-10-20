/**
 * #582 (spec #561): a Purchase Request made from Canvasses copies each winner's price onto its
 * Requested Item. The price lives in purchase_request_item_prices, read only by a member of the
 * request who has Purchasing access, Finance access or Super Admin; any other member reads the
 * item and no price.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"

const svc = () => serviceClient()

let requestId, pricedItem, unpricedItem, canvassIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const makeWonCanvass = async (name, price, currency = "PHP") => {
    const canvass = await asSvc(svc().from("sor_canvasses").insert({ product_name: name, created_by: ids.outsider }).select("id").single(), "Canvass")
    canvassIds.push(canvass.id)
    const offer = await asSvc(
        svc().from("sor_canvass_offers").insert({ canvass_id: canvass.id, supplier_name: "Paper Co", currency, is_winner: true }).select("id").single(),
        "Offer",
    )
    if (price != null) await asSvc(svc().from("sor_canvass_offer_prices").insert({ offer_id: offer.id, unit_price: price }), "Offer price")
    return canvass.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    const withPrice = await makeWonCanvass("Priced paper", 250.5)
    const withoutPrice = await makeWonCanvass("Unpriced pens", null)

    const purchaser = await clientFor("outsider")
    const made = await purchaser.rpc("canvass_create_purchase_request", {
        p_title: "[policy-tier] price copy",
        p_items: [{ canvass_id: withPrice }, { canvass_id: withoutPrice }],
    })
    if (made.error) throw new Error(`canvass_create_purchase_request: ${made.error.message}`)
    requestId = made.data.request_id
    const byCanvass = Object.fromEntries(made.data.items.map((i) => [i.canvass_id, i.item_id]))
    pricedItem = byCanvass[withPrice]
    unpricedItem = byCanvass[withoutPrice]

    await asSvc(svc().from("purchase_request_members").upsert({ request_id: requestId, employee_id: ids.dealOwner, side: "sales" }, { onConflict: "request_id,employee_id" }), "member")
    // Finance reads the price only as a reader of the request, so it joins the request too.
    await asSvc(svc().from("purchase_request_members").upsert({ request_id: requestId, employee_id: ids.finance, side: "sales" }, { onConflict: "request_id,employee_id" }), "finance member")
})

afterAll(async () => {
    await svc().from("sor_canvasses").delete().in("id", canvassIds)
    if (requestId) {
        await svc().from("purchase_request_items").delete().eq("request_id", requestId)
        await svc().from("purchase_request_messages").delete().eq("request_id", requestId)
        await svc().from("purchase_request_members").delete().eq("request_id", requestId)
        await svc().from("purchase_requests").delete().eq("id", requestId)
    }
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
})

describe("the price on a Requested Item made from a Canvass", () => {
    it("is filled from the winning Offer, with its currency", async () => {
        const rows = await asSvc(svc().from("purchase_request_item_prices").select("item_id, unit_price, currency").in("item_id", [pricedItem, unpricedItem]), "prices")
        expect(rows).toEqual([{ item_id: pricedItem, unit_price: 250.5, currency: "PHP" }])
    })

    it("shows the price to a member with Purchasing access, Finance access or Super Admin", async () => {
        for (const who of ["outsider", "finance", "superAdmin"]) {
            const client = await clientFor(who)
            const { data } = await client.from("purchase_request_item_prices").select("unit_price").eq("item_id", pricedItem)
            expect(data, who).toEqual([{ unit_price: 250.5 }])
        }
    })

    it("hides the price from another member, who still reads the item", async () => {
        const client = await clientFor("dealOwner")
        const item = await client.from("purchase_request_items").select("id").eq("id", pricedItem)
        expect(item.data).toHaveLength(1)
        const { data, error } = await client.from("purchase_request_item_prices").select("*").eq("item_id", pricedItem)
        expect(error).toBeNull()
        expect(data).toEqual([])
    })

    it("hides the price from someone who is not on the request", async () => {
        const client = await clientFor("ordinary")
        const { data } = await client.from("purchase_request_item_prices").select("*").eq("item_id", pricedItem)
        expect(data).toEqual([])
    })

    it("cannot be written by a signed-in user", async () => {
        const client = await clientFor("outsider")
        const { error } = await client.from("purchase_request_item_prices").update({ unit_price: 1 }).eq("item_id", pricedItem)
        const after = await asSvc(svc().from("purchase_request_item_prices").select("unit_price").eq("item_id", pricedItem).single(), "price")
        expect(after.unit_price).toBe(250.5)
        expect(error === null || error.code).toBeTruthy()
    })
})
