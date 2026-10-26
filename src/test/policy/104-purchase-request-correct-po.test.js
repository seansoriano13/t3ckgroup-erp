/**
 * Correct PO on an Ordered item (#549, spec #544): the 'correct' action of
 * `purchase_request_item_apply_po_check`. Purchasing only, while the item is Ordered; the new PO
 * gets the same three Odoo verdicts (Odoo faked by passing its answer), picked PO lines are
 * cleared, and the request's history records the old and new PO. Set-up follows
 * 103-purchase-request-po-check.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded, castEmail } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const PO = "P01234"
const OLD = "P01111"

let sorId, requestId

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

const seedItem = (fields = {}) =>
    insert("purchase_request_items", {
        request_id: requestId,
        source: "new",
        name: `${MARKER} Safety Boots`,
        unit: "pc",
        quantity: 10,
        status: "purchased",
        po_number: OLD,
        po_verification: "VERIFIED",
        odoo_po_line_ids: [501, 502],
        requested_by: ids.dealOwner,
        ...fields,
    })

async function item(id) {
    const { data, error } = await svc().from("purchase_request_items").select("*").eq("id", id).single()
    if (error) throw error
    return data
}

/** What the edge function does for Correct PO once it has Odoo's answer. */
const correct = (who, itemId, odoo, po = PO) =>
    svc().rpc("purchase_request_item_apply_po_check", {
        p_actor_email: castEmail(who),
        p_item_id: itemId,
        p_action: "correct",
        p_po_number: po,
        p_odoo: odoo,
    })

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.stageParticipant)
    if (flag.error) throw flag.error

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    requestId = await insert("purchase_requests", {
        opportunity_id: sorId,
        created_by: ids.dealOwner,
        buyer_id: ids.stageParticipant,
    })
    for (const [employee, side] of [
        ["dealOwner", "sales"],
        ["stageParticipant", "purchasing"],
    ]) {
        await insert("purchase_request_members", { request_id: requestId, employee_id: ids[employee], side })
    }
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.stageParticipant)
    if (requestId) await svc().from("purchase_requests").delete().eq("id", requestId)
    if (sorId) await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("Correct PO on an Ordered item", () => {
    it("Odoo has the new PO: verified, picked lines cleared, history shows old and new", async () => {
        const id = await seedItem()
        const { data, error } = await correct("stageParticipant", id, "found", " p01234 ")
        expect(error).toBeNull()
        expect(data).toMatchObject({ status: "purchased", po_number: PO, po_verification: "VERIFIED", odoo_po_line_ids: [] })
        expect(await item(id)).toMatchObject({ status: "purchased", po_number: PO, odoo_po_line_ids: [] })

        const { data: posts } = await svc()
            .from("purchase_request_messages")
            .select("content, metadata, author_id")
            .eq("request_id", requestId)
            .contains("metadata", { event: "item_po_corrected", item_id: id })
        expect(posts).toHaveLength(1)
        expect(posts[0].metadata).toMatchObject({ from_po: OLD, to_po: PO })
        expect(posts[0].content).toContain(OLD)
        expect(posts[0].content).toContain(PO)
        expect(posts[0].author_id).toBe(ids.stageParticipant)
    })

    it("Odoo doesn't answer: saved as not checked", async () => {
        const id = await seedItem()
        const { data, error } = await correct("stageParticipant", id, "unreachable")
        expect(error).toBeNull()
        expect(data).toMatchObject({ po_number: PO, po_verification: "PENDING_VERIFICATION", odoo_po_line_ids: [] })
    })

    it("Odoo says no such order: refused naming the PO; the old PO and its lines stay", async () => {
        const id = await seedItem()
        const { data, error } = await correct("stageParticipant", id, "not_found", "P09999")
        expect(data).toBeNull()
        expect(error?.code).toBe("22023")
        expect(error?.message).toMatch(/P09999/)
        expect(await item(id)).toMatchObject({ po_number: OLD, po_verification: "VERIFIED", odoo_po_line_ids: [501, 502] })
    })

    it("refuses a number that isn't an Odoo PO, and the same PO again", async () => {
        const id = await seedItem()
        expect((await correct("stageParticipant", id, "found", "PO-12")).error?.code).toBe("22023")
        expect((await correct("stageParticipant", id, "found", OLD)).error?.code).toBe("22023")
        expect(await item(id)).toMatchObject({ po_number: OLD, odoo_po_line_ids: [501, 502] })
    })

    it.each(["to_purchase", "still_canvassing", "received", "cancelled"])("refuses an item that is %s", async (status) => {
        const id = await seedItem({ status })
        const { error } = await correct("stageParticipant", id, "found")
        expect(error?.code).toBe("22023")
        expect(await item(id)).toMatchObject({ status, po_number: OLD, odoo_po_line_ids: [501, 502] })
    })

    it("refuses the sales side and non-members", async () => {
        const id = await seedItem()
        expect((await correct("dealOwner", id, "found")).error?.code).toBe("42501")
        expect((await correct("outsider", id, "found")).error?.code).toBe("42501")
        expect(await item(id)).toMatchObject({ po_number: OLD })
    })

    it("a signed-in caller can't reach it directly", async () => {
        const id = await seedItem()
        const { error } = await (await clientFor("stageParticipant")).rpc("purchase_request_item_apply_po_check", {
            p_actor_email: castEmail("stageParticipant"),
            p_item_id: id,
            p_action: "correct",
            p_po_number: PO,
            p_odoo: "found",
        })
        expect(error).not.toBeNull()
        expect(await item(id)).toMatchObject({ po_number: OLD })
    })
})
