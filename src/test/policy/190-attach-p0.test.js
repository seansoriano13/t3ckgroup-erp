/**
 * Attach P0 (#684, 20261104190000_attach_p0_to_requested_item.sql): nobody picks Purchased or
 * Received by hand; `purchase_request_item_attach_po` (server only) sets the line from the P0
 * facts Odoo gave the edge function.
 *
 * `stageParticipant` is the Buyer (given Purchasing access here); `dealOwner` is on the sales side.
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

const seedItem = (status = "to_purchase") =>
    insert("purchase_request_items", {
        request_id: requestId,
        source: "new",
        name: `${MARKER} Harness`,
        unit: "pc",
        quantity: 10,
        status,
        requested_by: ids.dealOwner,
    })

const attach = (who, itemId, facts, po = "P01234") =>
    svc().rpc("purchase_request_item_attach_po", { p_actor_email: castEmail(who), p_item_id: itemId, p_po_number: po, p_facts: facts })

const byHand = async (who, itemId, status) =>
    (await clientFor(who)).rpc("purchase_request_set_item_status", { p_item_id: itemId, p_status: status })

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

describe("Purchased and Received are never chosen by hand", () => {
    it.each(["purchased", "received"])("refuses %s from Purchasing", async (status) => {
        const id = await seedItem()
        const { error } = await byHand("stageParticipant", id, status)
        expect(error?.code).toBe("42501")
    })

    it("still allows To purchase to Still canvassing", async () => {
        const id = await seedItem()
        const { error } = await byHand("stageParticipant", id, "still_canvassing")
        expect(error).toBeNull()
    })
})

describe("attaching a P0", () => {
    it("an RFQ leaves the line To purchase and keeps the number", async () => {
        const id = await seedItem()
        const { data, error } = await attach("stageParticipant", id, { state: "rfq", ordered: 10, received: 0, bought_as: "Harness XL" })
        expect(error).toBeNull()
        expect(data).toMatchObject({ status: "to_purchase", po_number: "P01234", po_state: "rfq", bought_as: "Harness XL" })
    })

    it("a confirmed P0 makes the line Purchased", async () => {
        const id = await seedItem()
        const { data } = await attach("stageParticipant", id, { state: "confirmed", ordered: 10, received: 3, bought_as: "Harness" })
        expect(data).toMatchObject({ status: "purchased", po_verification: "VERIFIED" })
    })

    it("a fully received P0 makes the line Received", async () => {
        const id = await seedItem()
        const { data } = await attach("stageParticipant", id, { state: "confirmed", ordered: 10, received: 10 })
        expect(data).toMatchObject({ status: "received" })
    })

    it("refuses Cancelled and Received lines, the sales side, and a bad P0 number", async () => {
        for (const status of ["cancelled", "received"]) {
            const id = await seedItem(status)
            expect((await attach("stageParticipant", id, { state: "confirmed", ordered: 1, received: 0 })).error).not.toBeNull()
        }
        const id = await seedItem()
        expect((await attach("dealOwner", id, { state: "confirmed", ordered: 1, received: 0 })).error?.code).toBe("42501")
        expect((await attach("stageParticipant", id, { state: "confirmed", ordered: 1, received: 0 }, "PO-12")).error?.code).toBe("22023")
    })

    it("is not callable by a signed-in user or anonymously", async () => {
        const id = await seedItem()
        const args = { p_actor_email: castEmail("stageParticipant"), p_item_id: id, p_po_number: "P01234", p_facts: { state: "rfq" } }
        expect((await (await clientFor("stageParticipant")).rpc("purchase_request_item_attach_po", args)).error).not.toBeNull()
        expect((await anonymousClient().rpc("purchase_request_item_attach_po", args)).error).not.toBeNull()
    })
})
