/**
 * Follow-ups to #209: the Buyer hears when the SOR closes or comes back, and
 * Purchasing membership follows the access when it is granted or taken away.
 *
 * `outsider` is the Buyer where there is one; `stageParticipant` is a
 * purchasing member and `dealOwner` a sales member. `hr` is the one whose
 * Purchasing access changes. Assertions read as those people.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const requests = []
const sors = []
const stage = {}
let saleTypeId, flowId
// hr's rows from before this file, so teardown removes only what it caused.
let hrMembersBefore = []
let hrWindowsBefore = []

async function one(query, what) {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

/** A request on an SOR at the open Stage, with members and one item per status. */
async function newRequest({ buyer = null, items = ["requested"], members = [] } = {}) {
    const sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stage.open })
    sors.push(sorId)
    const req = await one(
        svc()
            .from("purchase_requests")
            .insert({ opportunity_id: sorId, created_by: ids.dealOwner, buyer_id: buyer ? ids[buyer] : null })
            .select("id")
            .single(),
        "Seeding a request",
    )
    requests.push(req.id)
    const people = [...members, ...(buyer ? [[buyer, "purchasing"]] : [])]
    for (const [key, side] of people) {
        await one(svc().from("purchase_request_members").insert({ request_id: req.id, employee_id: ids[key], side }), "Seeding a member")
    }
    for (const status of items) {
        await one(
            svc()
                .from("purchase_request_items")
                .insert({ request_id: req.id, source: "new", name: `${MARKER} Cable`, quantity: 1, status, requested_by: ids.dealOwner }),
            "Seeding an item",
        )
    }
    return { id: req.id, sorId }
}

const setSor = (sorId, patch) => one(svc().from("sales_opportunities").update(patch).eq("id", sorId), "Updating an SOR")

const setHrAccess = (on) => sql().query("update employees set has_purchasing_flow = $2 where id = $1", [ids.hr, on])

/** The notification types `key` can see for this request. */
async function notified(key, requestId) {
    const client = await clientFor(key)
    const data = await one(client.from("notifications").select("type").eq("reference_id", requestId).order("created_at"), "Reading notifications")
    return data.map((n) => n.type)
}

/** hr's memberships among `requestIds`, read as hr, as `{ requestId: side }`. */
async function hrSides(requestIds) {
    const client = await clientFor("hr")
    const data = await one(
        client.from("purchase_request_members").select("request_id, side").eq("employee_id", ids.hr).in("request_id", requestIds),
        "Reading memberships",
    )
    return Object.fromEntries(data.map((m) => [m.request_id, m.side]))
}

async function hrWindow(requestId) {
    const { rows } = await sql().query(
        "select closed_reason from sor_stage_participants where source = 'purchase_request' and source_id = $1 and employee_id = $2",
        [requestId, ids.hr],
    )
    return rows
}

beforeAll(async () => {
    await ensureCastLoaded()
    saleTypeId = (await one(svc().from("sale_types").insert({ name: `${MARKER} Followups` }).select("id").single(), "Seeding a Sale Type")).id
    flowId = (await one(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "Seeding a flow")).id
    const stages = await one(
        svc()
            .from("flow_stages")
            .insert([
                { flow_id: flowId, name: `${MARKER} Open`, sort_order: 0, is_terminal: false },
                { flow_id: flowId, name: `${MARKER} Won`, sort_order: 1, is_terminal: true },
                { flow_id: flowId, name: `${MARKER} Lost`, sort_order: 2, is_terminal: true },
            ])
            .select("id, sort_order"),
        "Seeding Stages",
    )
    ;[stage.open, stage.won, stage.lost] = stages.sort((a, b) => a.sort_order - b.sort_order).map((s) => s.id)
    await one(svc().from("sales_flows").update({ won_stage_id: stage.won }).eq("id", flowId), "Naming the Won Stage")

    hrMembersBefore = (await sql().query("select id from purchase_request_members where employee_id = $1", [ids.hr])).rows.map((r) => r.id)
    hrWindowsBefore = (
        await sql().query("select id from sor_stage_participants where source = 'purchase_request' and employee_id = $1", [ids.hr])
    ).rows.map((r) => r.id)
})

