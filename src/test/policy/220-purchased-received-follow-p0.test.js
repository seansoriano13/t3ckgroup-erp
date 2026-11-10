/**
 * #685: Purchased and Received follow the P0 in Odoo. `purchase_request_sync_po_facts` (server
 * only) sets each line from the facts the odoo-po-sync edge function read; nobody picks them by hand.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded, castEmail } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
let sorId, requestId

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

const seedItem = (extra = {}) =>
    insert("purchase_request_items", {
        request_id: requestId,
        source: "new",
        name: `${MARKER} Harness`,
        unit: "pc",
        quantity: 6,
        status: "to_purchase",
        po_number: "P01234",
        requested_by: ids.dealOwner,
        ...extra,
    })

const sync = (who, facts, request = requestId) =>
    svc().rpc("purchase_request_sync_po_facts", { p_actor_email: castEmail(who), p_request_id: request, p_facts: facts })

const row = async (id) => (await svc().from("purchase_request_items").select("*").eq("id", id).single()).data

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.stageParticipant)
    if (flag.error) throw flag.error
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    requestId = await insert("purchase_requests", { opportunity_id: sorId, created_by: ids.dealOwner, buyer_id: ids.stageParticipant })
    for (const [employee, side] of [["dealOwner", "sales"], ["stageParticipant", "purchasing"]]) {
        await insert("purchase_request_members", { request_id: requestId, employee_id: ids[employee], side })
    }
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.stageParticipant)
    if (requestId) await svc().from("purchase_requests").delete().eq("id", requestId)
    if (sorId) await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("the line follows the P0 in Odoo", () => {
    it("an RFQ confirmed in Odoo turns the line Purchased, with its ETA", async () => {
        const id = await seedItem()
        const { data, error } = await sync("dealOwner", [{ item_id: id, state: "confirmed", ordered: 6, received: 0, eta: "2026-11-12", bought_as: "Harness XL" }])
        expect(error).toBeNull()
        expect(data).toBe(1)
        expect(await row(id)).toMatchObject({ status: "purchased", po_state: "confirmed", po_eta: "2026-11-12", bought_as: "Harness XL" })
    })

    it("a partial receipt keeps it Purchased with the quantities; a full receipt makes it Received", async () => {
        const id = await seedItem({ status: "purchased" })
        await sync("dealOwner", [{ item_id: id, state: "confirmed", ordered: 6, received: 3, eta: null }])
        expect(await row(id)).toMatchObject({ status: "purchased", po_ordered: 6, po_received: 3, po_eta: null })
        await sync("dealOwner", [{ item_id: id, state: "confirmed", ordered: 6, received: 6, eta: null }])
        expect(await row(id)).toMatchObject({ status: "received" })
    })

    it("an RFQ keeps the line To purchase", async () => {
        const id = await seedItem()
        const { data } = await sync("dealOwner", [{ item_id: id, state: "rfq", ordered: 6, received: 0 }])
        expect(data).toBe(0)
        expect(await row(id)).toMatchObject({ status: "to_purchase", po_state: "rfq" })
    })

    it("leaves Cancelled lines and lines with no P0 alone", async () => {
        const cancelled = await seedItem({ status: "cancelled" })
        const noPo = await seedItem({ po_number: null })
        await sync("dealOwner", [
            { item_id: cancelled, state: "confirmed", ordered: 6, received: 0 },
            { item_id: noPo, state: "confirmed", ordered: 6, received: 0 },
        ])
        expect((await row(cancelled)).status).toBe("cancelled")
        expect((await row(noPo)).status).toBe("to_purchase")
    })

    it("an empty answer changes nothing", async () => {
        const id = await seedItem({ status: "purchased" })
        const { data, error } = await sync("dealOwner", [])
        expect(error).toBeNull()
        expect(data).toBe(0)
        expect((await row(id)).status).toBe("purchased")
    })
})

describe("who may drive it", () => {
    it("refuses a person choosing Purchased or Received by hand", async () => {
        const id = await seedItem()
        for (const status of ["purchased", "received"]) {
            const { error } = await (await clientFor("stageParticipant")).rpc("purchase_request_set_item_status", { p_item_id: id, p_status: status })
            expect(error?.code).toBe("42501")
        }
    })

    it("is not callable by a signed-in user or anonymously, and refuses a non-member", async () => {
        const args = { p_actor_email: castEmail("dealOwner"), p_request_id: requestId, p_facts: [] }
        expect((await (await clientFor("dealOwner")).rpc("purchase_request_sync_po_facts", args)).error).not.toBeNull()
        expect((await anonymousClient().rpc("purchase_request_sync_po_facts", args)).error).not.toBeNull()
        expect((await sync("outsider", [])).error?.code).toBe("42501")
    })
})
