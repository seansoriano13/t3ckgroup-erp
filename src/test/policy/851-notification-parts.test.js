/**
 * Merged status notifications keep their changes as data (#851, #852 follow-up):
 * a product name with ": ", ", " or " → " in it neither garbles the merged
 * message nor stops an undo from taking its change back out.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const PURCHASERS = ["stageParticipant"]
const AWKWARD = [`${MARKER} Rope: 11mm, static → 100m`, `${MARKER} Helmet, Class E: white`]

let sorId, requestId

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

const seedItem = (name) =>
    insert("purchase_request_items", {
        request_id: requestId,
        source: "new",
        name,
        unit: "pc",
        quantity: 1,
        status: "not_checked",
        requested_by: ids.dealOwner,
    })

const setStatus = async (itemId, status) => {
    const { data, error } = await (await clientFor("stageParticipant")).rpc("purchase_request_set_item_status", {
        p_item_id: itemId,
        p_status: status,
    })
    if (error) throw error
    return data
}

const undo = async (itemId, changedAt) => {
    const { error } = await (await clientFor("stageParticipant")).rpc("purchase_request_undo_item_status", {
        p_item_id: itemId,
        p_changed_at: changedAt,
    })
    if (error) throw error
}

async function requesterStatusNotes() {
    const { data, error } = await svc()
        .from("notifications")
        .select("title, message, parts")
        .eq("recipient_id", ids.dealOwner)
        .eq("reference_id", requestId)
        .eq("type", "PURCHASE_REQUEST_ITEM_STATUS")
    if (error) throw error
    return data
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
    ]) {
        await insert("purchase_request_members", { request_id: requestId, employee_id: ids[employee], side })
    }
})

beforeEach(async () => {
    await svc().from("notifications").delete().eq("reference_id", requestId)
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", PURCHASERS.map((k) => ids[k]))
    if (requestId) {
        await svc().from("notifications").delete().eq("reference_id", requestId)
        await svc().from("purchase_requests").delete().eq("id", requestId)
    }
    if (sorId) await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("merged status notifications", () => {
    it("merge two changes into one row that names each product whole", async () => {
        const [a, b] = await Promise.all(AWKWARD.map(seedItem))
        await setStatus(a, "to_purchase")
        await setStatus(b, "to_purchase")

        const notes = await requesterStatusNotes()
        expect(notes).toHaveLength(1)
        expect(notes[0].parts).toHaveLength(2)
        expect(notes[0].message).toMatch(/2 products changed: /)
        for (const name of AWKWARD) expect(notes[0].message).toContain(name)
    })

    it("take an undone change back out, then withdraw the row when none is left", async () => {
        const [a, b] = await Promise.all(AWKWARD.map(seedItem))
        const movedA = await setStatus(a, "to_purchase")
        const movedB = await setStatus(b, "to_purchase")

        await undo(b, movedB.status_changed_at)
        let notes = await requesterStatusNotes()
        const left = notes.filter((n) => n.parts)
        expect(left).toHaveLength(1)
        expect(left[0].parts).toHaveLength(1)
        expect(left[0].title).toBe("Requested Item updated")
        expect(left[0].message).toContain(AWKWARD[0])
        expect(left[0].message).not.toContain(AWKWARD[1])

        await undo(a, movedA.status_changed_at)
        notes = await requesterStatusNotes()
        expect(notes.filter((n) => n.parts)).toHaveLength(0)
    })
})
