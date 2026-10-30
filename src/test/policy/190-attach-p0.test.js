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

// #804: `lineIds` is the P0 rows the edge function picked; left out, the database default (null) applies.
const attach = (who, itemId, facts, po = "P01234", lineIds) =>
    svc().rpc("purchase_request_item_attach_po", {
        p_actor_email: castEmail(who),
        p_item_id: itemId,
        p_po_number: po,
        p_facts: facts,
        ...(lineIds === undefined ? {} : { p_line_ids: lineIds }),
    })

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

    it("a Received line takes a different P0: status comes from the facts and lines picked on the old P0 are cleared", async () => {
        const id = await seedItem()
        const first = await attach("stageParticipant", id, { state: "confirmed", ordered: 10, received: 10 }, "P01234")
        expect(first.data).toMatchObject({ status: "received", po_number: "P01234" })
        const picked = await svc().from("purchase_request_items").update({ odoo_po_line_ids: [111, 222] }).eq("id", id)
        expect(picked.error).toBeNull()

        const { data, error } = await attach("stageParticipant", id, { state: "confirmed", ordered: 10, received: 4 }, "P05678")
        expect(error).toBeNull()
        expect(data).toMatchObject({ status: "purchased", po_number: "P05678", po_received: 4, odoo_po_line_ids: [] })
    })

    it("#804: stores the P0 line ids it is given, and a re-attach of the same P0 with new ids replaces them", async () => {
        const id = await seedItem()
        const first = await attach("stageParticipant", id, { state: "confirmed", ordered: 10, received: 0 }, "P01234", [701, 702])
        expect(first.error).toBeNull()
        expect(first.data).toMatchObject({ odoo_po_line_ids: [701, 702] })

        const again = await attach("stageParticipant", id, { state: "confirmed", ordered: 10, received: 0 }, "P01234", [703])
        expect(again.data).toMatchObject({ odoo_po_line_ids: [703] })
    })

    it("#804: a re-attach of a different P0 clears the old lines and stores the new ones", async () => {
        const id = await seedItem()
        await attach("stageParticipant", id, { state: "confirmed", ordered: 10, received: 0 }, "P01234", [701, 702])
        const { data, error } = await attach("stageParticipant", id, { state: "confirmed", ordered: 10, received: 0 }, "P05678", [811])
        expect(error).toBeNull()
        expect(data).toMatchObject({ po_number: "P05678", odoo_po_line_ids: [811] })
    })

    it("#804: a re-attach of a different P0 with no ids clears the old lines", async () => {
        const id = await seedItem()
        await attach("stageParticipant", id, { state: "confirmed", ordered: 10, received: 0 }, "P01234", [701])
        const { data } = await attach("stageParticipant", id, { state: "confirmed", ordered: 10, received: 0 }, "P05678")
        expect(data).toMatchObject({ po_number: "P05678", odoo_po_line_ids: [] })
    })

    it("#804: the Pick P0 line rows read name and quantity from the live IPAS copy", async () => {
        const id = await seedItem()
        await attach("stageParticipant", id, { state: "confirmed", ordered: 10, received: 0 }, "P04804")
        const { error: ipasError } = await svc().from("ipas").insert({
            po_number: "P04804",
            priority: "medium",
            source: "local",
            purpose: "inventory",
            state: "open",
            odoo_copy: { po: { name: "P04804" }, lines: [{ line_id: 701, name: "Harness XL", quantity: 4 }, { line_id: 702, name: "Lanyard", quantity: 6 }] },
        })
        expect(ipasError).toBeNull()
        const { data, error } = await (await clientFor("stageParticipant")).rpc("purchase_request_item_po_line_rows", { p_item_id: id })
        expect(error).toBeNull()
        expect(data).toEqual([
            { line_id: 701, product_name: "Harness XL", quantity: 4 },
            { line_id: 702, product_name: "Lanyard", quantity: 6 },
        ])
    })

    it("refuses a Cancelled line", async () => {
        const id = await seedItem("cancelled")
        const { error } = await attach("stageParticipant", id, { state: "confirmed", ordered: 1, received: 0 })
        expect(error).not.toBeNull()
        expect(error.code).toBe("22023")
    })

    it("refuses the sales side and a bad P0 number", async () => {
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
