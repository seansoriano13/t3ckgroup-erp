/**
 * Edit and remove an Other request (20261229170000_purchase_request_item_edit_remove.sql).
 *
 * Anyone who may add to the request may edit or remove a product added by hand, until a P0 is
 * attached. Each change posts its own Chat line under the one who made it (an edit's line keeps the
 * values before and after) and tells the Buyer and whoever first asked. A removed product stays in
 * the table, Cancelled and stamped, and the request's lists leave it out.
 *
 * `dealOwner` (sales) asks; `stageParticipant` is the Buyer; `hr` sits on the `other` side;
 * `ordinary` is not a member.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const NO_ID = "00000000-0000-0000-0000-000000000000"
let sorId, requestId

async function addOne(who = "dealOwner", fields = {}) {
    const { data, error } = await (await clientFor(who)).rpc("purchase_request_add_items", {
        p_request_id: requestId,
        p_items: [{ name: `${MARKER} Safety vest`, quantity: 10, unit: "pc", ...fields }],
    })
    if (error) throw error
    return data[0]
}

const edit = async (who, itemId, item) => (await clientFor(who)).rpc("purchase_request_edit_item", { p_item_id: itemId, p_item: item })
const remove = async (who, itemId) => (await clientFor(who)).rpc("purchase_request_remove_item", { p_item_id: itemId })

async function item(id) {
    const { data, error } = await svc().from("purchase_request_items").select("*").eq("id", id).single()
    if (error) throw error
    return data
}

async function postsAbout(itemId, event) {
    const { data, error } = await svc()
        .from("purchase_request_messages")
        .select("author_id, content, metadata")
        .eq("request_id", requestId)
        .eq("metadata->>event", event)
        .eq("metadata->>item_id", itemId)
    if (error) throw error
    return data
}

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
    for (const [employee, side] of [["dealOwner", "sales"], ["stageParticipant", "purchasing"], ["hr", "other"]]) {
        const m = await svc().from("purchase_request_members").insert({ request_id: requestId, employee_id: ids[employee], side })
        if (m.error) throw m.error
    }
})

afterAll(async () => {
    await svc().from("notifications").delete().eq("reference_id", requestId)
    await svc().from("purchase_requests").delete().eq("id", requestId)
    await svc().from("sales_opportunity_items").delete().eq("opportunity_id", sorId)
    await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("editing a product", () => {
    it("lets any member change it, posts what changed under their name, and tells the Buyer and the asker", async () => {
        const id = await addOne()
        const { data: changed, error } = await edit("hr", id, {
            name: `${MARKER} Safety vest, orange`,
            quantity: 12,
            unit: "box",
            description: "Reflective",
            purpose: "job",
        })
        expect(error).toBeNull()
        expect(changed).toBe(true)
        expect(await item(id)).toMatchObject({
            name: `${MARKER} Safety vest, orange`,
            quantity: 12,
            unit: "box",
            description: "Reflective",
            purpose: "job",
            requested_by: ids.dealOwner,
        })

        const [post] = await postsAbout(id, "item_edited")
        expect(post.author_id).toBe(ids.hr)
        expect(post.content).toBe(
            `Changed ${MARKER} Safety vest: name to ${MARKER} Safety vest, orange, quantity 10 pc → 12 box, now material for the job, description.`,
        )
        expect(post.metadata.before).toMatchObject({ name: `${MARKER} Safety vest`, quantity: 10, unit: "pc" })
        expect(post.metadata.after).toMatchObject({ name: `${MARKER} Safety vest, orange`, quantity: 12, unit: "box" })

        const { data: told } = await svc()
            .from("notifications")
            .select("recipient_id, title")
            .eq("reference_id", requestId)
            .eq("title", "Item changed")
        expect(told.map((n) => n.recipient_id).sort()).toEqual([ids.dealOwner, ids.stageParticipant].sort())
    })

    it("keeps an Odoo pick's id, and drops it when the name is typed instead", async () => {
        const id = await addOne("dealOwner", { odoo_product_id: 777 })
        await edit("dealOwner", id, { name: `${MARKER} Typed vest`, quantity: 10, unit: "pc" })
        expect((await item(id)).odoo_product_id).toBeNull()
        await edit("dealOwner", id, { name: `${MARKER} Typed vest`, quantity: 10, unit: "pc", odoo_product_id: 888 })
        expect((await item(id)).odoo_product_id).toBe(888)
        const posts = await postsAbout(id, "item_edited")
        expect(posts.map((p) => p.content)).toContain(`Changed ${MARKER} Typed vest: now from Odoo.`)
    })

    it("posts nothing when nothing changed", async () => {
        const id = await addOne()
        const { data, error } = await edit("dealOwner", id, { name: `${MARKER} Safety vest`, quantity: 10, unit: "pc" })
        expect(error).toBeNull()
        expect(data).toBe(false)
        expect(await postsAbout(id, "item_edited")).toHaveLength(0)
    })

    it.each([
        ["no name", { name: " ", quantity: 1 }],
        ["a quantity of zero", { name: `${MARKER} X`, quantity: 0 }],
        ["a purpose that is neither", { name: `${MARKER} X`, quantity: 1, purpose: "other" }],
        ["too many images", { name: `${MARKER} X`, quantity: 1, images: Array.from({ length: 6 }, (_, i) => ({ url: `https://example.test/${i}.jpg` })) }],
    ])("refuses %s", async (_, fields) => {
        const id = await addOne()
        expect((await edit("dealOwner", id, fields)).error?.code).toBe("22023")
    })
})

describe("removing a product", () => {
    it("keeps the row Cancelled and stamped, posts it under their name, and drops it from the lists", async () => {
        const kept = await addOne("dealOwner", { name: `${MARKER} Kept` })
        const id = await addOne("dealOwner", { name: `${MARKER} Wrong one`, quantity: 3 })
        const { error } = await remove("hr", id)
        expect(error).toBeNull()

        expect(await item(id)).toMatchObject({ status: "cancelled", removed_by: ids.hr })
        expect((await item(id)).removed_at).not.toBeNull()

        const [post] = await postsAbout(id, "item_removed")
        expect(post).toMatchObject({ author_id: ids.hr, content: `Removed ${MARKER} Wrong one × 3 pc.` })
        expect(post.metadata.from).toBe("not_checked")

        const { data: [row] } = await (await clientFor("dealOwner")).rpc("purchase_request_queue", { p_request_id: requestId })
        const { count } = await svc()
            .from("purchase_request_items")
            .select("id", { count: "exact", head: true })
            .eq("request_id", requestId)
            .is("removed_at", null)
        expect(row.item_count).toBe(count)

        const { data: [overview] } = await (await clientFor("dealOwner")).rpc("sor_purchase_request_overview", { p_opportunity_id: sorId })
        const shown = overview.items.map((i) => i.id)
        expect(shown).toContain(kept)
        expect(shown).not.toContain(id)
    })

    it("can't be edited, removed again, or moved after", async () => {
        const id = await addOne()
        await remove("dealOwner", id)
        expect((await edit("dealOwner", id, { name: `${MARKER} Again`, quantity: 1 })).error?.code).toBe("22023")
        expect((await remove("dealOwner", id)).error?.code).toBe("22023")
        const moved = await (await clientFor("stageParticipant")).rpc("purchase_request_set_item_status", { p_item_id: id, p_status: "available" })
        expect(moved.error?.message).toMatch(/was removed/)
    })
})

describe("who and what", () => {
    it("refuses someone who isn't in the request", async () => {
        const id = await addOne()
        expect((await edit("ordinary", id, { name: `${MARKER} Nope`, quantity: 1 })).error?.code).toBe("42501")
        expect((await remove("ordinary", id)).error?.code).toBe("42501")
        expect((await item(id)).removed_at).toBeNull()
    })

    it("refuses a product already on a P0", async () => {
        const id = await addOne()
        await svc().from("purchase_request_items").update({ po_number: "P09999" }).eq("id", id)
        const edited = await edit("dealOwner", id, { name: `${MARKER} Changed`, quantity: 1 })
        expect(edited.error?.code).toBe("22023")
        expect(edited.error.message).toMatch(/on a P0/)
        expect((await remove("dealOwner", id)).error?.code).toBe("22023")
    })

    it("refuses a product that comes from the S0", async () => {
        const { data, error } = await svc()
            .from("purchase_request_items")
            .insert({ request_id: requestId, source: "sor_line", name: `${MARKER} S0 line`, quantity: 1, requested_by: ids.dealOwner })
            .select("id")
            .single()
        if (error) throw error
        expect((await edit("dealOwner", data.id, { name: `${MARKER} Changed`, quantity: 1 })).error?.code).toBe("22023")
        expect((await remove("dealOwner", data.id)).error?.code).toBe("22023")
    })

    it.each([
        ["purchase_request_edit_item", { p_item_id: NO_ID, p_item: {} }],
        ["purchase_request_remove_item", { p_item_id: NO_ID }],
    ])("someone not signed in cannot call %s", async (fn, args) => {
        const { error } = await anonymousClient().rpc(fn, args)
        expect(error?.message).toMatch(/permission denied/i)
    })
})
