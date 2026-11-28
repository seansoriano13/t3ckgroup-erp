/**
 * Ask for several products at once (20261229150000_purchase_request_add_items.sql).
 *
 * One call adds a list of Other requests, each typed or picked from Odoo (its Odoo id kept).
 * All are added or none are: one bad product refuses the whole list, naming the product. Each
 * added product gets its own Chat line; one picked from Odoo says "from Odoo". Someone who may
 * not add items is refused.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
let sorId, requestId

const add = async (who, items) =>
    (await clientFor(who)).rpc("purchase_request_add_items", { p_request_id: requestId, p_items: items })

const itemsNamed = async (name) =>
    (await svc().from("purchase_request_items").select("*").eq("request_id", requestId).eq("name", name)).data

beforeAll(async () => {
    await ensureCastLoaded()
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    const { data, error } = await svc()
        .from("purchase_requests")
        .insert({ opportunity_id: sorId, created_by: ids.dealOwner, buyer_id: ids.stageParticipant })
        .select("id")
        .single()
    if (error) throw error
    requestId = data.id
    for (const [employee, side] of [["dealOwner", "sales"], ["stageParticipant", "purchasing"]]) {
        const m = await svc().from("purchase_request_members").insert({ request_id: requestId, employee_id: ids[employee], side })
        if (m.error) throw m.error
    }
})

afterAll(async () => {
    await svc().from("purchase_requests").delete().eq("id", requestId)
    await svc().from("sales_opportunity_items").delete().eq("opportunity_id", sorId)
    await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("adding several products", () => {
    it("adds every product in order, keeping an Odoo pick's id, each with its own Chat line", async () => {
        const picked = `${MARKER} Harness XL`
        const typed = `${MARKER} Green tarpaulin`
        const { data, error } = await add("dealOwner", [
            { name: picked, quantity: 2, unit: "pc", odoo_product_id: 555 },
            { name: typed, quantity: 3, purpose: "job", description: "Heavy duty" },
        ])
        expect(error).toBeNull()
        expect(data).toHaveLength(2)

        const [first] = await itemsNamed(picked)
        const [second] = await itemsNamed(typed)
        expect(data).toEqual([first.id, second.id])
        expect(first).toMatchObject({ source: "new", odoo_product_id: 555, quantity: 2, purpose: "client", status: "not_checked", requested_by: ids.dealOwner })
        expect(second).toMatchObject({ source: "new", odoo_product_id: null, quantity: 3, purpose: "job", description: "Heavy duty" })

        const { data: posts } = await svc()
            .from("purchase_request_messages")
            .select("content, metadata")
            .eq("request_id", requestId)
            .in("metadata->>item_id", data)
        expect(posts.map((p) => p.content).sort()).toEqual(
            [`Requested ${picked} × 2 pc, from Odoo.`, `Requested a new product: ${typed} × 3.`].sort(),
        )
        expect(posts.every((p) => p.metadata.event === "item_added")).toBe(true)
    })

    it("lets the Buyer add too", async () => {
        const { error } = await add("stageParticipant", [{ name: `${MARKER} Buyer pick`, quantity: 1 }])
        expect(error).toBeNull()
    })

    it("refuses someone who may not add items", async () => {
        const { error } = await add("outsider", [{ name: `${MARKER} Nope`, quantity: 1 }])
        expect(error?.code).toBe("42501")
    })
})

describe("all or none", () => {
    it("refuses the whole list when one product is bad, and names it", async () => {
        const good = `${MARKER} Good one`
        const { error } = await add("dealOwner", [
            { name: good, quantity: 1 },
            { name: `${MARKER} Bad one`, quantity: 0 },
        ])
        expect(error?.code).toBe("22023")
        expect(error.message).toMatch(/product 2/)
        expect(await itemsNamed(good)).toHaveLength(0)
    })

    it.each([
        ["an empty list", []],
        ["a product with no name", [{ name: "  ", quantity: 1 }]],
        ["a purpose that is neither", [{ name: `${MARKER} X`, quantity: 1, purpose: "other" }]],
        ["a bad Odoo id", [{ name: `${MARKER} X`, quantity: 1, odoo_product_id: "abc" }]],
        ["too many images", [{ name: `${MARKER} X`, quantity: 1, images: Array.from({ length: 6 }, (_, i) => ({ url: `https://example.test/${i}.jpg` })) }]],
    ])("refuses %s", async (_, items) => {
        expect((await add("dealOwner", items)).error?.code).toBe("22023")
    })
})
