/**
 * Purchase Requests (#303, part of #209): the four tables and who reads them.
 *
 * A member of the request reads it, its members, items and messages; so does
 * a Super Admin. Anyone with Purchasing access also reads a request with no
 * Buyer yet (the queue's Take) and loses it once a Buyer is set, unless they
 * are a member. Messages are append-only, the author included. Every other
 * write belongs to an RPC from a later ticket, so a direct write is refused.
 *
 * `outsider` is given Purchasing access for this file only, and is never made
 * a member, so any read it gets can only be the flag on an unassigned request.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, rlsStatus } from "./support/stack.js"
import { makeSor, MARKER } from "./support/rows.js"
import { canRead, tryInsert, tryUpdate, tryDelete, RLS_VIOLATION } from "./support/access.js"

const svc = () => serviceClient()
const TABLES = ["purchase_requests", "purchase_request_members", "purchase_request_items", "purchase_request_messages"]

let sorId, unassigned, assigned, item, message

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

/** Attempt a service-role insert, which bypasses RLS, so only a constraint can refuse it. */
async function constraintInsert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id")
    if (!error) {
        await svc().from(table).delete().eq("id", data[0].id)
        return null
    }
    return error.code
}

const itemRow = (requestId, overrides = {}) => ({
    request_id: requestId,
    source: "new",
    name: `${MARKER} Rope, 11mm static`,
    unit: "roll",
    quantity: 2,
    requested_by: ids.dealOwner,
    ...overrides,
})

beforeAll(async () => {
    await ensureCastLoaded()
    const { error } = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (error) throw error

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })

    // No Buyer: the dealOwner (sales) and stageParticipant (purchasing) are members.
    unassigned = await insert("purchase_requests", { opportunity_id: sorId, created_by: ids.dealOwner })
    await insert("purchase_request_members", { request_id: unassigned, employee_id: ids.dealOwner, side: "sales" })
    await insert("purchase_request_members", { request_id: unassigned, employee_id: ids.stageParticipant, side: "purchasing" })
    item = await insert("purchase_request_items", itemRow(unassigned))
    message = await insert("purchase_request_messages", {
        request_id: unassigned,
        author_id: ids.dealOwner,
        content: `${MARKER} Can we get these by the 20th?`,
    })

    // A Buyer: stageParticipant owns it and is its only member. No SOR.
    assigned = await insert("purchase_requests", { created_by: ids.stageParticipant, buyer_id: ids.stageParticipant, title: `${MARKER} Direct` })
    await insert("purchase_request_members", { request_id: assigned, employee_id: ids.stageParticipant, side: "purchasing" })
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await svc().from("purchase_requests").delete().in("id", [unassigned, assigned].filter(Boolean))
    if (sorId) await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("the tables", () => {
    it.each(TABLES)("%s has row level security on", async (table) => {
        const { enabled, policies } = await rlsStatus(table)
        expect(enabled).toBe(true)
        expect(policies).toBeGreaterThan(0)
    })

    it("the item status CHECK refuses a value outside the eight", async () => {
        expect(await constraintInsert("purchase_request_items", itemRow(unassigned, { status: "shipped" }))).toBe("23514")
    })

    it.each([
        "not_checked", "available", "to_purchase", "still_canvassing", "purchased",
        "received", "cannot_source", "cancelled",
    ])("the item status CHECK accepts %s", async (status) => {
        expect(await constraintInsert("purchase_request_items", itemRow(unassigned, { status }))).toBeNull()
    })

    it("a new item starts at Not checked, with no PO lines", async () => {
        const { data } = await svc()
            .from("purchase_request_items")
            .select("status, po_verification, odoo_po_line_ids, images")
            .eq("id", item)
            .single()
        expect(data).toEqual({ status: "not_checked", po_verification: "UNVERIFIED", odoo_po_line_ids: [], images: [] })
    })

    it("refuses an item source, member side or PO verification outside its set", async () => {
        expect(await constraintInsert("purchase_request_items", itemRow(unassigned, { source: "costing_matrix" }))).toBe("23514")
        expect(await constraintInsert("purchase_request_items", itemRow(unassigned, { po_verification: "MAYBE" }))).toBe("23514")
        expect(
            await constraintInsert("purchase_request_members", { request_id: assigned, employee_id: ids.head, side: "finance" }),
        ).toBe("23514")
    })

    it("refuses a blank name or a quantity of zero", async () => {
        expect(await constraintInsert("purchase_request_items", itemRow(unassigned, { name: "  " }))).toBe("23514")
        expect(await constraintInsert("purchase_request_items", itemRow(unassigned, { quantity: 0 }))).toBe("23514")
    })

    it("holds at most one request per SOR", async () => {
        expect(await constraintInsert("purchase_requests", { opportunity_id: sorId, created_by: ids.dealOwner })).toBe("23505")
    })

    it("allows any number of requests with no SOR (Direct, #179: each with a title)", async () => {
        expect(await constraintInsert("purchase_requests", { created_by: ids.dealOwner, title: `${MARKER} Direct` })).toBeNull()
    })

    it("holds a person once per request", async () => {
        expect(
            await constraintInsert("purchase_request_members", { request_id: unassigned, employee_id: ids.dealOwner, side: "other" }),
        ).toBe("23505")
    })
})

