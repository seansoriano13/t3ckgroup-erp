/**
 * Requested Items (#305, part of #209): added from an SOR line or as a new
 * product, by the request's sales side or its Buyer.
 *
 * `dealOwner` is the sales-side member and the SOR's Deal Owner;
 * `stageParticipant` is the Buyer; `outsider` is a purchasing member who isn't
 * the Buyer; `hr` sits on the `other` side; `ordinary` is not a member. Sides
 * are seeded as stored, so a pass is the RPC reading them and nothing else.
 * Items are read back with the service role, so a pass is the RPC's doing and
 * not a read policy's.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const NO_ID = "00000000-0000-0000-0000-000000000000"

const PRODUCT_LIST = [
    { product_name: `${MARKER} Full Body Harness`, unit: "pc", quantity: 10, unit_price: 5998.1, odoo_product_id: 101 },
    { product_name: `${MARKER} Rope, 11mm static`, unit: "roll", quantity: 2, unit_price: 12000 },
]

let sorId, otherSorId, requestId

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

async function lines(sor = sorId) {
    const { data, error } = await svc()
        .from("sales_opportunity_items")
        .select("id, product_name, quantity, unit, odoo_product_id")
        .eq("opportunity_id", sor)
        .order("sort_order")
    if (error) throw error
    return data
}

async function item(id) {
    const { data, error } = await svc().from("purchase_request_items").select("*").eq("id", id).single()
    if (error) throw error
    return data
}

async function addFromLine(who, lineId) {
    return (await clientFor(who)).rpc("purchase_request_add_item_from_line", { p_request_id: requestId, p_line_id: lineId })
}

async function addNew(who, fields = {}) {
    return (await clientFor(who)).rpc("purchase_request_add_new_item", {
        p_request_id: requestId,
        p_name: `${MARKER} Custom mounting bracket`,
        p_quantity: 4,
        ...fields,
    })
}

/** Replaces the SOR's Product List the way updateOpportunity does: as its Deal Owner, through sor_replace_items. */
async function replaceProductList(items) {
    const { error } = await (await clientFor("dealOwner")).rpc("sor_replace_items", {
        p_opportunity_id: sorId,
        p_items: items,
    })
    if (error) throw error
}

beforeAll(async () => {
    await ensureCastLoaded()

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    otherSorId = await makeSor({ registeredBy: ids.support, dealOwnerId: ids.support })
    await replaceProductList(PRODUCT_LIST)
    await insert("sales_opportunity_items", { opportunity_id: otherSorId, product_name: `${MARKER} Other SOR line`, quantity: 1 })

    requestId = await insert("purchase_requests", {
        opportunity_id: sorId,
        created_by: ids.dealOwner,
        buyer_id: ids.stageParticipant,
    })
    for (const [employee, side] of [
        ["dealOwner", "sales"],
        ["stageParticipant", "purchasing"],
        ["outsider", "purchasing"],
        ["hr", "other"],
    ]) {
        await insert("purchase_request_members", { request_id: requestId, employee_id: ids[employee], side })
    }
})

afterAll(async () => {
    await svc().from("purchase_requests").delete().eq("id", requestId)
    await svc().from("sales_opportunity_items").delete().in("opportunity_id", [sorId, otherSorId])
    await svc().from("sales_opportunities").delete().in("id", [sorId, otherSorId].filter(Boolean))
})

describe("adding an item from an SOR line", () => {
    let itemId

    beforeAll(async () => {
        const [harness] = await lines()
        const { data, error } = await addFromLine("dealOwner", harness.id)
        if (error) throw error
        itemId = data
    })

    it("copies the line's Odoo product, name, quantity and unit, and snapshots them", async () => {
        expect(await item(itemId)).toMatchObject({
            request_id: requestId,
            source: "sor_line",
            odoo_product_id: 101,
            name: `${MARKER} Full Body Harness`,
            quantity: 10,
            unit: "pc",
            sor_line_snapshot: { name: `${MARKER} Full Body Harness`, quantity: 10, unit: "pc" },
            status: "not_checked",
            requested_by: ids.dealOwner,
        })
    })

    it("posts the item in the request as an event, authored by whoever added it", async () => {
        const { data } = await svc()
            .from("purchase_request_messages")
            .select("author_id, content, metadata")
            .eq("request_id", requestId)
            .contains("metadata", { item_id: itemId })
        expect(data).toEqual([
            {
                author_id: ids.dealOwner,
                content: `Requested ${MARKER} Full Body Harness × 10 pc, from the SOR's Product List.`,
                metadata: { event: "item_added", item_id: itemId, source: "sor_line" },
            },
        ])
    })

    it("refuses a line on another SOR", async () => {
        const [foreign] = await lines(otherSorId)
        const { error } = await addFromLine("dealOwner", foreign.id)
        expect(error?.code).toBe("P0002")
    })

    it("refuses a line id that no longer exists", async () => {
        const { error } = await addFromLine("dealOwner", NO_ID)
        expect(error?.code).toBe("P0002")
    })
})

