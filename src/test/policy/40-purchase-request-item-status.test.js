/**
 * The Requested Item status path (#306, part of #209): every change through
 * `pr_set_item_status`, which checks the transition and the caller's side and
 * posts in the request; the Buyer's substitutes through `pr_add_substitute`.
 *
 * `stageParticipant` is the Buyer and `outsider` a purchasing member who isn't
 * (both given Purchasing access here); `dealOwner` is on the sales side; `hr`
 * on the other side; `ordinary` is not a member; `superAdmin` isn't one either.
 * Items are seeded and read back with the service role, so a pass is the
 * RPC's doing and not a policy's.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const NO_ID = "00000000-0000-0000-0000-000000000000"
const PURCHASERS = ["stageParticipant", "outsider"]
const CLOSED = ["from_stock", "received", "substituted", "cannot_source", "cancelled"]

let sorId, requestId

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

/** A new item at `status`, seeded directly so each test starts where it needs to. */
const seedItem = (status = "requested", name = "Full Body Harness") =>
    insert("purchase_request_items", {
        request_id: requestId,
        source: "new",
        name: `${MARKER} ${name}`,
        unit: "pc",
        quantity: 10,
        status,
        requested_by: ids.dealOwner,
    })

async function item(id) {
    const { data, error } = await svc().from("purchase_request_items").select("*").eq("id", id).single()
    if (error) throw error
    return data
}

async function eventsFor(itemId, event = "item_status_changed") {
    const { data, error } = await svc()
        .from("purchase_request_messages")
        .select("author_id, content, metadata, created_at")
        .eq("request_id", requestId)
        .contains("metadata", { event, item_id: itemId })
        .order("created_at")
    if (error) throw error
    return data
}

async function setStatus(who, itemId, status, details) {
    const args = { p_item_id: itemId, p_status: status }
    if (details !== undefined) args.p_details = details
    return (await clientFor(who)).rpc("pr_set_item_status", args)
}

async function substitute(who, itemId, fields = {}) {
    return (await clientFor(who)).rpc("pr_add_substitute", {
        p_item_id: itemId,
        p_name: `${MARKER} Harness, other brand`,
        p_quantity: 10,
        p_unit: "pc",
        ...fields,
    })
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).in("id", PURCHASERS.map((k) => ids[k]))
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
        ["outsider", "purchasing"],
        ["hr", "other"],
    ]) {
        await insert("purchase_request_members", { request_id: requestId, employee_id: ids[employee], side })
    }
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", PURCHASERS.map((k) => ids[k]))
    if (requestId) await svc().from("purchase_requests").delete().eq("id", requestId)
    if (sorId) await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("the caller's side", () => {
    it.each([
        ["the Buyer", "stageParticipant", "purchasing"],
        ["a purchasing member", "outsider", "purchasing"],
        ["a Super Admin, member or not", "superAdmin", "purchasing"],
        ["the sales side", "dealOwner", "sales"],
        ["a member on the other side", "hr", "other"],
        ["a non-member", "ordinary", null],
    ])("%s is %s", async (_, who, side) => {
        const { data, error } = await (await clientFor(who)).rpc("pr_actor_side", { p_request_id: requestId })
        expect(error).toBeNull()
        expect(data).toBe(side)
    })

    it.each([
        ["stageParticipant", true],
        ["superAdmin", true],
        ["outsider", false],
        ["dealOwner", false],
        ["ordinary", false],
    ])("%s may add a substitute: %s", async (who, can) => {
        const { data, error } = await (await clientFor(who)).rpc("pr_can_add_substitute", { p_request_id: requestId })
        expect(error).toBeNull()
        expect(data).toBe(can)
    })
})

