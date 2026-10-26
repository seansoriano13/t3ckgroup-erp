/**
 * A signed-in caller can't set the Odoo check, and the server-only PO check keeps its rules
 * (#548, spec #544; the 'order' action became the P0 attach in #684, proven in 190-attach-p0).
 *
 * The `odoo-po-verify` edge function asks Odoo, then calls the service-role-only
 * `purchase_request_item_apply_po_check(actor, item, action, po, odoo_answer)` as the signed-in
 * caller; only 'correct' is left (its verdicts are proven in 104-purchase-request-correct-po).
 * The item status move refuses a `po_verification` from any signed-in caller, and refuses
 * Purchased by hand.
 *
 * `stageParticipant` is the Buyer (given Purchasing access here); `dealOwner` is on the sales side.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded, castEmail } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const PO = "P01234"

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
        po_number: "P01111",
        po_verification: "VERIFIED",
        requested_by: ids.dealOwner,
        ...fields,
    })

async function item(id) {
    const { data, error } = await svc().from("purchase_request_items").select("*").eq("id", id).single()
    if (error) throw error
    return data
}

/** What the edge function does once it has Odoo's answer. */
const check = (who, itemId, odoo, po = PO, action = "correct") =>
    svc().rpc("purchase_request_item_apply_po_check", {
        p_actor_email: castEmail(who),
        p_item_id: itemId,
        p_action: action,
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

describe("a signed-in caller can't set the Odoo check", () => {
    it.each(["VERIFIED", "NOT_FOUND", "PENDING_VERIFICATION", "UNVERIFIED", "MAYBE"])(
        "refuses po_verification %s sent to the status move",
        async (state) => {
            const id = await seedItem()
            const { error } = await (await clientFor("stageParticipant")).rpc("purchase_request_set_item_status", {
                p_item_id: id,
                p_status: "purchased",
                p_details: { po_number: PO, po_verification: state },
            })
            expect(error?.code).toBe("42501")
            expect(await item(id)).toMatchObject({ status: "purchased", po_number: "P01111" })
        },
    )

    it("refuses it through the old pr_ name too", async () => {
        const id = await seedItem()
        const { error } = await (await clientFor("stageParticipant")).rpc("pr_set_item_status", {
            p_item_id: id,
            p_status: "purchased",
            p_details: { po_number: PO, po_verification: "VERIFIED" },
        })
        expect(error?.code).toBe("42501")
    })

    it("refuses a PO number alone from a signed-in caller, saving nothing", async () => {
        const id = await seedItem()
        const { error } = await (await clientFor("stageParticipant")).rpc("purchase_request_set_item_status", {
            p_item_id: id,
            p_status: "purchased",
            p_details: { po_number: PO },
        })
        expect(error?.code).toBe("42501")
        expect(await item(id)).toMatchObject({ status: "purchased", po_number: "P01111" })
    })

    it("refuses Purchased by hand, with no PO number either", async () => {
        const id = await seedItem({ status: "to_purchase", po_number: null, po_verification: "UNVERIFIED" })
        const { error } = await (await clientFor("stageParticipant")).rpc("purchase_request_set_item_status", {
            p_item_id: id,
            p_status: "purchased",
            p_details: {},
        })
        expect(error?.code).toBe("42501")
        expect(await item(id)).toMatchObject({ status: "to_purchase", po_number: null })
    })

    it("nobody signed in can use the server-only path", async () => {
        const id = await seedItem()
        const args = {
            p_actor_email: castEmail("stageParticipant"),
            p_item_id: id,
            p_action: "correct",
            p_po_number: PO,
            p_odoo: "found",
        }
        expect((await (await clientFor("superAdmin")).rpc("purchase_request_item_apply_po_check", args)).error).not.toBeNull()
        expect((await anonymousClient().rpc("purchase_request_item_apply_po_check", args)).error).not.toBeNull()
        expect(await item(id)).toMatchObject({ status: "purchased", po_number: "P01111" })
    })
})

describe("the removed 'order' action", () => {
    it("is refused as not a PO action, saving nothing", async () => {
        const id = await seedItem({ status: "to_purchase", po_number: null, po_verification: "UNVERIFIED" })
        const { error } = await check("stageParticipant", id, "found", PO, "order")
        expect(error?.code).toBe("22023")
        expect(await item(id)).toMatchObject({ status: "to_purchase", po_number: null })
    })
})

describe("the server path keeps every rule of the status move", () => {
    it("the sales side can't correct a PO either", async () => {
        const id = await seedItem()
        expect((await check("dealOwner", id, "found")).error?.code).toBe("42501")
        expect(await item(id)).toMatchObject({ status: "purchased", po_number: "P01111" })
    })

    it("someone who isn't a member is refused", async () => {
        const id = await seedItem()
        expect((await check("outsider", id, "found")).error?.code).toBe("42501")
    })

    it("an item that isn't Purchased stays put", async () => {
        const id = await seedItem({ status: "received" })
        expect((await check("stageParticipant", id, "found")).error).not.toBeNull()
        expect((await item(id)).status).toBe("received")
    })

    it.each([
        ["a number that isn't an Odoo PO", "PO-12", "found", "correct"],
        ["an Odoo answer that doesn't exist", "P09999", "maybe", "correct"],
        ["an action that doesn't exist", PO, "found", "teleport"],
    ])("refuses %s", async (_, po, odoo, action) => {
        const id = await seedItem()
        expect((await check("stageParticipant", id, odoo, po, action)).error?.code).toBe("22023")
        expect(await item(id)).toMatchObject({ status: "purchased", po_number: "P01111" })
    })
})
