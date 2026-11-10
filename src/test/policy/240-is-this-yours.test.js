/**
 * "Is this from your purchase request?" (#688, spec #675;
 * 20261105000000_is_this_yours_on_s0.sql).
 *
 * A new S0 line whose Odoo product is the one on an Other request's attached P0 asks the question.
 * Yes moves the P0, status and history onto the S0 line and closes the Other request as
 * Cancelled, in one call, deleting nothing. No clears the question and changes nothing else.
 * Nothing is asked when the products differ or the Other request has no P0.
 *
 * `stageParticipant` is the Buyer (given Purchasing access here); `dealOwner` is on the sales side.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
let sorId, requestId
let lineSeq = 880000

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

const itemOf = async (id) => (await svc().from("purchase_request_items").select("*").eq("id", id).single()).data

/** An Other request already bought: its P0 is on Odoo product `productId`. */
const seedOther = (productId = 61, patch = {}) =>
    insert("purchase_request_items", {
        request_id: requestId,
        source: "new",
        name: `${MARKER} Harness ask`,
        unit: "pc",
        quantity: 4,
        status: "purchased",
        purpose: "client",
        po_number: "P01234",
        po_verification: "VERIFIED",
        po_state: "confirmed",
        po_ordered: 4,
        po_received: 1,
        bought_as: "Harness XL",
        bought_product_id: productId,
        requested_by: ids.dealOwner,
        ...patch,
    })

/** Sales adds a line to the S0; the database makes its item. Returns that item. */
async function addS0Line(productId, name = "Harness") {
    const odooLineId = lineSeq++
    const productName = `${MARKER} ${name} ${odooLineId}`
    await insert("sales_opportunity_items", {
        opportunity_id: sorId,
        product_name: productName,
        unit: "pc",
        quantity: 4,
        unit_price: 100,
        odoo_product_id: productId,
        odoo_line_id: odooLineId,
    })
    const { data } = await svc().from("purchase_request_items").select("*").eq("request_id", requestId).eq("name", productName).single()
    return data
}

const answer = async (who, itemId, same) => (await clientFor(who)).rpc("purchase_request_answer_yours", { p_item_id: itemId, p_same: same })

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
    if (sorId) {
        await svc().from("sales_opportunity_items").delete().eq("opportunity_id", sorId)
        await svc().from("sales_opportunities").delete().eq("id", sorId)
    }
})

describe("when the question is asked", () => {
    it("asks when the S0 line has the same Odoo product as an Other request's P0", async () => {
        const otherId = await seedOther(71)
        const line = await addS0Line(71)
        expect(line).toMatchObject({ new_on_s0: true, yours_item_id: otherId })
    })

    it("asks nothing when the products differ", async () => {
        await seedOther(72)
        const line = await addS0Line(73)
        expect(line).toMatchObject({ new_on_s0: false, yours_item_id: null })
    })

    it("asks nothing when the Other request has no P0", async () => {
        await seedOther(74, { status: "to_purchase", po_number: null, po_state: null, bought_product_id: null })
        const line = await addS0Line(74)
        expect(line.new_on_s0).toBe(false)
    })

    it("asks nothing for a Cancelled request or a material for the job", async () => {
        await seedOther(75, { status: "cancelled" })
        await seedOther(76, { purpose: "job" })
        expect((await addS0Line(75)).new_on_s0).toBe(false)
        expect((await addS0Line(76)).new_on_s0).toBe(false)
    })
})

describe("when the P0 is attached after the S0 line exists", () => {
    const bought = { po_number: "P01299", po_verification: "VERIFIED", po_state: "confirmed", status: "purchased" }

    it("asks when a P0 for the same Odoo product lands on the Other request", async () => {
        const otherId = await seedOther(77, { status: "to_purchase", po_number: null, po_state: null, bought_product_id: null })
        const line = await addS0Line(77)
        expect(line.new_on_s0).toBe(false)
        const { error } = await svc().from("purchase_request_items").update({ ...bought, bought_product_id: 77 }).eq("id", otherId)
        expect(error).toBeNull()
        expect(await itemOf(line.id)).toMatchObject({ new_on_s0: true, yours_item_id: otherId })
    })

    it("asks nothing when the attached P0 is a different product", async () => {
        const otherId = await seedOther(78, { status: "to_purchase", po_number: null, po_state: null, bought_product_id: null })
        const line = await addS0Line(78)
        await svc().from("purchase_request_items").update({ ...bought, bought_product_id: 79 }).eq("id", otherId)
        expect((await itemOf(line.id)).new_on_s0).toBe(false)
    })
})

describe("answering Yes", () => {
    it("moves the P0, status and history onto the S0 line and closes the Other request, deleting nothing", async () => {
        const otherId = await seedOther(81)
        await insert("purchase_request_messages", {
            request_id: requestId,
            author_id: ids.dealOwner,
            content: `${MARKER} history`,
            metadata: { event: "item_note", item_id: otherId },
        })
        const line = await addS0Line(81)
        const count = async () =>
            (await svc().from("purchase_request_items").select("id", { count: "exact", head: true }).eq("request_id", requestId)).count
        const before = await count()

        const { data, error } = await answer("stageParticipant", line.id, true)
        expect(error).toBeNull()
        expect(data).toMatchObject({
            id: line.id,
            status: "purchased",
            po_number: "P01234",
            po_state: "confirmed",
            po_ordered: 4,
            po_received: 1,
            bought_as: "Harness XL",
            new_on_s0: false,
            yours_item_id: null,
        })

        const closed = await itemOf(otherId)
        expect(closed).toMatchObject({ status: "cancelled", po_number: null })
        expect(closed.closed_note).toBe(`Closed · P01234 and its delivery moved onto ${line.name}`)

        const history = await svc().from("purchase_request_messages").select("metadata").eq("content", `${MARKER} history`).single()
        expect(history.data.metadata.item_id).toBe(line.id)

        expect(await count()).toBe(before)
    })

    it("lets the sales side answer, but not an outsider", async () => {
        await seedOther(83)
        const line = await addS0Line(83)
        const denied = await answer("outsider", line.id, true)
        expect(denied.error?.code).toBe("42501")
        const { error } = await answer("dealOwner", line.id, true)
        expect(error).toBeNull()
    })

    it("refuses when there is no open question", async () => {
        const line = await addS0Line(84)
        const { error } = await answer("stageParticipant", line.id, true)
        expect(error?.code).toBe("22023")
    })
})

describe("answering No", () => {
    it("clears the question and changes nothing else", async () => {
        const otherId = await seedOther(91)
        const line = await addS0Line(91)
        const { data, error } = await answer("stageParticipant", line.id, false)
        expect(error).toBeNull()
        expect(data).toMatchObject({ new_on_s0: false, yours_item_id: null, status: "not_checked", po_number: null })
        expect(await itemOf(otherId)).toMatchObject({ status: "purchased", po_number: "P01234", closed_note: null })
    })
})
