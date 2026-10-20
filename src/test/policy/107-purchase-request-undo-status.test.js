/**
 * Undoing a Requested Item status change (#567, part of #561): only the last
 * change, only by whoever made it, only within the window, and refused once
 * anything else has changed the item. Statuses still only move forward
 * outside `purchase_request_undo_item_status`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const PURCHASERS = ["stageParticipant", "outsider"]

let sorId, requestId

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

const seedItem = (status = "requested") =>
    insert("purchase_request_items", {
        request_id: requestId,
        source: "new",
        name: `${MARKER} Full Body Harness`,
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

const setStatus = async (who, itemId, status) =>
    (await clientFor(who)).rpc("purchase_request_set_item_status", { p_item_id: itemId, p_status: status })

const undo = async (who, itemId, changedAt) =>
    (await clientFor(who)).rpc("purchase_request_undo_item_status", { p_item_id: itemId, p_changed_at: changedAt })

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
    ]) {
        await insert("purchase_request_members", { request_id: requestId, employee_id: ids[employee], side })
    }
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", PURCHASERS.map((k) => ids[k]))
    if (requestId) await svc().from("purchase_requests").delete().eq("id", requestId)
    if (sorId) await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("undo of the last status change", () => {
    it("puts the item back to its previous status", async () => {
        const id = await seedItem()
        const moved = await setStatus("stageParticipant", id, "to_order")
        expect(moved.error).toBeNull()
        const undone = await undo("stageParticipant", id, moved.data.status_changed_at)
        expect(undone.error).toBeNull()
        expect(undone.data.status).toBe("requested")
        expect(undone.data.name).toBe(moved.data.name)
        expect((await item(id)).status).toBe("requested")
    })

    it("is refused once the item has changed since", async () => {
        const id = await seedItem()
        const first = await setStatus("stageParticipant", id, "to_order")
        const second = await setStatus("stageParticipant", id, "canvassing")
        expect(second.error).toBeNull()
        const stale = await undo("stageParticipant", id, first.data.status_changed_at)
        expect(stale.error).not.toBeNull()
        expect((await item(id)).status).toBe("canvassing")
    })

    it("is refused after the window", async () => {
        const id = await seedItem()
        const moved = await setStatus("stageParticipant", id, "to_order")
        const old = new Date(Date.now() - 20_000).toISOString()
        await svc().from("purchase_request_items").update({ status_changed_at: old }).eq("id", id)
        const late = await undo("stageParticipant", id, old)
        expect(late.error).not.toBeNull()
        expect((await item(id)).status).toBe(moved.data.status)
    })

    it("is refused to someone other than whoever made the change", async () => {
        const id = await seedItem()
        const moved = await setStatus("stageParticipant", id, "to_order")
        const other = await undo("outsider", id, moved.data.status_changed_at)
        expect(other.error).not.toBeNull()
        expect((await item(id)).status).toBe("to_order")
    })

    it("does not loosen the forward-only path", async () => {
        const id = await seedItem("to_order")
        const back = await setStatus("stageParticipant", id, "requested")
        expect(back.error).not.toBeNull()
    })
})
