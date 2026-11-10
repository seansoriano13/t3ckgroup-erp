/**
 * The Requested Item status path (#306, part of #209): every change through
 * `purchase_request_set_item_status`, which checks the transition and the caller's side and
 * posts in the request; the Buyer's replacement is proven in 200-replace-a-product.
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
const CLOSED = ["available", "received", "cannot_source", "cancelled"]

let sorId, requestId

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

/** A new item at `status`, seeded directly so each test starts where it needs to. */
const seedItem = (status = "not_checked", name = "Full Body Harness") =>
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
    return (await clientFor(who)).rpc("purchase_request_set_item_status", args)
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
        const { data, error } = await (await clientFor(who)).rpc("purchase_request_actor_side", { p_request_id: requestId })
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
        const { data, error } = await (await clientFor(who)).rpc("purchase_request_can_add_substitute", { p_request_id: requestId })
        expect(error).toBeNull()
        expect(data).toBe(can)
    })
})

describe("purchasing walks the path", () => {
    it("takes an item Not checked → To purchase → Still canvassing by hand", async () => {
        const id = await seedItem()
        for (const [who, status] of [
            ["stageParticipant", "to_purchase"],
            ["outsider", "still_canvassing"],
        ]) {
            const { data, error } = await setStatus(who, id, status)
            expect(error).toBeNull()
            expect(data).toMatchObject({ id, status, status_changed_by: ids[who] })
        }
        expect((await item(id)).status).toBe("still_canvassing")
    })

    it.each(["purchased", "received"])("never lets a person choose %s: it follows the P0 in Odoo (#675)", async (to) => {
        for (const from of ["to_purchase", "still_canvassing", "purchased"]) {
            if (to === "purchased" && from === "purchased") continue
            const id = await seedItem(from)
            const { error } = await setStatus("stageParticipant", id, to)
            expect(error?.code, `${from} → ${to}`).toBe("42501")
            expect((await item(id)).status).toBe(from)
        }
    })

    it("lets nothing move a Received item", async () => {
        const id = await seedItem("received")
        const { error } = await setStatus("stageParticipant", id, "cancelled")
        expect(error?.code).toBe("42501")
    })

    it("may close a Not checked item as Available", async () => {
        const id = await seedItem()
        expect((await setStatus("outsider", id, "available")).error).toBeNull()
        expect((await item(id)).status).toBe("available")
    })

    it.each(["cannot_source", "cancelled"])("may take the way out to %s from an open status", async (to) => {
        const id = await seedItem("still_canvassing")
        expect((await setStatus("stageParticipant", id, to)).error).toBeNull()
    })

    it.each([
        ["skip ahead", "not_checked", "purchased"],
        ["go back", "purchased", "to_purchase"],
        ["stand still", "to_purchase", "to_purchase"],
    ])("can't %s (%s → %s)", async (_, from, to) => {
        const id = await seedItem(from)
        const { error } = await setStatus("stageParticipant", id, to)
        expect(error).not.toBeNull()
        expect((await item(id)).status).toBe(from)
    })

    it.each(CLOSED)("treats %s as closed: nothing moves it", async (closed) => {
        const id = await seedItem(closed)
        for (const who of ["stageParticipant", "dealOwner", "superAdmin"]) {
            const { error } = await setStatus(who, id, closed === "cancelled" ? "not_checked" : "cancelled")
            expect(error?.code).toBe("42501")
        }
        expect((await item(id)).status).toBe(closed)
    })
})

describe("every change posts in the request", () => {
    it("with who changed it, from what to what, and when", async () => {
        const id = await seedItem()
        const before = Date.now()
        await setStatus("stageParticipant", id, "to_purchase")
        await setStatus("dealOwner", id, "cancelled")
        const after = Date.now()

        const posts = await eventsFor(id)
        expect(posts.map(({ author_id, content, metadata }) => ({ author_id, content, metadata }))).toEqual([
            {
                author_id: ids.stageParticipant,
                content: `${MARKER} Full Body Harness: Not checked → To purchase.`,
                metadata: expect.objectContaining({
                    event: "item_status_changed",
                    item_id: id,
                    from: "not_checked",
                    to: "to_purchase",
                    changed_by: ids.stageParticipant,
                }),
            },
            {
                author_id: ids.dealOwner,
                content: `${MARKER} Full Body Harness: To purchase → Cancelled.`,
                metadata: expect.objectContaining({ from: "to_purchase", to: "cancelled", changed_by: ids.dealOwner }),
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
        await setStatus("dealOwner", id, "purchased")
        expect(await eventsFor(id)).toEqual([])
    })
})

describe("the wrong side is refused", () => {
    it("the sales side can cancel", async () => {
        const id = await seedItem("purchased")
        const { data, error } = await setStatus("dealOwner", id, "cancelled")
        expect(error).toBeNull()
        expect(data.status).toBe("cancelled")
    })

    it.each(["purchased", "still_canvassing", "received", "cannot_source"])(
        "the sales side can't set %s",
        async (to) => {
            const id = await seedItem(to === "purchased" ? "to_purchase" : to === "received" ? "purchased" : "not_checked")
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
            expect((await setStatus("outsider", id, "to_purchase")).error?.code).toBe("42501")
        } finally {
            await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
        }
    })

    it("a Super Admin acts as purchasing", async () => {
        const id = await seedItem()
        expect((await setStatus("superAdmin", id, "to_purchase")).error).toBeNull()
    })

    it("a direct update of the status is refused", async () => {
        const id = await seedItem()
        await (await clientFor("stageParticipant")).from("purchase_request_items").update({ status: "purchased" }).eq("id", id)
        expect((await item(id)).status).toBe("not_checked")
    })
})

describe("bad input", () => {
    it("refuses a value that isn't a status", async () => {
        const id = await seedItem()
        expect((await setStatus("stageParticipant", id, "shipped")).error?.code).toBe("22023")
    })

    it("refuses details a status doesn't take (only Ordered takes a PO number, #312)", async () => {
        const id = await seedItem()
        expect((await setStatus("stageParticipant", id, "to_purchase", { po_number: "P01234" })).error?.code).toBe("22023")
        expect((await setStatus("stageParticipant", id, "to_purchase", {})).error).toBeNull()
    })

    it("refuses an item that doesn't exist", async () => {
        expect((await setStatus("stageParticipant", NO_ID, "to_purchase")).error?.code).toBe("P0002")
    })
})

describe("someone not signed in", () => {
    it.each([
        ["purchase_request_actor_side", { p_request_id: NO_ID }],
        ["purchase_request_can_add_substitute", { p_request_id: NO_ID }],
        ["purchase_request_set_item_status", { p_item_id: NO_ID, p_status: "cancelled" }],
    ])("cannot call %s at all", async (fn, args) => {
        const { error } = await anonymousClient().rpc(fn, args)
        expect(error?.message).toMatch(/permission denied/i)
    })

    it.each(["_purchase_request_post_event", "_purchase_request_item_move"])("nobody calls %s directly", async (fn) => {
        const { error } = await (await clientFor("superAdmin")).rpc(fn, {})
        expect(error).not.toBeNull()
    })
})