describe("purchasing walks the path", () => {
    it("takes an item Requested → To order → Canvassing → Ordered → Received, then nowhere", async () => {
        const id = await seedItem()
        for (const [who, status] of [
            ["stageParticipant", "to_order"],
            ["outsider", "canvassing"],
            ["stageParticipant", "ordered"],
            ["outsider", "received"],
        ]) {
            const { data, error } = await setStatus(who, id, status)
            expect(error).toBeNull()
            expect(data).toMatchObject({ id, status, status_changed_by: ids[who] })
        }
        expect((await item(id)).status).toBe("received")

        const { error } = await setStatus("stageParticipant", id, "cancelled")
        expect(error?.code).toBe("42501")
    })

    it("may skip Canvassing: To order → Ordered", async () => {
        const id = await seedItem("to_order")
        expect((await setStatus("stageParticipant", id, "ordered")).error).toBeNull()
    })

    it("may close a Requested item as From stock", async () => {
        const id = await seedItem()
        expect((await setStatus("outsider", id, "from_stock")).error).toBeNull()
        expect((await item(id)).status).toBe("from_stock")
    })

    it.each(["substituted", "cannot_source", "cancelled"])("may take the way out to %s from an open status", async (to) => {
        const id = await seedItem("canvassing")
        expect((await setStatus("stageParticipant", id, to)).error).toBeNull()
    })

    it.each([
        ["skip ahead", "requested", "ordered"],
        ["go back", "ordered", "to_order"],
        ["stand still", "to_order", "to_order"],
    ])("can't %s (%s → %s)", async (_, from, to) => {
        const id = await seedItem(from)
        const { error } = await setStatus("stageParticipant", id, to)
        expect(error).not.toBeNull()
        expect((await item(id)).status).toBe(from)
    })

    it.each(CLOSED)("treats %s as closed: nothing moves it", async (closed) => {
        const id = await seedItem(closed)
        for (const who of ["stageParticipant", "dealOwner", "superAdmin"]) {
            const { error } = await setStatus(who, id, closed === "cancelled" ? "requested" : "cancelled")
            expect(error?.code).toBe("42501")
        }
        expect((await item(id)).status).toBe(closed)
    })
})

describe("every change posts in the request", () => {
    it("with who changed it, from what to what, and when", async () => {
        const id = await seedItem()
        const before = Date.now()
        await setStatus("stageParticipant", id, "to_order")
        await setStatus("dealOwner", id, "cancelled")
        const after = Date.now()

        const posts = await eventsFor(id)
        expect(posts.map(({ author_id, content, metadata }) => ({ author_id, content, metadata }))).toEqual([
            {
                author_id: ids.stageParticipant,
                content: `${MARKER} Full Body Harness: Requested → To order.`,
                metadata: expect.objectContaining({
                    event: "item_status_changed",
                    item_id: id,
                    from: "requested",
                    to: "to_order",
                    changed_by: ids.stageParticipant,
                }),
            },
            {
                author_id: ids.dealOwner,
                content: `${MARKER} Full Body Harness: To order → Cancelled.`,
                metadata: expect.objectContaining({ from: "to_order", to: "cancelled", changed_by: ids.dealOwner }),
            },
        ])
        for (const post of posts) {
            const at = new Date(post.metadata.changed_at).getTime()
            expect(at).toBeGreaterThanOrEqual(before - 5000)
            expect(at).toBeLessThanOrEqual(after + 5000)
        }

        const row = await item(id)
        expect(row.status_changed_by).toBe(ids.dealOwner)
        expect(new Date(row.status_changed_at).getTime()).toBe(new Date(posts[1].metadata.changed_at).getTime())
    })

    it("a refused change posts nothing", async () => {
        const id = await seedItem()
        await setStatus("dealOwner", id, "ordered")
        expect(await eventsFor(id)).toEqual([])
    })
})

describe("the wrong side is refused", () => {
    it("the sales side can cancel", async () => {
        const id = await seedItem("ordered")
        const { data, error } = await setStatus("dealOwner", id, "cancelled")
        expect(error).toBeNull()
        expect(data.status).toBe("cancelled")
    })

    it.each(["ordered", "to_order", "from_stock", "substituted", "cannot_source"])(
        "the sales side can't set %s",
        async (to) => {
            const id = await seedItem(to === "ordered" ? "to_order" : "requested")
            const { error } = await setStatus("dealOwner", id, to)
            expect(error?.code).toBe("42501")
            expect((await item(id)).status).not.toBe(to)
        },
    )

    it("a member on the other side can't even cancel", async () => {
        const id = await seedItem()
        expect((await setStatus("hr", id, "cancelled")).error?.code).toBe("42501")
    })

    it("a non-member is refused", async () => {
        const id = await seedItem()
        expect((await setStatus("ordinary", id, "cancelled")).error?.code).toBe("42501")
    })

    it("a purchasing member whose Purchasing access was taken away is refused", async () => {
        const id = await seedItem()
        await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
        try {
            expect((await setStatus("outsider", id, "to_order")).error?.code).toBe("42501")
        } finally {
            await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
        }
    })

    it("a Super Admin acts as purchasing", async () => {
        const id = await seedItem()
        expect((await setStatus("superAdmin", id, "to_order")).error).toBeNull()
    })

    it("a direct update of the status is refused", async () => {
        const id = await seedItem()
        await (await clientFor("stageParticipant")).from("purchase_request_items").update({ status: "ordered" }).eq("id", id)
        expect((await item(id)).status).toBe("requested")
    })
})

