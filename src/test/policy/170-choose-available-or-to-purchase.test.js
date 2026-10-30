/**
 * Mark a product Available or To purchase from the stock check (#681, spec #675,
 * 20261104170000_choose_available_or_to_purchase.sql).
 *
 * `dealOwner` is the sales side, `hr` a deal member on the other side, `stageParticipant`
 * Purchasing, `ordinary` is no member. A fresh stock check (a write to the SOR's stock
 * snapshot) flags an Available line "Now x free of y"; any status choice clears it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
let sorId, requestId

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

const seedItem = (status = "not_checked", extra = {}) =>
    insert("purchase_request_items", {
        request_id: requestId,
        source: "new",
        name: `${MARKER} Harness`,
        quantity: 4,
        status,
        requested_by: ids.dealOwner,
        ...extra,
    })

const row = async (id) => (await svc().from("purchase_request_items").select("*").eq("id", id).single()).data
const choose = async (who, id, status, details = {}) =>
    (await clientFor(who)).rpc("purchase_request_set_item_status", { p_item_id: id, p_status: status, p_details: details })
const stockCheck = (free) =>
    svc().from("sor_stock_snapshots").upsert({ opportunity_id: sorId, data: { products: { 901: { type: "product", free } } } })

beforeAll(async () => {
    await ensureCastLoaded()
    await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.stageParticipant)
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    requestId = await insert("purchase_requests", { opportunity_id: sorId, created_by: ids.dealOwner, buyer_id: ids.stageParticipant })
    for (const [employee, side] of [["dealOwner", "sales"], ["stageParticipant", "purchasing"], ["hr", "other"]]) {
        await insert("purchase_request_members", { request_id: requestId, employee_id: ids[employee], side })
    }
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.stageParticipant)
    if (requestId) await svc().from("purchase_requests").delete().eq("id", requestId)
    if (sorId) await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("who chooses by hand", () => {
    it.each(["dealOwner", "stageParticipant", "hr"])("%s can choose Available and To purchase", async (who) => {
        for (const status of ["available", "to_purchase"]) {
            const id = await seedItem()
            const { error } = await choose(who, id, status)
            expect(error).toBeNull()
            expect((await row(id)).status).toBe(status)
        }
    })

    it("only Purchasing can choose Cannot source", async () => {
        for (const who of ["dealOwner", "hr"]) {
            const id = await seedItem()
            expect((await choose(who, id, "cannot_source")).error?.code).toBe("42501")
        }
        const id = await seedItem()
        expect((await choose("stageParticipant", id, "cannot_source")).error).toBeNull()
    })

    it.each(["still_canvassing", "purchased", "received"])("a deal member cannot choose %s", async (status) => {
        for (const who of ["dealOwner", "hr"]) {
            const id = await seedItem("to_purchase")
            expect((await choose(who, id, status)).error?.code).toBe("42501")
        }
    })

    it("a non-member is refused", async () => {
        const id = await seedItem()
        expect((await choose("ordinary", id, "available")).error).not.toBeNull()
    })

    it("an item already on a P0 cannot be set back to Available", async () => {
        const id = await seedItem("purchased")
        expect((await choose("dealOwner", id, "available")).error?.code).toBe("42501")
    })
})

describe("Now x free of y", () => {
    it("a fresh stock check flags an Available line that is short, and leaves covered ones alone", async () => {
        const short = await seedItem("available", { odoo_product_id: 901 })
        const planned = await seedItem("to_purchase", { odoo_product_id: 901 })
        expect((await stockCheck(1)).error).toBeNull()
        expect(await row(short)).toMatchObject({ stock_short_free: 1, stock_short_needed: 4 })
        expect(await row(planned)).toMatchObject({ stock_short_free: null })

        const covered = await seedItem("available", { odoo_product_id: 901 })
        expect((await stockCheck(9)).error).toBeNull()
        expect((await row(covered)).stock_short_free).toBeNull()
    })

    it("choosing a status again clears it; choosing Available again sets it again, with a reason (#803)", async () => {
        const id = await seedItem("available", { odoo_product_id: 901 })
        await stockCheck(0)
        expect((await row(id)).stock_short_free).toBe(0)
        expect((await choose("dealOwner", id, "available")).error?.code).toBe("22023")
        expect((await choose("dealOwner", id, "available", { reason: "Transfer due Friday" })).error).toBeNull()
        expect(await row(id)).toMatchObject({ status: "available", stock_short_free: 0, stock_short_needed: 4 })

        expect((await choose("dealOwner", id, "to_purchase")).error).toBeNull()
        expect((await row(id)).stock_short_free).toBeNull()
    })

    it("choosing Available again with no warning is still refused as already so", async () => {
        const id = await seedItem("available")
        expect((await choose("dealOwner", id, "available")).error).not.toBeNull()
    })
})

describe("Available on short stock needs a reason (#803)", () => {
    it("is refused without a reason, and the line stays where it was", async () => {
        const id = await seedItem("to_purchase", { odoo_product_id: 901 })
        expect((await stockCheck(1)).error).toBeNull()
        const { error } = await choose("dealOwner", id, "available")
        expect(error?.code).toBe("22023")
        expect(error?.message).toMatch(/Now 1 free of 4/)
        expect(await row(id)).toMatchObject({ status: "to_purchase", stock_short_free: null })
    })

    it("with a reason it is accepted, flagged, and the reason is in the request history", async () => {
        const id = await seedItem("to_purchase", { odoo_product_id: 901 })
        expect((await stockCheck(1)).error).toBeNull()
        const { error } = await choose("dealOwner", id, "available", { reason: "  Transfer due Friday  " })
        expect(error).toBeNull()
        expect(await row(id)).toMatchObject({ status: "available", stock_short_free: 1, stock_short_needed: 4 })

        const { data: events } = await svc().from("purchase_request_messages").select("author_id, metadata").eq("request_id", requestId)
        const reasons = events.filter((e) => e.metadata?.event === "item_short_stock_reason" && e.metadata.item_id === id)
        expect(reasons).toEqual([
            expect.objectContaining({
                author_id: ids.dealOwner,
                metadata: expect.objectContaining({ item_id: id, reason: "Transfer due Friday", free: 1, needed: 4 }),
            }),
        ])
    })

    it("needs no reason when there is no stock check for the line, or stock covers it", async () => {
        const plain = await seedItem("to_purchase")
        expect((await choose("dealOwner", plain, "available")).error).toBeNull()

        const covered = await seedItem("to_purchase", { odoo_product_id: 901 })
        expect((await stockCheck(9)).error).toBeNull()
        expect((await choose("dealOwner", covered, "available")).error).toBeNull()
        expect((await row(covered)).stock_short_free).toBeNull()
    })

    it("a Direct request, which has no SOR and so no stock check, needs no reason", async () => {
        const directId = await insert("purchase_requests", {
            title: `${MARKER} Direct request`,
            created_by: ids.dealOwner,
            buyer_id: ids.stageParticipant,
        })
        try {
            await insert("purchase_request_members", { request_id: directId, employee_id: ids.dealOwner, side: "sales" })
            const id = await insert("purchase_request_items", {
                request_id: directId,
                source: "new",
                name: `${MARKER} Direct`,
                quantity: 4,
                status: "to_purchase",
                requested_by: ids.dealOwner,
                odoo_product_id: 901,
            })
            expect((await choose("dealOwner", id, "available")).error).toBeNull()
            expect(await row(id)).toMatchObject({ status: "available", stock_short_free: null })
        } finally {
            await svc().from("purchase_requests").delete().eq("id", directId)
        }
    })

    it("a reason is for Available only, and is the only detail it takes", async () => {
        const id = await seedItem("not_checked")
        expect((await choose("dealOwner", id, "to_purchase", { reason: "Nope" })).error?.code).toBe("22023")
        expect((await choose("dealOwner", id, "available", { po_number: "P01234" })).error?.code).toBe("22023")
        expect((await row(id)).status).toBe("not_checked")
    })
})
