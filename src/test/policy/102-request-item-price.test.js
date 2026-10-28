/**
 * #582 (spec #561): a Requested Item carries a price. (#729: a request is no longer made from
 * Canvasses, so the rows are set up directly.) The price lives in purchase_request_item_prices, read only by a member of the
 * request who has Purchasing access, Finance access or Super Admin; any other member reads the
 * item and no price.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"

const svc = () => serviceClient()

let requestId, pricedItem, unpricedItem

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    const purchaser = await clientFor("outsider")
    const made = await purchaser.rpc("purchase_request_open", {
        p_title: "[policy-tier] price copy",
        p_items: [
            { name: "[policy-tier] Priced paper", quantity: 1, unit: "pc" },
            { name: "[policy-tier] Unpriced pens", quantity: 1, unit: "pc" },
        ],
    })
    if (made.error) throw new Error(`purchase_request_open: ${made.error.message}`)
    requestId = made.data
    const items = await asSvc(svc().from("purchase_request_items").select("id, name").eq("request_id", requestId), "items")
    pricedItem = items.find((i) => i.name.includes("Priced paper")).id
    unpricedItem = items.find((i) => i.name.includes("Unpriced pens")).id
    await asSvc(svc().from("purchase_request_item_prices").insert({ item_id: pricedItem, unit_price: 250.5, currency: "PHP" }), "price")

    await asSvc(svc().from("purchase_request_members").upsert({ request_id: requestId, employee_id: ids.dealOwner, side: "sales" }, { onConflict: "request_id,employee_id" }), "member")
    // Finance reads the price only as a reader of the request, so it joins the request too.
    await asSvc(svc().from("purchase_request_members").upsert({ request_id: requestId, employee_id: ids.finance, side: "sales" }, { onConflict: "request_id,employee_id" }), "finance member")
})

afterAll(async () => {
    if (requestId) {
        await svc().from("purchase_request_items").delete().eq("request_id", requestId)
        await svc().from("purchase_request_messages").delete().eq("request_id", requestId)
        await svc().from("purchase_request_members").delete().eq("request_id", requestId)
        await svc().from("purchase_requests").delete().eq("id", requestId)
    }
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
})

describe("the price on a Requested Item", () => {
    it("is kept with its currency, and only on the item that has one", async () => {
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