describe("bad input", () => {
    it("refuses a value that isn't a status", async () => {
        const id = await seedItem()
        expect((await setStatus("stageParticipant", id, "shipped")).error?.code).toBe("22023")
    })

    it("refuses details a status doesn't take (only Ordered takes a PO number, #312)", async () => {
        const id = await seedItem()
        expect((await setStatus("stageParticipant", id, "to_order", { po_number: "P01234" })).error?.code).toBe("22023")
        expect((await setStatus("stageParticipant", id, "to_order", {})).error).toBeNull()
    })

    it("refuses an item that doesn't exist", async () => {
        expect((await setStatus("stageParticipant", NO_ID, "to_order")).error?.code).toBe("P0002")
    })
})

describe("the Buyer adds a substitute", () => {
    it("linked to the item it replaces, which moves to Substituted; both post", async () => {
        const original = await seedItem("canvassing")
        const { data: subId, error } = await substitute("stageParticipant", original, { p_description: "Same rating" })
        expect(error).toBeNull()

        expect(await item(subId)).toMatchObject({
            request_id: requestId,
            source: "new",
            name: `${MARKER} Harness, other brand`,
            quantity: 10,
            unit: "pc",
            description: "Same rating",
            status: "requested",
            substitute_for_item_id: original,
            requested_by: ids.stageParticipant,
        })
        expect(await item(original)).toMatchObject({ status: "substituted", status_changed_by: ids.stageParticipant })

        expect(await eventsFor(subId, "item_added")).toEqual([
            expect.objectContaining({
                author_id: ids.stageParticipant,
                content: `Offered ${MARKER} Harness, other brand × 10 pc as a substitute for ${MARKER} Full Body Harness.`,
                metadata: expect.objectContaining({ substitute_for_item_id: original }),
            }),
        ])
        expect(await eventsFor(original)).toEqual([
            expect.objectContaining({
                author_id: ids.stageParticipant,
                metadata: expect.objectContaining({
                    from: "canvassing",
                    to: "substituted",
                    details: { substitute_item_id: subId },
                }),
            }),
        ])
    })

    it.each([
        ["a purchasing member who isn't the Buyer", "outsider"],
        ["the sales side", "dealOwner"],
        ["a non-member", "ordinary"],
    ])("%s can't", async (_, who) => {
        const original = await seedItem()
        expect((await substitute(who, original)).error?.code).toBe("42501")
        expect((await item(original)).status).toBe("requested")
    })

    it("not for an item already closed", async () => {
        const original = await seedItem("cancelled")
        expect((await substitute("stageParticipant", original)).error?.code).toBe("22023")
    })

    it.each([
        ["a blank name", { p_name: " " }],
        ["a quantity of zero", { p_quantity: 0 }],
    ])("refuses %s, leaving the original open", async (_, fields) => {
        const original = await seedItem()
        expect((await substitute("stageParticipant", original, fields)).error?.code).toBe("22023")
        expect((await item(original)).status).toBe("requested")
    })
})

describe("someone not signed in", () => {
    it.each([
        ["pr_actor_side", { p_request_id: NO_ID }],
        ["pr_can_add_substitute", { p_request_id: NO_ID }],
        ["pr_set_item_status", { p_item_id: NO_ID, p_status: "cancelled" }],
        ["pr_add_substitute", { p_item_id: NO_ID, p_name: "x", p_quantity: 1 }],
    ])("cannot call %s at all", async (fn, args) => {
        const { error } = await anonymousClient().rpc(fn, args)
        expect(error?.message).toMatch(/permission denied/i)
    })

    it.each(["_purchase_request_post_event", "_purchase_request_item_move"])("nobody calls %s directly", async (fn) => {
        const { error } = await (await clientFor("superAdmin")).rpc(fn, {})
        expect(error).not.toBeNull()
    })
})
