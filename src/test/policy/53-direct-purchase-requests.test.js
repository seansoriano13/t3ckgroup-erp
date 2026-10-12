/**
 * Direct Purchase Requests (#179, follow-up to #209): any employee opens a
 * Purchase Request with no SOR, a title and new-product items, for Purchasing
 * to buy.
 *
 * `ordinary` is the Requester (no Purchasing access, on no Deal Team);
 * `outsider` is another employee who must not see it. `stageParticipant` is
 * given Purchasing access for this file only and is Purchasing. `hr` is given
 * Purchasing access too and opens one of their own. Assertions read as those
 * people.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const requests = []
const ITEM = { name: `${MARKER} Printer toner`, quantity: 2, unit: "pc" }

async function open(key, title = `${MARKER} Office supplies`, items = [ITEM]) {
    const client = await clientFor(key)
    const { data, error } = await client.rpc("purchase_request_open", { p_title: title, p_items: items })
    if (data) requests.push(data)
    return { data, error }
}

async function opened(key, ...args) {
    const { data, error } = await open(key, ...args)
    if (error) throw new Error(`Opening as ${key}: ${error.message}`)
    return data
}

async function items(requestId) {
    const { data, error } = await svc().from("purchase_request_items").select("id, status, source, requested_by").eq("request_id", requestId)
    if (error) throw error
    return data
}

beforeAll(async () => {
    await ensureCastLoaded()
    for (const key of ["stageParticipant", "hr"]) {
        const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids[key])
        if (flag.error) throw flag.error
    }
})

afterAll(async () => {
    if (requests.length) {
        await svc().from("notifications").delete().in("reference_id", requests)
        await svc().from("purchase_requests").delete().in("id", requests)
    }
    for (const key of ["stageParticipant", "hr"]) {
        await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids[key])
    }
})

describe("opening", () => {
    it("any employee opens one: no SOR, the title, the items, the Requester as a member", async () => {
        const id = await opened("ordinary")
        const { data: req } = await svc().from("purchase_requests").select("opportunity_id, title, created_by, buyer_id").eq("id", id).single()
        expect(req).toEqual({ opportunity_id: null, title: `${MARKER} Office supplies`, created_by: ids.ordinary, buyer_id: null })

        expect(await items(id)).toEqual([expect.objectContaining({ status: "requested", source: "new", requested_by: ids.ordinary })])

        const { data: members } = await svc().from("purchase_request_members").select("employee_id, side").eq("request_id", id)
        expect(members).toContainEqual({ employee_id: ids.ordinary, side: "requester" })
        expect(members).toContainEqual({ employee_id: ids.stageParticipant, side: "purchasing" })
    })

    it("any number may exist", async () => {
        const a = await opened("ordinary")
        const b = await opened("ordinary")
        expect(a).not.toBe(b)
    })

    it("tells Purchasing it needs a Buyer, and says so by its title", async () => {
        const id = await opened("ordinary")
        const client = await clientFor("stageParticipant")
        const { data } = await client.from("notifications").select("type, message").eq("reference_id", id)
        expect(data).toEqual([expect.objectContaining({ type: "PURCHASE_REQUEST_OPENED" })])
        expect(data[0].message).toContain(`${MARKER} Office supplies`)
        expect(data[0].message).toContain("Purchase Requests")
    })

    it("refuses no title, a long title, no items, and an item without a name", async () => {
        expect((await open("ordinary", "  ")).error?.message).toMatch(/needs a title/)
        expect((await open("ordinary", "x".repeat(121))).error?.message).toMatch(/120 characters/)
        expect((await open("ordinary", "Title", [])).error?.message).toMatch(/at least one item/)
        expect((await open("ordinary", "Title", [{ quantity: 1 }])).error?.message).toMatch(/needs a name/)
    })

    it("a refused item opens nothing", async () => {
        const before = (await svc().from("purchase_requests").select("id").eq("created_by", ids.ordinary)).data.length
        await open("ordinary", `${MARKER} Half`, [ITEM, { name: "Bad", quantity: 0 }])
        const after = (await svc().from("purchase_requests").select("id").eq("created_by", ids.ordinary)).data.length
        expect(after).toBe(before)
    })

    it("refuses anonymous callers", async () => {
        const { error } = await anonymousClient().rpc("purchase_request_open", { p_title: "x", p_items: [ITEM] })
        expect(error).not.toBeNull()
    })

    it("a request with no SOR still needs a title, however it is written", async () => {
        const { error } = await svc().from("purchase_requests").insert({ created_by: ids.ordinary })
        expect(error?.message).toMatch(/purchase_requests_title_chk/)
    })
})

describe("reading", () => {
    it("the Requester and Purchasing read it; another employee does not", async () => {
        const id = await opened("ordinary")
        for (const key of ["ordinary", "stageParticipant"]) {
            const client = await clientFor(key)
            const { data } = await client.rpc("purchase_request_queue", { p_request_id: id })
            expect(data, key).toEqual([expect.objectContaining({ id, opportunity_id: null, title: `${MARKER} Office supplies` })])
        }
        const client = await clientFor("outsider")
        const { data } = await client.rpc("purchase_request_queue", { p_request_id: id })
        expect(data).toEqual([])
        const { data: rows } = await client.from("purchase_requests").select("id").eq("id", id)
        expect(rows).toEqual([])
    })
})

describe("the Requester", () => {
    it("adds items, cancels them, and nothing more", async () => {
        const id = await opened("ordinary")
        const client = await clientFor("ordinary")
        expect((await client.rpc("purchase_request_actor_side", { p_request_id: id })).data).toBe("requester")

        const added = await client.rpc("purchase_request_add_new_item", { p_request_id: id, p_name: `${MARKER} Stapler`, p_quantity: 1 })
        expect(added.error).toBeNull()

        const [first] = await items(id)
        const moved = await client.rpc("purchase_request_set_item_status", { p_item_id: first.id, p_status: "to_order" })
        expect(moved.error?.message).toMatch(/can't move/)
        const cancelled = await client.rpc("purchase_request_set_item_status", { p_item_id: first.id, p_status: "cancelled" })
        expect(cancelled.error).toBeNull()

        const take = await client.rpc("purchase_request_take", { p_request_id: id })
        expect(take.error).not.toBeNull()
        const add = await client.rpc("purchase_request_add_member", { p_request_id: id, p_employee_id: ids.outsider })
        expect(add.error).not.toBeNull()
    })

    it("chats, and the Buyer hears", async () => {
        const id = await opened("ordinary")
        const purchaser = await clientFor("stageParticipant")
        expect((await purchaser.rpc("purchase_request_take", { p_request_id: id })).error).toBeNull()

        const client = await clientFor("ordinary")
        const sent = await client.from("purchase_request_messages").insert({ request_id: id, author_id: ids.ordinary, content: "Any update?" })
        expect(sent.error).toBeNull()
        const { data } = await purchaser.from("notifications").select("type").eq("reference_id", id).eq("type", "PURCHASE_REQUEST_MESSAGE")
        expect(data).toHaveLength(1)
    })
})

describe("Purchasing", () => {
    it("takes it and buys it through to Received; the Requester hears each step", async () => {
        const id = await opened("ordinary")
        const purchaser = await clientFor("stageParticipant")
        expect((await purchaser.rpc("purchase_request_take", { p_request_id: id })).error).toBeNull()

        const [item] = await items(id)
        for (const status of ["to_order", "ordered", "received"]) {
            const { error } = await purchaser.rpc("purchase_request_set_item_status", { p_item_id: item.id, p_status: status })
            expect(error, status).toBeNull()
        }
        const client = await clientFor("ordinary")
        const { data } = await client.from("notifications").select("type").eq("reference_id", id).eq("type", "PURCHASE_REQUEST_ITEM_STATUS")
        expect(data).toHaveLength(3)
    })

    it("a Requester with Purchasing access may take and buy their own", async () => {
        const id = await opened("hr")
        const client = await clientFor("hr")
        expect((await client.rpc("purchase_request_actor_side", { p_request_id: id })).data).toBe("purchasing")
        expect((await client.rpc("purchase_request_add_new_item", { p_request_id: id, p_name: `${MARKER} Cable`, p_quantity: 1 })).error).toBeNull()
        expect((await client.rpc("purchase_request_take", { p_request_id: id })).error).toBeNull()
        const [item] = await items(id)
        expect((await client.rpc("purchase_request_set_item_status", { p_item_id: item.id, p_status: "from_stock" })).error).toBeNull()
    })
})

describe("Purchasing access lost", () => {
    it("the Requester stays on the request, back on the requester side", async () => {
        const id = await opened("hr")
        await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.hr)
        try {
            const { data } = await svc().from("purchase_request_members").select("side").eq("request_id", id).eq("employee_id", ids.hr)
            expect(data).toEqual([{ side: "requester" }])
        } finally {
            await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.hr)
        }
    })
})
