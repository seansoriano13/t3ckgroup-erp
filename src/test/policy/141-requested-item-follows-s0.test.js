/**
 * Every S0 line has exactly one Requested Item on the SOR's Purchase Request (#678, spec #675;
 * 20261104130000_requested_item_follows_s0.sql).
 *
 * The item is made when the request opens (every line already on the SOR) and when a line is
 * added, and is kept in step with the line (name, quantity, unit, Odoo product) whenever the S0
 * is read. It starts at Not checked. The database refuses a second item for a line. A line Odoo
 * drops keeps its item, marked removed. An item with no SOR line is an Other request. The old
 * flows (pick a line, update to the SOR, keep as asked) are gone.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const NO_ID = "00000000-0000-0000-0000-000000000000"

const row = (name, odooLineId, quantity, odooProductId = null) => ({
    product_name: `${MARKER} ${name}`,
    unit: "pc",
    quantity,
    unit_price: 100,
    odoo_product_id: odooProductId,
    odoo_line_id: odooLineId,
})

const S0 = [row("Harness", 701, 10, 61), row("Rope", 702, 4, 62), row("Carabiner", 703, 20, 63)]

let sorId, requestId, directId

async function readS0(items) {
    const { error } = await (await clientFor("dealOwner")).rpc("sor_replace_items", { p_opportunity_id: sorId, p_items: items })
    if (error) throw error
}

async function items(request = requestId) {
    const { data, error } = await svc().from("purchase_request_items").select("*").eq("request_id", request).order("created_at").order("id")
    if (error) throw error
    return data
}

const byName = (list, name) => list.find((i) => i.name === `${MARKER} ${name}`)

beforeAll(async () => {
    await ensureCastLoaded()
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    await readS0(S0)

    const { data, error } = await svc()
        .from("purchase_requests")
        .insert({ opportunity_id: sorId, created_by: ids.dealOwner, buyer_id: ids.stageParticipant })
        .select("id")
        .single()
    if (error) throw error
    requestId = data.id

    const direct = await svc().from("purchase_requests").insert({ title: `${MARKER} Direct`, created_by: ids.dealOwner }).select("id").single()
    if (direct.error) throw direct.error
    directId = direct.data.id
})

afterAll(async () => {
    await svc().from("purchase_requests").delete().in("id", [requestId, directId].filter(Boolean))
    await svc().from("sales_opportunity_items").delete().eq("opportunity_id", sorId)
    await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("opening the request", () => {
    it("makes one Not checked item for every S0 line, copied from the line", async () => {
        const list = await items()
        expect(list).toHaveLength(3)
        expect(byName(list, "Harness")).toMatchObject({
            source: "sor_line",
            status: "not_checked",
            odoo_product_id: 61,
            quantity: 10,
            unit: "pc",
            removed_from_s0: false,
            requested_by: ids.dealOwner,
        })
        const { data: lines } = await svc().from("sales_opportunity_items").select("id, odoo_line_id").eq("opportunity_id", sorId)
        const lineOf = Object.fromEntries(lines.map((l) => [l.odoo_line_id, l.id]))
        expect(byName(list, "Rope").sor_item_id).toBe(lineOf[702])
    })

    it("gives a Direct request (no SOR) nothing", async () => {
        expect(await items(directId)).toEqual([])
    })
})

describe("reading the S0 again", () => {
    it("adds no duplicate item and leaves every item as it was", async () => {
        const before = await items()
        await readS0(S0)
        await readS0(S0)
        expect(await items()).toEqual(before)
    })

    it("shows a quantity changed in Odoo on the item, keeping its status", async () => {
        await svc().from("purchase_request_items").update({ status: "to_purchase" }).eq("id", byName(await items(), "Harness").id)

        await readS0([row("Harness", 701, 12, 61), S0[1], S0[2]])

        const harness = byName(await items(), "Harness")
        expect(harness).toMatchObject({ quantity: 12, status: "to_purchase", sor_line_snapshot: { quantity: 12 } })
    })

    it("follows a product renamed in Odoo", async () => {
        await readS0([row("Harness", 701, 12, 61), row("Rope 11mm", 702, 4, 62), S0[2]])

        const list = await items()
        expect(list).toHaveLength(3)
        expect(byName(list, "Rope 11mm")).toMatchObject({ quantity: 4 })
    })

    it("adds an item for a line Odoo adds later", async () => {
        await readS0([row("Harness", 701, 12, 61), row("Rope 11mm", 702, 4, 62), S0[2], row("Helmet", 704, 5, 64)])

        const helmet = byName(await items(), "Helmet")
        expect(helmet).toMatchObject({ status: "not_checked", quantity: 5, removed_from_s0: false })
    })
})

describe("a line Odoo drops", () => {
    it("keeps its item, marked removed from the S0, with its status", async () => {
        await readS0([row("Harness", 701, 12, 61), row("Rope 11mm", 702, 4, 62), row("Helmet", 704, 5, 64)])

        const list = await items()
        expect(list).toHaveLength(4)
        const carabiner = byName(list, "Carabiner")
        expect(carabiner).toMatchObject({ removed_from_s0: true, status: "not_checked", quantity: 20 })
        expect(carabiner.sor_item_id).not.toBeNull()
        expect(byName(list, "Harness").removed_from_s0).toBe(false)
    })

    it("brings it back when Odoo has the line again", async () => {
        await readS0([row("Harness", 701, 12, 61), row("Rope 11mm", 702, 4, 62), row("Carabiner", 703, 20, 63), row("Helmet", 704, 5, 64)])

        expect(byName(await items(), "Carabiner").removed_from_s0).toBe(false)
    })
})

describe("one item per SOR line", () => {
    it("refuses a second item for a line that has one", async () => {
        const harness = byName(await items(), "Harness")
        const { error } = await svc()
            .from("purchase_request_items")
            .insert({ request_id: requestId, source: "sor_line", sor_item_id: harness.sor_item_id, name: `${MARKER} Harness again`, quantity: 1, requested_by: ids.dealOwner })
        expect(error?.code).toBe("23505")
    })

    it("lets any number of Other requests (no SOR line) stand beside them", async () => {
        const { data, error } = await (await clientFor("dealOwner")).rpc("purchase_request_add_new_item", {
            p_request_id: requestId,
            p_name: `${MARKER} Custom bracket`,
            p_quantity: 4,
        })
        expect(error).toBeNull()
        const other = (await items()).find((i) => i.id === data)
        expect(other).toMatchObject({ source: "new", sor_item_id: null, status: "not_checked" })
    })
})

describe("the old flows are gone", () => {
    it.each([
        ["purchase_request_add_item_from_line", { p_request_id: NO_ID, p_line_id: NO_ID }],
        ["purchase_request_pickable_lines", { p_request_id: NO_ID }],
        ["purchase_request_update_item_from_sor", { p_item_id: NO_ID }],
        ["purchase_request_keep_item_as_asked", { p_item_id: NO_ID }],
    ])("%s no longer exists", async (fn, args) => {
        const { error } = await (await clientFor("dealOwner")).rpc(fn, args)
        expect(error?.code).toBe("PGRST202")
    })

    it.each(["_purchase_request_sync_sor_line", "_purchase_request_sync_sor_items"])("nobody calls %s directly", async (fn) => {
        const { error } = await (await clientFor("superAdmin")).rpc(fn, { p_request_id: requestId })
        expect(error).not.toBeNull()
    })
})