describe("reading a request", () => {
    const rowsOf = (requestId) => [
        ["purchase_requests", requestId],
        ["purchase_request_items", item],
        ["purchase_request_messages", message],
    ]

    it.each([["dealOwner"], ["stageParticipant"], ["superAdmin"]])(
        "a member or Super Admin reads the request, its items and its messages: %s",
        async (key) => {
            const client = await clientFor(key)
            for (const [table, id] of rowsOf(unassigned)) expect(await canRead(client, table, id)).toBe(true)
        },
    )

    it("a member reads the request's members", async () => {
        const { data } = await (await clientFor("dealOwner"))
            .from("purchase_request_members")
            .select("employee_id")
            .eq("request_id", unassigned)
        expect(data.map((m) => m.employee_id).sort()).toEqual([ids.dealOwner, ids.stageParticipant].sort())
    })

    it.each([["ordinary"], ["head"], ["hr"], ["support"]])(
        "a non-member without Purchasing access reads none of it: %s",
        async (key) => {
            const client = await clientFor(key)
            for (const [table, id] of rowsOf(unassigned)) expect(await canRead(client, table, id)).toBe(false)
            const { data } = await client.from("purchase_request_members").select("id").eq("request_id", unassigned)
            expect(data).toEqual([])
        },
    )
})

describe("Purchasing access", () => {
    it("reads an unassigned request it is not a member of, with its items", async () => {
        const client = await clientFor("outsider")
        expect(await canRead(client, "purchase_requests", unassigned)).toBe(true)
        expect(await canRead(client, "purchase_request_items", item)).toBe(true)
    })

    it("does not read an assigned request it is not a member of", async () => {
        expect(await canRead(await clientFor("outsider"), "purchase_requests", assigned)).toBe(false)
    })

    it("the assigned request's Buyer, a member, still reads it", async () => {
        expect(await canRead(await clientFor("stageParticipant"), "purchase_requests", assigned)).toBe(true)
    })

    it("loses an unassigned request once it gets a Buyer", async () => {
        const id = await insert("purchase_requests", { created_by: ids.dealOwner, title: `${MARKER} Direct` })
        try {
            const client = await clientFor("outsider")
            expect(await canRead(client, "purchase_requests", id)).toBe(true)
            await svc().from("purchase_requests").update({ buyer_id: ids.stageParticipant }).eq("id", id)
            expect(await canRead(client, "purchase_requests", id)).toBe(false)
        } finally {
            await svc().from("purchase_requests").delete().eq("id", id)
        }
    })
})

describe("messages are append-only", () => {
    it.each([["dealOwner"], ["superAdmin"]])("nobody edits or deletes one, the author included: %s", async (key) => {
        const client = await clientFor(key)
        expect((await tryUpdate(client, "purchase_request_messages", message, { content: "edited" })).affected).toBe(0)
        expect((await tryDelete(client, "purchase_request_messages", message)).affected).toBe(0)
        const { data } = await svc().from("purchase_request_messages").select("content").eq("id", message).single()
        expect(data.content).toBe(`${MARKER} Can we get these by the 20th?`)
    })

    it("a member posts as themselves", async () => {
        const result = await tryInsert(await clientFor("stageParticipant"), "purchase_request_messages", {
            request_id: unassigned,
            author_id: ids.stageParticipant,
            content: `${MARKER} Checking stock now`,
        })
        expect(result.ok).toBe(true)
    })

    it("a member cannot post in someone else's name", async () => {
        const result = await tryInsert(await clientFor("stageParticipant"), "purchase_request_messages", {
            request_id: unassigned,
            author_id: ids.dealOwner,
            content: `${MARKER} forged`,
        })
        expect(result.code).toBe(RLS_VIOLATION)
    })

    it("a member cannot hand-post a status event", async () => {
        const result = await tryInsert(await clientFor("stageParticipant"), "purchase_request_messages", {
            request_id: unassigned,
            author_id: ids.stageParticipant,
            content: `${MARKER} Received`,
            metadata: { event: "status_changed" },
        })
        expect(result.code).toBe(RLS_VIOLATION)
    })

    it("a non-member cannot post, Purchasing access or not", async () => {
        for (const key of ["ordinary", "outsider"]) {
            const result = await tryInsert(await clientFor(key), "purchase_request_messages", {
                request_id: unassigned,
                author_id: ids[key],
                content: `${MARKER} not a member`,
            })
            expect(result.code).toBe(RLS_VIOLATION)
        }
    })
})

describe("every other write waits for its RPC", () => {
    it("a member cannot open a request, add an item or add a member directly", async () => {
        const client = await clientFor("dealOwner")
        expect((await tryInsert(client, "purchase_requests", { created_by: ids.dealOwner })).code).toBe(RLS_VIOLATION)
        expect((await tryInsert(client, "purchase_request_items", itemRow(unassigned))).code).toBe(RLS_VIOLATION)
        expect(
            (await tryInsert(client, "purchase_request_members", { request_id: unassigned, employee_id: ids.ordinary, side: "other" })).code,
        ).toBe(RLS_VIOLATION)
    })

    it("a purchasing member cannot set a status or a Buyer directly", async () => {
        const client = await clientFor("stageParticipant")
        expect((await tryUpdate(client, "purchase_request_items", item, { status: "purchased" })).affected).toBe(0)
        expect((await tryUpdate(client, "purchase_requests", unassigned, { buyer_id: ids.stageParticipant })).affected).toBe(0)
    })
})
