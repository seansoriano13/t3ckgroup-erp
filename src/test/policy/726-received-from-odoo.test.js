/**
 * #726 (spec #718): a Purchased ("Ordered") item becomes Received from the IPAS Odoo refresh.
 * Odoo is faked by passing the copy it "said" (lines carry `received`). Covered:
 *   - the picked line(s) fully received: Received, a system line in the request's history
 *   - part received: stays Purchased and keeps the count ("n of m")
 *   - several picked lines add up; a line that is not picked does not count
 *   - an item with no picked line, or a copy with no received figure, does not move
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, ensureCastLoaded } from "./support/cast.js"
import { closeSql, serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeFixtureIpas, raiseAsPurchaser, recordOdooCopyAs } from "./support/ipas.js"

const svc = () => serviceClient()
let sorId, requestId

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

const lineOf = (line_id, quantity, received) => ({
    line_id, product_id: 7700 + line_id, name: `Line ${line_id}`, quantity, unit: "Unit",
    price_unit: 100, price_subtotal: 100 * quantity, taxes: [], analytic: [], brand: null,
    ...(received === undefined ? {} : { received }),
})

const copy = (po, lines) => ({
    po: { id: 871000, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_720_000, name: "Receipt Supplier", contact: null },
    lines,
    receipts: { status: "partial", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const seedItem = (po, lineIds, quantity = 10) =>
    insert("purchase_request_items", {
        request_id: requestId, source: "new", name: `${MARKER} Boots ${po}`, unit: "pc", quantity,
        status: "purchased", po_number: po, po_verification: "VERIFIED", odoo_po_line_ids: lineIds,
        requested_by: ids.dealOwner,
    })

async function item(id) {
    const { data, error } = await svc().from("purchase_request_items").select("*").eq("id", id).single()
    if (error) throw error
    return data
}

/** Raises the IPAS on `lines`, then refreshes it with `later`. */
async function raiseAndRefresh(po, first, later) {
    const { data: ipas, error } = await raiseAsPurchaser({
        p_po_number: po, p_priority: "high", p_source: "local", p_purpose: "inventory", p_sor_ids: [], p_remarks: null,
        p_odoo_copy: copy(po, first),
    })
    expect(error).toBeNull()
    const refreshed = await recordOdooCopyAs("outsider", { p_ipas_id: ipas.id, p_odoo_copy: copy(po, later) })
    expect(refreshed.error).toBeNull()
    return ipas
}

beforeAll(async () => {
    await ensureCastLoaded()
    await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    requestId = await insert("purchase_requests", { opportunity_id: sorId, created_by: ids.dealOwner, buyer_id: ids.outsider })
    await insert("purchase_request_members", { request_id: requestId, employee_id: ids.dealOwner, side: "sales" })
    await insert("purchase_request_members", { request_id: requestId, employee_id: ids.outsider, side: "purchasing" })
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    if (requestId) await svc().from("purchase_requests").delete().eq("id", requestId)
    if (sorId) await svc().from("sales_opportunities").delete().eq("id", sorId)
    await closeSql()
})

describe("Received from the Odoo receipt (#726)", () => {
    it("full receipt: Received, by the system, written to history", async () => {
        const po = "P9871001"
        const id = await seedItem(po, [881001])
        await raiseAndRefresh(po, [lineOf(881001, 10, 0)], [lineOf(881001, 10, 10)])

        expect(await item(id)).toMatchObject({ status: "received", status_changed_by: null, odoo_received_qty: 10 })
        const { data: posts } = await svc().from("purchase_request_messages").select("*")
            .eq("request_id", requestId).eq("metadata->>item_id", id)
        expect(posts).toHaveLength(1)
        expect(posts[0]).toMatchObject({ author_id: null })
        expect(posts[0].metadata).toMatchObject({ event: "item_status_changed", from: "purchased", to: "received", system: true })
        expect(posts[0].content).toMatch(/Purchased → Received/)
    })

    it("more than the quantity still covers it", async () => {
        const po = "P9871002"
        const id = await seedItem(po, [881002])
        await raiseAndRefresh(po, [lineOf(881002, 10, 0)], [lineOf(881002, 10, 12)])
        expect((await item(id)).status).toBe("received")
    })

    it("partial receipt: stays Purchased and keeps the count; the rest later moves it", async () => {
        const po = "P9871003"
        const id = await seedItem(po, [881003])
        const ipas = await raiseAndRefresh(po, [lineOf(881003, 10, 0)], [lineOf(881003, 10, 4)])
        expect(await item(id)).toMatchObject({ status: "purchased", odoo_received_qty: 4 })
        const { data: posts } = await svc().from("purchase_request_messages").select("id")
            .eq("request_id", requestId).eq("metadata->>item_id", id)
        expect(posts).toHaveLength(0)

        const again = await recordOdooCopyAs("outsider", { p_ipas_id: ipas.id, p_odoo_copy: copy(po, [lineOf(881003, 10, 10)]) })
        expect(again.error).toBeNull()
        expect((await item(id)).status).toBe("received")
    })

    it("several picked lines add up; a line not picked does not count", async () => {
        const po = "P9871004"
        const id = await seedItem(po, [881004, 881005])
        await raiseAndRefresh(po, [lineOf(881004, 6, 0), lineOf(881005, 4, 0), lineOf(881006, 50, 0)],
            [lineOf(881004, 6, 6), lineOf(881005, 4, 1), lineOf(881006, 50, 50)])
        expect(await item(id)).toMatchObject({ status: "purchased", odoo_received_qty: 7 })
    })

    it("no picked line, or a copy with no received figure: nothing moves", async () => {
        const po = "P9871005"
        const none = await seedItem(po, [])
        const old = await seedItem(po, [881007])
        await raiseAndRefresh(po, [lineOf(881007, 10)], [lineOf(881007, 10)])
        expect(await item(none)).toMatchObject({ status: "purchased", odoo_received_qty: null })
        expect(await item(old)).toMatchObject({ status: "purchased", odoo_received_qty: null })
    })
})