describe("after the SOR's Product List is replaced", () => {
    let harnessItem, ropeItem

    const lineNow = async (who = "dealOwner") => {
        const { data, error } = await (await clientFor(who)).rpc("purchase_request_item_lines", { p_request_id: requestId })
        if (error) throw error
        return Object.fromEntries(data.map((r) => [r.item_id, r]))
    }

    beforeAll(async () => {
        const [harness, rope] = await lines()
        harnessItem = (await addFromLine("dealOwner", harness.id)).data
        ropeItem = (await addFromLine("dealOwner", rope.id)).data

        await replaceProductList([{ ...PRODUCT_LIST[0], quantity: 12 }])
    })

    afterAll(() => replaceProductList(PRODUCT_LIST))

    it("keeps the item as it was picked", async () => {
        expect(await item(harnessItem)).toMatchObject({
            quantity: 10,
            sor_line_snapshot: { name: `${MARKER} Full Body Harness`, quantity: 10, unit: "pc" },
        })
        expect(await item(ropeItem)).toMatchObject({ quantity: 2, unit: "roll" })
    })

    it("reports the line's new quantity, found by its fixed line id", async () => {
        expect((await lineNow())[harnessItem]).toEqual({
            item_id: harnessItem,
            line_found: true,
            line_quantity: 12,
            line_unit: "pc",
        })
    })

    it("reports a hand-typed line the SOR dropped as gone", async () => {
        expect((await lineNow())[ropeItem]).toMatchObject({ line_found: false, line_quantity: null })
    })

    it("answers any reader of the request, who may hold no access to the SOR", async () => {
        expect((await lineNow("hr"))[harnessItem]).toMatchObject({ line_quantity: 12 })
    })

    it("answers nothing to someone who can't read the request", async () => {
        expect(await lineNow("ordinary")).toEqual({})
    })
})

describe("adding a new product", () => {
    const images = [{ url: "https://res.cloudinary.com/demo/bracket.jpg", name: "bracket.jpg", type: "image/jpeg", bytes: 2048 }]

    it("keeps its name, quantity, unit, description and images, at Requested, and posts it", async () => {
        const { data: id, error } = await addNew("dealOwner", {
            p_unit: "pc",
            p_description: "Stainless, per the client's drawing",
            p_images: images,
        })
        expect(error).toBeNull()
        expect(await item(id)).toMatchObject({
            source: "new",
            odoo_product_id: null,
            name: `${MARKER} Custom mounting bracket`,
            quantity: 4,
            unit: "pc",
            description: "Stainless, per the client's drawing",
            images,
            sor_line_snapshot: null,
            status: "not_checked",
        })

        const { data: posts } = await svc()
            .from("purchase_request_messages")
            .select("metadata")
            .eq("request_id", requestId)
            .contains("metadata", { item_id: id })
        expect(posts).toEqual([{ metadata: { event: "item_added", item_id: id, source: "new" } }])
    })

    it.each([
        ["a blank name", { p_name: "   " }],
        ["a quantity of zero", { p_quantity: 0 }],
        ["images that aren't uploaded files", { p_images: ["https://example.test/x.jpg"] }],
        ["more than five images", { p_images: Array.from({ length: 6 }, () => images[0]) }],
    ])("refuses %s", async (_, fields) => {
        const { error } = await addNew("dealOwner", fields)
        expect(error?.code).toBe("22023")
    })
})

describe("who may add items", () => {
    it.each([
        ["the sales side", "dealOwner", true],
        ["the Buyer", "stageParticipant", true],
        ["a purchasing member who isn't the Buyer", "outsider", false],
        ["a member on the other side", "hr", false],
        ["a non-member", "ordinary", false],
    ])("%s: %s", async (_, who, allowed) => {
        const client = await clientFor(who)
        const [line] = await lines()

        const can = await client.rpc("purchase_request_can_add_items", { p_request_id: requestId })
        expect(can.data).toBe(allowed)

        const fromLine = await addFromLine(who, line.id)
        const fresh = await addNew(who)
        const picker = await client.rpc("purchase_request_pickable_lines", { p_request_id: requestId })
        if (allowed) {
            expect([fromLine.error, fresh.error, picker.error]).toEqual([null, null, null])
            expect(picker.data.map((l) => l.product_name)).toEqual(PRODUCT_LIST.map((l) => l.product_name))
            expect(picker.data[0]).not.toHaveProperty("unit_price")
        } else {
            expect([fromLine.error?.code, fresh.error?.code, picker.error?.code]).toEqual(["42501", "42501", "42501"])
        }
    })

    it("a direct insert into the items is refused", async () => {
        const { error } = await (await clientFor("dealOwner")).from("purchase_request_items").insert({
            request_id: requestId,
            source: "new",
            name: `${MARKER} Direct`,
            quantity: 1,
            requested_by: ids.dealOwner,
        })
        expect(error?.code).toBe("42501")
    })
})

describe("someone not signed in", () => {
    it.each([
        ["purchase_request_can_add_items", { p_request_id: NO_ID }],
        ["purchase_request_add_item_from_line", { p_request_id: NO_ID, p_line_id: NO_ID }],
        ["purchase_request_add_new_item", { p_request_id: NO_ID, p_name: "x", p_quantity: 1 }],
        ["purchase_request_pickable_lines", { p_request_id: NO_ID }],
        ["purchase_request_item_lines", { p_request_id: NO_ID }],
    ])("cannot call %s at all", async (fn, args) => {
        const { error } = await anonymousClient().rpc(fn, args)
        expect(error?.message).toMatch(/permission denied/i)
    })

    it.each(["_purchase_request_for_adding", "_purchase_request_item_added"])("nobody calls %s directly", async (fn) => {
        const args = fn === "_purchase_request_for_adding" ? { p_request_id: NO_ID, p_fn: "x" } : { p_item: {} }
        const { error } = await (await clientFor("superAdmin")).rpc(fn, args)
        expect(error).not.toBeNull()
    })
})