afterAll(async () => {
    await setHrAccess(false)
    // Granting access adds hr to every live request in the database, not only
    // this file's; take back everything that wasn't there before.
    await sql().query("delete from purchase_request_members where employee_id = $1 and not (id = any($2::uuid[]))", [ids.hr, hrMembersBefore])
    await sql().query(
        "delete from sor_stage_participants where source = 'purchase_request' and employee_id = $1 and not (id = any($2::uuid[]))",
        [ids.hr, hrWindowsBefore],
    )
    if (requests.length) {
        await svc().from("notifications").delete().in("reference_id", requests)
        await svc().from("purchase_requests").delete().in("id", requests)
    }
    if (sors.length) await svc().from("sales_opportunities").delete().in("id", sors)
    await svc().from("sales_flows").update({ won_stage_id: null }).eq("id", flowId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("the SOR closes", () => {
    it("deleted: tells the Buyer once while items are open", async () => {
        const { id, sorId } = await newRequest({ buyer: "outsider" })
        await setSor(sorId, { is_deleted: true })
        expect(await notified("outsider", id)).toEqual(["PURCHASE_REQUEST_SOR_CLOSED"])
    })

    it("deleted: stays quiet once every item is closed", async () => {
        const { id, sorId } = await newRequest({ buyer: "outsider", items: ["received"] })
        await setSor(sorId, { is_deleted: true })
        expect(await notified("outsider", id)).toEqual([])
    })

    it("lost: tells the Buyer", async () => {
        const { id, sorId } = await newRequest({ buyer: "outsider" })
        await setSor(sorId, { flow_stage_id: stage.lost })
        expect(await notified("outsider", id)).toEqual(["PURCHASE_REQUEST_SOR_CLOSED"])
    })

    it("won: stays quiet", async () => {
        const { id, sorId } = await newRequest({ buyer: "outsider" })
        await setSor(sorId, { flow_stage_id: stage.won })
        expect(await notified("outsider", id)).toEqual([])
    })

    it("lost and then deleted is one closing", async () => {
        const { id, sorId } = await newRequest({ buyer: "outsider" })
        await setSor(sorId, { flow_stage_id: stage.lost })
        await setSor(sorId, { is_deleted: true })
        expect(await notified("outsider", id)).toEqual(["PURCHASE_REQUEST_SOR_CLOSED"])
    })

    it("restored: tells the Buyer it's back", async () => {
        const { id, sorId } = await newRequest({ buyer: "outsider" })
        await setSor(sorId, { is_deleted: true })
        await setSor(sorId, { is_deleted: false })
        expect(await notified("outsider", id)).toEqual(["PURCHASE_REQUEST_SOR_CLOSED", "PURCHASE_REQUEST_SOR_REOPENED"])
    })

    it("with no Buyer, tells the purchasing members and not the sales side", async () => {
        const { id, sorId } = await newRequest({ members: [["stageParticipant", "purchasing"], ["dealOwner", "sales"]] })
        await setSor(sorId, { is_deleted: true })
        expect(await notified("stageParticipant", id)).toEqual(["PURCHASE_REQUEST_SOR_CLOSED"])
        expect(await notified("dealOwner", id)).toEqual([])
    })
})

describe("Purchasing access granted and taken away", () => {
    let live, empty, done, deleted, lost, existing, removed, bought

    beforeAll(async () => {
        live = await newRequest()
        empty = await newRequest({ items: [] })
        done = await newRequest({ items: ["cancelled"] })
        deleted = await newRequest()
        lost = await newRequest()
        existing = await newRequest({ members: [["hr", "other"]] })
        removed = await newRequest()
        bought = await newRequest({ buyer: "hr" })
        await setSor(deleted.sorId, { is_deleted: true })
        await setSor(lost.sorId, { flow_stage_id: stage.lost })

        // The SOR window needs the request to have been opened at a visit.
        const { rows } = await sql().query("select id from sor_stage_visits where opportunity_id = $1 order by sequence desc limit 1", [existing.sorId])
        await sql().query("update purchase_requests set opened_visit_id = $2, access_until = 'stage_left' where id = $1", [existing.id, rows[0].id])

        await setHrAccess(true)
    })

    it("joins live requests, empty ones included, but not finished ones or ones on a closed SOR", async () => {
        expect(await hrSides([live.id, empty.id, done.id, deleted.id, lost.id])).toEqual({
            [live.id]: "purchasing",
            [empty.id]: "purchasing",
        })
    })

    it("moves an existing member to the purchasing side and opens the SOR window", async () => {
        expect(await hrSides([existing.id])).toEqual({ [existing.id]: "purchasing" })
        expect(await hrWindow(existing.id)).toEqual([{ closed_reason: null }])
    })

    it("doesn't re-add someone a person removed when the access hasn't changed", async () => {
        await sql().query("delete from purchase_request_members where request_id = $1 and employee_id = $2", [removed.id, ids.hr])
        await setHrAccess(true)
        await sql().query("update employees set name = name where id = $1", [ids.hr])
        const { rows } = await sql().query("select 1 from purchase_request_members where request_id = $1 and employee_id = $2", [removed.id, ids.hr])
        expect(rows).toEqual([])
    })

    it("taken away: leaves the requests they were only buying for, stays where they're the Buyer, and the SOR window closes", async () => {
        await setHrAccess(false)
        expect(await hrSides([live.id, existing.id, bought.id])).toEqual({ [bought.id]: "other" })
        expect(await hrWindow(existing.id)).toEqual([{ closed_reason: "access_revoked" }])
    })
})

describe("the Procurement Queue", () => {
    const queueRow = async (requestId) => {
        const client = await clientFor("outsider")
        const rows = await one(client.rpc("pr_queue", { p_request_id: requestId }), "Reading the queue")
        return rows[0]
    }

    it("marks a request whose SOR was deleted or lost, and not one that's live or won", async () => {
        const [deleted, lost, live, won] = [await newRequest({ buyer: "outsider" }), await newRequest({ buyer: "outsider" }), await newRequest({ buyer: "outsider" }), await newRequest({ buyer: "outsider" })]
        await setSor(deleted.sorId, { is_deleted: true })
        await setSor(lost.sorId, { flow_stage_id: stage.lost })
        await setSor(won.sorId, { flow_stage_id: stage.won })
        expect((await queueRow(deleted.id)).sor_closed).toBe("deleted")
        expect((await queueRow(lost.id)).sor_closed).toBe("lost")
        expect((await queueRow(live.id)).sor_closed).toBeNull()
        expect((await queueRow(won.id)).sor_closed).toBeNull()
    })

    it("names an SOR with no Sales Reference by its SOR Code", async () => {
        const { id, sorId } = await newRequest({ buyer: "outsider" })
        const { rows } = await sql().query("select sor_code from sales_opportunities where id = $1", [sorId])
        expect(rows[0].sor_code).toMatch(/^SOR-/)
        expect((await queueRow(id)).sales_reference).toBe(rows[0].sor_code)
    })
})
