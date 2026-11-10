/**
 * The Procurement Queue's rows (#308, part of #209): `purchase_request_queue` returns the
 * requests the caller may read, no more, with the SOR's locked header, the
 * Buyer and item counts — read through the function because a purchaser
 * picking up an unassigned request can't read the SOR itself.
 *
 * `stageParticipant` and `outsider` are given Purchasing access here;
 * `outsider` is a member of nothing. `dealOwner` asked for the items;
 * `ordinary` is nobody to these requests.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded, anonymousClient } from "./support/cast.js"
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

async function newRequest({ buyer = null, statuses = [] } = {}) {
    const sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sors.push(sorId)
    const requestId = await insert("purchase_requests", {
        opportunity_id: sorId,
        created_by: ids.dealOwner,
        buyer_id: buyer ? ids[buyer] : null,
    })
    requests.push(requestId)
    await insert("purchase_request_members", { request_id: requestId, employee_id: ids.dealOwner, side: "sales" })
    if (buyer) await insert("purchase_request_members", { request_id: requestId, employee_id: ids[buyer], side: "purchasing" })
    for (const status of statuses) {
        await insert("purchase_request_items", {
            request_id: requestId,
            source: "new",
            name: `${MARKER} Carabiner`,
            quantity: 2,
            status,
            requested_by: ids.dealOwner,
        })
    }
    return requestId
}

const queueFor = async (who, args) => {
    const { data, error } = await (await clientFor(who)).rpc("purchase_request_queue", args)
    if (error) throw error
    return data.filter((r) => requests.includes(r.id))
}

let unassigned, assigned

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).in("id", PURCHASERS.map((k) => ids[k]))
    if (flag.error) throw flag.error
    unassigned = await newRequest({ statuses: ["not_checked", "received"] })
    assigned = await newRequest({ buyer: "stageParticipant", statuses: ["received", "cancelled"] })
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

describe("purchase_request_queue", () => {
    it("gives a purchaser who isn't a member the unassigned request only, with the SOR's header", async () => {
        const rows = await queueFor("outsider")
        expect(rows.map((r) => r.id)).toEqual([unassigned])
        expect(rows[0]).toMatchObject({
            project_title: `${MARKER} Rope Rescue Equipment`,
            buyer_id: null,
            item_count: 2,
            open_count: 1,
        })
        expect(rows[0].last_activity_at).toBeTruthy()
    })

    it("gives the Buyer their request, named, with every item closed", async () => {
        const rows = await queueFor("stageParticipant")
        const mine = rows.find((r) => r.id === assigned)
        expect(mine).toMatchObject({ buyer_id: ids.stageParticipant, item_count: 2, open_count: 0 })
        expect(mine.buyer_name).toBeTruthy()
    })

    it("gives a sales member both their requests", async () => {
        const rows = await queueFor("dealOwner")
        expect(rows.map((r) => r.id).sort()).toEqual([unassigned, assigned].sort())
    })

    it("gives someone who is nobody to the requests nothing", async () => {
        expect(await queueFor("ordinary")).toEqual([])
    })

    it("narrows to one request, and still only one the caller may read", async () => {
        expect((await queueFor("dealOwner", { p_request_id: assigned })).map((r) => r.id)).toEqual([assigned])
        expect(await queueFor("outsider", { p_request_id: assigned })).toEqual([])
    })

    it("is refused to the signed-out", async () => {
        const { error } = await anonymousClient().rpc("purchase_request_queue")
        expect(error).not.toBeNull()
    })
})
