/**
 * The PO number and Odoo PO line on Ordered (#312, part of #209).
 *
 * `purchase_request_set_item_status(item, 'purchased', { po_number })` takes
 * an optional PO number and its Odoo check; `purchase_request_pick_po_lines` records the PO
 * line(s) the item is bought on, refusing any line not on the PO's IPAS
 * stored Odoo copy. The seam `_ipas_po_line_ids` answers from the live IPAS's
 * copy (#242; proven against real IPAS in 56-ipas-raise.test.js). Nothing here
 * raises an IPAS, so it answers '{}' for every PO; the "an IPAS exists" tests
 * swap its body for one that knows a single PO, and put the shipped body back
 * afterwards.
 *
 * `stageParticipant` is the Buyer (given Purchasing access here); `dealOwner`
 * is on the sales side; `ordinary` isn't a member.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded, castEmail } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const NO_ID = "00000000-0000-0000-0000-000000000000"
const IPAS_PO = "P0777"
const IPAS_LINES = [501, 502, 503]

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
        name: `${MARKER} Full Body Harness`,
        unit: "pc",
        quantity: 10,
        status: "to_purchase",
        requested_by: ids.dealOwner,
        ...fields,
    })

async function item(id) {
    const { data, error } = await svc().from("purchase_request_items").select("*").eq("id", id).single()
    if (error) throw error
    return data
}

async function eventsFor(itemId, event) {
    const { data, error } = await svc()
        .from("purchase_request_messages")
        .select("author_id, content, metadata")
        .eq("request_id", requestId)
        .contains("metadata", { event, item_id: itemId })
        .order("created_at")
    if (error) throw error
    return data
}

const order = async (who, itemId, details) =>
    (await clientFor(who)).rpc("purchase_request_set_item_status", { p_item_id: itemId, p_status: "purchased", p_details: details })

/** Ordered with Odoo faked as having the PO, through the server-only path (#548; proven in 103). */
const orderVerified = (who, itemId, po) =>
    svc().rpc("purchase_request_item_apply_po_check", {
        p_actor_email: castEmail(who),
        p_item_id: itemId,
        p_action: "order",
        p_po_number: po,
        p_odoo: "found",
    })

const pick = async (who, itemId, lineIds) =>
    (await clientFor(who)).rpc("purchase_request_pick_po_lines", { p_item_id: itemId, p_line_ids: lineIds })

const poLines = async (who, itemId) => (await clientFor(who)).rpc("purchase_request_item_po_lines", { p_item_id: itemId })

/** Runs `fn` with an IPAS that holds PO P0777's lines 501–503; restores the shipped seam after. */
async function withIpas(fn) {
    const { rows } = await sql().query(
        `select pg_get_functiondef('public._ipas_po_line_ids(text)'::regprocedure) as def`,
    )
    const shipped = rows[0].def
    await sql().query(`
        create or replace function public._ipas_po_line_ids(p_po_number text)
        returns int[] language sql stable set search_path = public as $$
          select case when p_po_number = '${IPAS_PO}' then array[${IPAS_LINES.join(",")}]::int[] else '{}'::int[] end;
        $$`)
    try {
        await fn()
    } finally {
        await sql().query(shipped)
    }
}

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

describe("Ordered takes an optional PO number", () => {
    it("with no PO number: Ordered, no PO, no lines", async () => {
        const id = await seedItem()
        const { data, error } = await order("stageParticipant", id, {})
        expect(error).toBeNull()
        expect(data).toMatchObject({ status: "purchased", po_number: null, po_verification: "UNVERIFIED", odoo_po_line_ids: [] })
    })

    it("stores the PO number, normalised, and what Odoo said about it; the post carries both", async () => {
        const id = await seedItem()
        const { data, error } = await orderVerified("stageParticipant", id, " p01234 ")
        expect(error).toBeNull()
        expect(data).toMatchObject({ status: "purchased", po_number: "P01234", po_verification: "VERIFIED" })
        expect(await item(id)).toMatchObject({ po_number: "P01234", po_verification: "VERIFIED", odoo_po_line_ids: [] })

        const [post] = await eventsFor(id, "item_status_changed")
        expect(post.metadata).toMatchObject({
            to: "purchased",
            details: { po_number: "P01234", po_verification: "VERIFIED" },
        })
    })

    it("refuses a PO number sent straight to the status move; only the server path saves one", async () => {
        const id = await seedItem()
        expect((await order("stageParticipant", id, { po_number: "P01236" })).error?.code).toBe("42501")
        expect(await item(id)).toMatchObject({ status: "to_purchase", po_number: null })
    })

    it.each([
        ["a number that isn't an Odoo PO", { po_number: "PO-1234" }],
        ["a key Ordered doesn't take", { po_number: "P01234", vendor: "Acme" }],
        ["the lines, which are picked, not set", { odoo_po_line_ids: [501] }],
        ["a number that isn't text", { po_number: 1234 }],
    ])("refuses %s, leaving the item where it was", async (_, details) => {
        const id = await seedItem()
        expect((await order("stageParticipant", id, details)).error?.code).toBe("22023")
        expect(await item(id)).toMatchObject({ status: "to_purchase", po_number: null })
    })

    it("the sales side still can't set Ordered, PO number or not", async () => {
        const id = await seedItem()
        expect((await order("dealOwner", id, { po_number: "P01234" })).error?.code).toBe("42501")
        expect((await item(id)).po_number).toBeNull()
    })
})

