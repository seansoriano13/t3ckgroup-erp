/**
 * The request's Chat, the Buyer and who hears about what (#307, part of #209).
 *
 * `stageParticipant` and `outsider` are given Purchasing access here and are
 * purchasing members; `dealOwner` is on the sales side and asked for the
 * items; `hr` is a member on the other side; `ordinary` is not a member.
 * Notifications are read back with the service role, so a pass is the
 * database's routing and not a policy's.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const PURCHASERS = ["stageParticipant", "outsider"]
const requests = []
const sors = []

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

/** A request with the usual members and one item asked for by the Deal Owner. */
async function newRequest({ buyer = null } = {}) {
    const sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sors.push(sorId)
    const requestId = await insert("purchase_requests", {
        opportunity_id: sorId,
        created_by: ids.dealOwner,
        buyer_id: buyer ? ids[buyer] : null,
    })
    requests.push(requestId)
    for (const [employee, side] of [
        ["dealOwner", "sales"],
        ["stageParticipant", "purchasing"],
        ["outsider", "purchasing"],
        ["hr", "other"],
    ]) {
        await insert("purchase_request_members", { request_id: requestId, employee_id: ids[employee], side })
    }
    const itemId = await insert("purchase_request_items", {
        request_id: requestId,
        source: "new",
        name: `${MARKER} Safety Goggles`,
        quantity: 4,
        requested_by: ids.dealOwner,
    })
    return { requestId, itemId }
}

/** Who was notified about this request, as `{ key: [types] }` over the cast. */
async function notified(requestId) {
    const { data, error } = await svc()
        .from("notifications")
        .select("recipient_id, type")
        .eq("reference_id", requestId)
    if (error) throw error
    const byKey = {}
    for (const row of data) {
        const key = Object.keys(ids).find((k) => ids[k] === row.recipient_id) ?? row.recipient_id
        ;(byKey[key] ||= []).push(row.type)
    }
    return byKey
}

const clearNotifications = (requestId) => svc().from("notifications").delete().eq("reference_id", requestId)

const post = async (who, requestId, content, metadata = {}) =>
    (await clientFor(who))
        .from("purchase_request_messages")
        .insert({ request_id: requestId, author_id: ids[who], content, metadata })
        .select("id")

const setStatus = async (who, itemId, status) =>
    (await clientFor(who)).rpc("pr_set_item_status", { p_item_id: itemId, p_status: status })

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).in("id", PURCHASERS.map((k) => ids[k]))
    if (flag.error) throw flag.error
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", PURCHASERS.map((k) => ids[k]))
    for (const id of requests) {
        await svc().from("notifications").delete().eq("reference_id", id)
        await svc().from("sor_stage_participants").delete().eq("source_id", id)
        await svc().from("purchase_requests").delete().eq("id", id)
    }
    if (sors.length) await svc().from("sales_opportunities").delete().in("id", sors)
})

describe("the Chat", () => {
    let requestId
    beforeAll(async () => {
        ;({ requestId } = await newRequest({ buyer: "outsider" }))
    })

    it.each(["dealOwner", "stageParticipant", "hr"])("a member (%s) posts and reads", async (who) => {
        const { error } = await post(who, requestId, `${MARKER} hello from ${who}`)
        expect(error).toBeNull()
        const { data, error: readError } = await (await clientFor(who))
            .from("purchase_request_messages")
            .select("content")
            .eq("request_id", requestId)
        expect(readError).toBeNull()
        expect(data.map((m) => m.content)).toContain(`${MARKER} hello from ${who}`)
    })

    it("a non-member can neither post nor read", async () => {
        const { error } = await post("ordinary", requestId, `${MARKER} let me in`)
        expect(error?.code).toBe("42501")
        const { data } = await (await clientFor("ordinary"))
            .from("purchase_request_messages")
            .select("id")
            .eq("request_id", requestId)
        expect(data).toEqual([])
    })
})

describe("opening an unassigned request", () => {
    it("notifies every Purchasing flag holder, once", async () => {
        const { requestId } = await newRequest()
        const opened = { request_id: requestId, author_id: ids.dealOwner, content: "Purchase Request opened.", metadata: { event: "opened" } }
        await insert("purchase_request_messages", opened)

        const first = await notified(requestId)
        expect(first.stageParticipant).toEqual(["PURCHASE_REQUEST_OPENED"])
        expect(first.outsider).toEqual(["PURCHASE_REQUEST_OPENED"])
        expect(first.dealOwner).toBeUndefined()
        expect(first.hr).toBeUndefined()

        // An `opened` posted again (it shouldn't be) notifies nobody.
        await insert("purchase_request_messages", opened)
        expect(await notified(requestId)).toEqual(first)
    })

    it("with a Buyer already, tells only the Buyer", async () => {
        const { requestId } = await newRequest({ buyer: "stageParticipant" })
        await insert("purchase_request_messages", {
            request_id: requestId, author_id: ids.dealOwner, content: "Purchase Request opened.", metadata: { event: "opened" },
        })
        expect(await notified(requestId)).toEqual({ stageParticipant: ["PURCHASE_REQUEST_BUYER"] })
    })
})

