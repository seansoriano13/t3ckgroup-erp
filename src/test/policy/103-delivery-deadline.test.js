/**
 * The client's delivery deadline (#467, spec #461 Q5 and Q15), against the real
 * stack.
 *
 *   order_deadline_setting   N, default 5. Any employee reads; Purchasing access
 *                            and Super Admins write; nobody deletes.
 *   sor_delivery_deadlines   the due date of an SOR's `deadline` condition, from
 *                            its Flow Snapshot and its visit to the stage that
 *                            carries it (not only its current stage).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const DAY = 86_400_000

let saleTypeId, flowId, ntpStageId, deliveryStageId, snapshotId, noDeadlineSnapshotId
const sorIds = []

const one = async (query, what) => {
    const { data, error } = await query.select("id").single()
    if (error) throw new Error(`${what}: ${error.message}`)
    return data.id
}

async function sorWith(snapshot, { visits }) {
    const id = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        saleTypeId,
        flowStageId: deliveryStageId,
    })
    sorIds.push(id)
    const link = await svc().from("sales_opportunities").update({ flow_snapshot_id: snapshot }).eq("id", id)
    if (link.error) throw new Error(link.error.message)
    // Start clean, then record exactly the visits asked for.
    await svc().from("sor_stage_visits").delete().eq("opportunity_id", id)
    let sequence = 0
    for (const visit of visits) {
        sequence += 1
        const made = await svc().from("sor_stage_visits").insert({
            opportunity_id: id,
            flow_stage_id: visit.stage,
            flow_snapshot_id: snapshot,
            sequence,
            entered_at: visit.enteredAt,
            undone_at: visit.undone ? new Date().toISOString() : null,
        })
        if (made.error) throw new Error(`visit: ${made.error.message}`)
    }
    return id
}

const deadlines = async (who, oppIds) => (await clientFor(who)).rpc("sor_delivery_deadlines", { p_opportunity_ids: oppIds })

beforeAll(async () => {
    await ensureCastLoaded()
    await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)

    saleTypeId = await one(svc().from("sale_types").insert({ name: `${MARKER} Delivery Deadline` }), "sale type")
    flowId = await one(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }), "flow")
    ntpStageId = await one(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} NTP`, sort_order: 10 }), "NTP")
    deliveryStageId = await one(
        svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Project Delivery`, sort_order: 20 }),
        "delivery",
    )
    snapshotId = await one(
        svc().from("flow_snapshots").insert({
            flow_id: flowId,
            version: 9301,
            snapshot_data: {
                conditions: [
                    { stage_id: ntpStageId, kind: "deadline", label: "Delivery Deadline", config: { days: 15 } },
                    { stage_id: ntpStageId, kind: "tickbox", label: "Unrelated", config: {} },
                ],
            },
        }),
        "snapshot",
    )
    noDeadlineSnapshotId = await one(
        svc().from("flow_snapshots").insert({
            flow_id: flowId,
            version: 9302,
            snapshot_data: { conditions: [{ stage_id: ntpStageId, kind: "tickbox", config: {} }] },
        }),
        "snapshot without a deadline",
    )
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await svc().from("sor_stage_visits").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_snapshots").delete().eq("flow_id", flowId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
    await svc().from("order_deadline_setting").update({ near_days: 5 }).eq("id", true)
})

describe("order_deadline_setting", () => {
    it("is seeded at 5 and readable by any employee", async () => {
        const { data, error } = await (await clientFor("ordinary")).from("order_deadline_setting").select("near_days")
        if (error) throw error
        expect(data).toEqual([{ near_days: 5 }])
    })

    it("lets Purchasing access and a Super Admin change it", async () => {
        for (const [who, days] of [["outsider", 7], ["superAdmin", 4]]) {
            const { data, error } = await (await clientFor(who)).from("order_deadline_setting").update({ near_days: days }).eq("id", true).select("near_days")
            if (error) throw error
            expect(data).toEqual([{ near_days: days }])
        }
    })

    it("refuses a plain employee and Finance, and a day count below one", async () => {
        for (const who of ["ordinary", "finance"]) {
            const { data } = await (await clientFor(who)).from("order_deadline_setting").update({ near_days: 9 }).eq("id", true).select("near_days")
            expect(data ?? []).toHaveLength(0)
        }
        const { data: stored } = await svc().from("order_deadline_setting").select("near_days").eq("id", true).single()
        expect(stored.near_days).not.toBe(9)

        const zero = await (await clientFor("outsider")).from("order_deadline_setting").update({ near_days: 0 }).eq("id", true).select("near_days")
        expect(zero.error?.code).toBe("23514")
    })

    it("allows only the one row and never a delete", async () => {
        const second = await svc().from("order_deadline_setting").insert({ id: false, near_days: 3 })
        expect(second.error?.code).toBe("23514")
        const { data } = await (await clientFor("superAdmin")).from("order_deadline_setting").delete().eq("id", true).select("id")
        expect(data ?? []).toHaveLength(0)
        const { data: still } = await svc().from("order_deadline_setting").select("id")
        expect(still).toHaveLength(1)
    })
})

describe("sor_delivery_deadlines", () => {
    it("is the NTP visit time plus the condition's days, though the SOR now sits at Project Delivery", async () => {
        const enteredAt = new Date(Date.now() - 10 * DAY).toISOString()
        const sor = await sorWith(snapshotId, {
            visits: [
                { stage: ntpStageId, enteredAt },
                { stage: deliveryStageId, enteredAt: new Date(Date.now() - 2 * DAY).toISOString() },
            ],
        })

        const { data, error } = await deadlines("outsider", [sor])
        if (error) throw error
        expect(data).toHaveLength(1)
        expect(data[0].opportunity_id).toBe(sor)
        expect(data[0].days).toBe(15)
        expect(new Date(data[0].due_at).getTime()).toBe(new Date(enteredAt).getTime() + 15 * DAY)
    })

    it("counts from the latest visit to the stage, ignoring an undone one", async () => {
        const first = new Date(Date.now() - 30 * DAY).toISOString()
        const second = new Date(Date.now() - 6 * DAY).toISOString()
        const undone = new Date(Date.now() - 1 * DAY).toISOString()
        const sor = await sorWith(snapshotId, {
            visits: [
                { stage: ntpStageId, enteredAt: first },
                { stage: deliveryStageId, enteredAt: first },
                { stage: ntpStageId, enteredAt: second },
                { stage: ntpStageId, enteredAt: undone, undone: true },
            ],
        })

        const { data } = await deadlines("outsider", [sor])
        expect(new Date(data[0].due_at).getTime()).toBe(new Date(second).getTime() + 15 * DAY)
    })

    it("returns nothing for a snapshot with no deadline condition, or an SOR that never reached the stage", async () => {
        const none = await sorWith(noDeadlineSnapshotId, { visits: [{ stage: ntpStageId, enteredAt: new Date().toISOString() }] })
        const early = await sorWith(snapshotId, { visits: [{ stage: deliveryStageId, enteredAt: new Date().toISOString() }] })

        const { data, error } = await deadlines("outsider", [none, early])
        if (error) throw error
        expect(data).toEqual([])
    })

    it("hides an SOR from someone with no access to it, and from nobody who has Purchasing access", async () => {
        const sor = await sorWith(snapshotId, { visits: [{ stage: ntpStageId, enteredAt: new Date().toISOString() }] })

        expect((await deadlines("ordinary", [sor])).data).toEqual([])
        expect((await deadlines("outsider", [sor])).data).toHaveLength(1)
        expect((await deadlines("dealOwner", [sor])).data).toHaveLength(1)
    })
})
