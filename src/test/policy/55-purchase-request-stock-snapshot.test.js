/**
 * Stock on saved Requested Items (#501, follow-up to #209):
 * `purchase_request_stock_snapshot` hands the SOR's stock snapshot to whoever
 * may read the request.
 *
 * `stageParticipant` is given Purchasing access here and is the Buyer. It is
 * a request member with no window on the SOR, so its SOR access is only
 * 'locked' and the snapshot's own read policy refuses it; a pass is the RPC's
 * doing. `ordinary` is not a member and has no Purchasing access.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const requests = []
const sors = []

const DATA = { 101: { type: "product", free: 3, onHand: 5, forecast: 5, byWarehouse: [] } }
const FETCHED_AT = "2026-10-01T02:00:00.000Z"

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

/** A Project request with the Buyer and the Deal Owner as members; stock read if `stock`. */
async function newRequest({ stock = true } = {}) {
    const sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sors.push(sorId)
    if (stock) {
        const { error } = await svc()
            .from("sor_stock_snapshots")
            .insert({ opportunity_id: sorId, fetched_at: FETCHED_AT, fetched_by: ids.dealOwner, data: DATA })
        if (error) throw new Error(`Seeding sor_stock_snapshots: ${error.message}`)
    }
    const requestId = await insert("purchase_requests", {
        opportunity_id: sorId,
        created_by: ids.dealOwner,
        buyer_id: ids.stageParticipant,
    })
    requests.push(requestId)
    for (const [employee, side] of [
        ["dealOwner", "sales"],
        ["stageParticipant", "purchasing"],
    ]) {
        await insert("purchase_request_members", { request_id: requestId, employee_id: ids[employee], side })
    }
    return { sorId, requestId }
}

const snapshot = async (who, requestId) =>
    (await clientFor(who)).rpc("purchase_request_stock_snapshot", { p_request_id: requestId })

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.stageParticipant)
    if (flag.error) throw flag.error
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.stageParticipant)
    for (const id of requests) {
        await svc().from("notifications").delete().eq("reference_id", id)
        await svc().from("sor_stage_participants").delete().eq("source_id", id)
        await svc().from("purchase_requests").delete().eq("id", id)
    }
    if (sors.length) await svc().from("sales_opportunities").delete().in("id", sors)
})

describe("purchase_request_stock_snapshot", () => {
    let sorId, requestId
    beforeAll(async () => {
        ;({ sorId, requestId } = await newRequest())
    })

    it("gives the Buyer the SOR's snapshot though their SOR access is only locked", async () => {
        const client = await clientFor("stageParticipant")
        expect((await client.rpc("sor_access_level", { p_opportunity_id: sorId })).data).toBe("locked")
        const direct = await client.from("sor_stock_snapshots").select("opportunity_id").eq("opportunity_id", sorId)
        expect(direct.data).toEqual([])

        const { data, error } = await snapshot("stageParticipant", requestId)
        expect(error).toBeNull()
        expect(data.data).toEqual(DATA)
        expect(new Date(data.fetched_at).toISOString()).toBe(FETCHED_AT)
    })

    it("gives a sales-side member the same snapshot", async () => {
        const { data, error } = await snapshot("dealOwner", requestId)
        expect(error).toBeNull()
        expect(data.data).toEqual(DATA)
    })

    it("gives someone who can't read the request nothing", async () => {
        const { data, error } = await snapshot("ordinary", requestId)
        expect(error).toBeNull()
        expect(data).toBeNull()
    })

    it("gives nothing for a request whose SOR's stock was never read", async () => {
        const { requestId: unread } = await newRequest({ stock: false })
        const { data, error } = await snapshot("stageParticipant", unread)
        expect(error).toBeNull()
        expect(data).toBeNull()
    })
})