describe("a PO with no IPAS yet (the seam answers empty)", () => {
    it("offers no lines, refuses every pick, and the item stays 'PO line not picked'", async () => {
        const id = await seedItem()
        await orderVerified("stageParticipant", id, IPAS_PO)

        expect(await poLines("stageParticipant", id)).toMatchObject({ data: [], error: null })
        const { error } = await pick("stageParticipant", id, [501])
        expect(error?.code).toBe("22023")
        expect(error?.message).toMatch(/has no IPAS yet/)

        expect(await item(id)).toMatchObject({ status: "purchased", po_number: IPAS_PO, odoo_po_line_ids: [] })
        expect(await eventsFor(id, "item_po_lines_picked")).toEqual([])
    })

    it("nobody calls the seam directly", async () => {
        const { error } = await (await clientFor("superAdmin")).rpc("_ipas_po_line_ids", { p_po_number: IPAS_PO })
        expect(error).not.toBeNull()
    })
})

describe("a PO whose IPAS exists", () => {
    it("offers the IPAS copy's lines, accepts them later, and posts the pick", async () => {
        const id = await seedItem()
        await orderVerified("stageParticipant", id, IPAS_PO)

        await withIpas(async () => {
            expect((await poLines("dealOwner", id)).data).toEqual(IPAS_LINES)

            const { data, error } = await pick("stageParticipant", id, [502, 501, 502])
            expect(error).toBeNull()
            expect(data.odoo_po_line_ids).toEqual([501, 502])
        })

        expect((await item(id)).odoo_po_line_ids).toEqual([501, 502])
        expect(await eventsFor(id, "item_po_lines_picked")).toEqual([
            expect.objectContaining({
                author_id: ids.stageParticipant,
                metadata: expect.objectContaining({ po_number: IPAS_PO, line_ids: [501, 502] }),
            }),
        ])
    })

    it("refuses a line not on that PO's IPAS copy, keeping the earlier pick", async () => {
        const id = await seedItem({ status: "purchased", po_number: IPAS_PO, odoo_po_line_ids: [503] })
        await withIpas(async () => {
            const { error } = await pick("stageParticipant", id, [501, 999])
            expect(error?.code).toBe("22023")
            expect(error?.message).toMatch(/999/)
        })
        expect((await item(id)).odoo_po_line_ids).toEqual([503])
    })

    it("refuses another PO's lines: a different PO has no IPAS", async () => {
        const id = await seedItem({ status: "purchased", po_number: "P0888" })
        await withIpas(async () => {
            expect((await poLines("stageParticipant", id)).data).toEqual([])
            expect((await pick("stageParticipant", id, [501])).error?.code).toBe("22023")
        })
    })

    it("lets a Received item's line be picked late", async () => {
        const id = await seedItem({ status: "received", po_number: IPAS_PO })
        await withIpas(async () => {
            expect((await pick("stageParticipant", id, [503])).error).toBeNull()
        })
    })

    it.each([
        ["an item with no PO number", { status: "purchased" }, [501], "22023"],
        ["an item not yet Ordered", { status: "to_purchase", po_number: IPAS_PO }, [501], "22023"],
        ["an empty pick", { status: "purchased", po_number: IPAS_PO }, [], "22023"],
    ])("refuses %s", async (_, fields, lines, code) => {
        const id = await seedItem(fields)
        await withIpas(async () => {
            expect((await pick("stageParticipant", id, lines)).error?.code).toBe(code)
        })
        expect((await item(id)).odoo_po_line_ids).toEqual([])
    })

    it.each([
        ["the sales side", "dealOwner"],
        ["a non-member", "ordinary"],
    ])("%s can't pick", async (_, who) => {
        const id = await seedItem({ status: "purchased", po_number: IPAS_PO })
        await withIpas(async () => {
            expect((await pick(who, id, [501])).error?.code).toBe("42501")
        })
        expect((await item(id)).odoo_po_line_ids).toEqual([])
    })
})

describe("reading the lines", () => {
    it("a non-member can't see an item's PO lines", async () => {
        const id = await seedItem({ status: "purchased", po_number: IPAS_PO })
        expect((await poLines("ordinary", id)).error?.code).toBe("P0002")
    })

    it.each([
        ["purchase_request_item_po_lines", { p_item_id: NO_ID }],
        ["purchase_request_pick_po_lines", { p_item_id: NO_ID, p_line_ids: [1] }],
    ])("someone not signed in cannot call %s", async (fn, args) => {
        const { error } = await anonymousClient().rpc(fn, args)
        expect(error?.message).toMatch(/permission denied/i)
    })
})