describe("before a Buyer", () => {
    let requestId, itemId
    beforeAll(async () => {
        ;({ requestId, itemId } = await newRequest())
    })
    beforeEach(() => clearNotifications(requestId))

    it("a status change tells only the requester", async () => {
        const { error } = await setStatus("stageParticipant", itemId, "to_order")
        expect(error).toBeNull()
        expect(await notified(requestId)).toEqual({ dealOwner: ["PURCHASE_REQUEST_ITEM_STATUS"] })
    })

    it("a message doesn't flood purchasing", async () => {
        await post("dealOwner", requestId, `${MARKER} any update?`)
        expect(await notified(requestId)).toEqual({})
    })
})

describe("Take", () => {
    let requestId
    beforeAll(async () => {
        ;({ requestId } = await newRequest())
    })

    it("refuses someone without Purchasing access", async () => {
        const { error } = await (await clientFor("dealOwner")).rpc("pr_take", { p_request_id: requestId })
        expect(error?.code).toBe("42501")
    })

    it("makes a purchaser the Buyer, and posts it", async () => {
        const { data, error } = await (await clientFor("outsider")).rpc("pr_take", { p_request_id: requestId })
        expect(error).toBeNull()
        expect(data.buyer_id).toBe(ids.outsider)
        const { data: events } = await svc()
            .from("purchase_request_messages")
            .select("author_id, metadata")
            .eq("request_id", requestId)
            .contains("metadata", { event: "buyer_set" })
        expect(events).toEqual([
            expect.objectContaining({ author_id: ids.outsider, metadata: expect.objectContaining({ buyer_id: ids.outsider, taken: true }) }),
        ])
    })

    it("is refused once someone has it", async () => {
        const { error } = await (await clientFor("stageParticipant")).rpc("pr_take", { p_request_id: requestId })
        expect(error?.code).toBe("55000")
        expect(error?.message).toMatch(/already the Buyer/)
    })
})

describe("after Take", () => {
    let requestId, itemId
    beforeAll(async () => {
        ;({ requestId, itemId } = await newRequest())
        const { error } = await (await clientFor("outsider")).rpc("pr_take", { p_request_id: requestId })
        if (error) throw error
    })
    beforeEach(() => clearNotifications(requestId))

    it("a status change tells only the Buyer and the requester", async () => {
        const { error } = await setStatus("stageParticipant", itemId, "to_order")
        expect(error).toBeNull()
        expect(await notified(requestId)).toEqual({
            outsider: ["PURCHASE_REQUEST_ITEM_STATUS"],
            dealOwner: ["PURCHASE_REQUEST_ITEM_STATUS"],
        })
    })

    it("a message tells only the Buyer and the requester", async () => {
        await post("hr", requestId, `${MARKER} delivery address changed`)
        expect(await notified(requestId)).toEqual({
            outsider: ["PURCHASE_REQUEST_MESSAGE"],
            dealOwner: ["PURCHASE_REQUEST_MESSAGE"],
        })
    })

    it("nobody hears about their own message", async () => {
        await post("outsider", requestId, `${MARKER} ordering today`)
        expect(await notified(requestId)).toEqual({ dealOwner: ["PURCHASE_REQUEST_MESSAGE"] })
    })

    it("a mention always notifies the member mentioned, instead of the ordinary notification", async () => {
        const { error } = await post("hr", requestId, `${MARKER} @Stage Participant and @Deal Owner, see this`, {
            mentions: [
                { id: ids.stageParticipant, name: "Stage Participant" },
                { id: ids.dealOwner, name: "Deal Owner" },
            ],
        })
        expect(error).toBeNull()
        expect(await notified(requestId)).toEqual({
            stageParticipant: ["PURCHASE_REQUEST_MENTION"],
            dealOwner: ["PURCHASE_REQUEST_MENTION"],
            outsider: ["PURCHASE_REQUEST_MESSAGE"],
        })
    })

    it("a mention of a non-member is ignored", async () => {
        await post("hr", requestId, `${MARKER} @Ordinary Employee`, {
            mentions: [{ id: ids.ordinary, name: "Ordinary Employee" }],
        })
        expect((await notified(requestId)).ordinary).toBeUndefined()
    })
})

describe("setting the Buyer", () => {
    let requestId
    beforeAll(async () => {
        ;({ requestId } = await newRequest({ buyer: "outsider" }))
    })
    beforeEach(() => clearNotifications(requestId))

    const setBuyer = async (who, employee) =>
        (await clientFor(who)).rpc("pr_set_buyer", { p_request_id: requestId, p_employee_id: employee ? ids[employee] : null })

    it("is refused to the sales side", async () => {
        const { error } = await setBuyer("dealOwner", "stageParticipant")
        expect(error?.code).toBe("42501")
    })

    it("refuses someone without Purchasing access as Buyer", async () => {
        const { error } = await setBuyer("outsider", "hr")
        expect(error?.code).toBe("22023")
    })

    it("hands the request to another purchaser, who is told", async () => {
        const { data, error } = await setBuyer("outsider", "stageParticipant")
        expect(error).toBeNull()
        expect(data.buyer_id).toBe(ids.stageParticipant)
        expect(await notified(requestId)).toEqual({ stageParticipant: ["PURCHASE_REQUEST_BUYER"] })
    })

    it("a Super Admin can clear it, sending it back to the queue", async () => {
        const { data, error } = await setBuyer("superAdmin", null)
        expect(error).toBeNull()
        expect(data.buyer_id).toBeNull()
        expect(await notified(requestId)).toEqual({})
    })
})
