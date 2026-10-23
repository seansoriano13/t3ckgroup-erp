/**
 * An item picked from an SOR line follows the SOR, or is kept as asked
 * (20261103100000_purchase_request_item_follows_sor.sql).
 *
 * `dealOwner` is the sales-side member; `stageParticipant` is the Buyer;
 * `hr` sits on the `other` side and may not add items. Sides are seeded as
 * stored, and items are read back with the service role, so a pass is the
 * RPC's doing and not a read policy's.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const HARNESS = `${MARKER} Full Body Harness`
const PRODUCT_LIST = [{ product_name: HARNESS, unit: "pc", quantity: 10, unit_price: 5998.1, odoo_product_id: 101 }]

let sorId, requestId

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

/** Replaces the SOR's Product List the way updateOpportunity does. */
async function replaceProductList(items) {
    const { error } = await (await clientFor("dealOwner")).rpc("sor_replace_items", { p_opportunity_id: sorId, p_items: items })
    if (error) throw error
}

async function item(id) {
    const { data, error } = await svc().from("purchase_request_items").select("*").eq("id", id).single()
    if (error) throw error
    return data
}

/** A fresh item picked from the harness line at its current quantity. */
async function pickHarness() {
    const { data: lines } = await svc().from("sales_opportunity_items").select("id").eq("opportunity_id", sorId)
    const { data, error } = await (await clientFor("dealOwner")).rpc("purchase_request_add_item_from_line", {
        p_request_id: requestId,
        p_line_id: lines[0].id,
    })
    if (error) throw error
    return data
}

const follow = async (who, itemId, reason) =>
    (await clientFor(who)).rpc("purchase_request_update_item_from_sor", { p_item_id: itemId, p_reason: reason ?? null })

beforeAll(async () => {
    await ensureCastLoaded()
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    requestId = await insert("purchase_requests", { opportunity_id: sorId, created_by: ids.dealOwner, buyer_id: ids.stageParticipant })
    for (const [employee, side] of [
        ["dealOwner", "sales"],
        ["stageParticipant", "purchasing"],
        ["hr", "other"],
    ]) {
        await insert("purchase_request_members", { request_id: requestId, employee_id: ids[employee], side })
    }
})

afterAll(async () => {
    await svc().from("purchase_requests").delete().eq("id", requestId)
    await svc().from("sales_opportunity_items").delete().eq("opportunity_id", sorId)
    await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("updating an item to the SOR", () => {
    let itemId

    beforeAll(async () => {
        await replaceProductList(PRODUCT_LIST)
        itemId = await pickHarness()
        await replaceProductList([{ ...PRODUCT_LIST[0], quantity: 12 }])
    })

    it("refuses someone who may not add items", async () => {
        const { error } = await follow("hr", itemId)
        expect(error?.message).toMatch(/may add items/)
        expect((await item(itemId)).quantity).toBe(10)
    })

    it("copies the line's quantity into the item and its snapshot, and says so in the request", async () => {
        const { error } = await follow("stageParticipant", itemId)
        expect(error).toBeNull()
        expect(await item(itemId)).toMatchObject({ quantity: 12, sor_line_snapshot: { quantity: 12, unit: "pc" }, sor_change_seen: null })

        const { data } = await svc().from("purchase_request_messages").select("author_id, content, metadata").eq("request_id", requestId).contains("metadata", { item_id: itemId, event: "item_followed_sor" })
        expect(data).toEqual([
            {
                author_id: ids.stageParticipant,
                content: `Updated ${HARNESS} from 10 pc to 12 pc, as the SOR now says.`,
                metadata: { event: "item_followed_sor", item_id: itemId, from: "10 pc", to: "12 pc" },
            },
        ])
    })

    it("refuses an item that already says what the SOR says", async () => {
        const { error } = await follow("stageParticipant", itemId)
        expect(error?.message).toMatch(/already says/)
    })
})

describe("an Ordered item", () => {
    let itemId

    beforeAll(async () => {
        await replaceProductList(PRODUCT_LIST)
        itemId = await pickHarness()
        await svc().from("purchase_request_items").update({ status: "ordered" }).eq("id", itemId)
        await replaceProductList([{ ...PRODUCT_LIST[0], quantity: 15 }])
    })

    it("wants a reason, and posts it with the change", async () => {
        const refused = await follow("stageParticipant", itemId)
        expect(refused.error?.message).toMatch(/say why/)
        expect((await item(itemId)).quantity).toBe(10)

        const { error } = await follow("stageParticipant", itemId, "Client added five")
        expect(error).toBeNull()
        expect((await item(itemId)).quantity).toBe(15)
        const { data } = await svc().from("purchase_request_messages").select("content").eq("request_id", requestId).contains("metadata", { item_id: itemId, event: "item_followed_sor" })
        expect(data[0].content).toMatch(/Reason: Client added five$/)
    })
})

describe("a closed item or a vanished line", () => {
    it("keeps what was asked on a closed item", async () => {
        await replaceProductList(PRODUCT_LIST)
        const itemId = await pickHarness()
        await svc().from("purchase_request_items").update({ status: "received" }).eq("id", itemId)
        await replaceProductList([{ ...PRODUCT_LIST[0], quantity: 20 }])

        const { error } = await follow("stageParticipant", itemId)
        expect(error?.message).toMatch(/closed/)
        const kept = await (await clientFor("dealOwner")).rpc("purchase_request_keep_item_as_asked", { p_item_id: itemId })
        expect(kept.error?.message).toMatch(/closed/)
    })

    it("cannot follow a line the SOR no longer has", async () => {
        await replaceProductList(PRODUCT_LIST)
        const itemId = await pickHarness()
        await replaceProductList([{ product_name: `${MARKER} Something else`, unit: "pc", quantity: 1, unit_price: 1 }])

        const { error } = await follow("stageParticipant", itemId)
        expect(error?.message).toMatch(/no longer has this line/)
    })
})

describe("keeping an item as asked", () => {
    it("records the line it was judged against, for whoever may add items only", async () => {
        await replaceProductList(PRODUCT_LIST)
        const itemId = await pickHarness()
        await replaceProductList([{ ...PRODUCT_LIST[0], quantity: 12 }])

        const refused = await (await clientFor("hr")).rpc("purchase_request_keep_item_as_asked", { p_item_id: itemId })
        expect(refused.error?.message).toMatch(/may add items/)

        const { error } = await (await clientFor("dealOwner")).rpc("purchase_request_keep_item_as_asked", { p_item_id: itemId })
        expect(error).toBeNull()
        expect(await item(itemId)).toMatchObject({ quantity: 10, sor_change_seen: { quantity: 12, unit: "pc" } })
    })
})
