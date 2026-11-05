/**
 * Buyer access at the buying Stage (#883, spec #907 decision 4, migration
 * 20261121160000_883_buyer_access_at_buying_stage.sql).
 *
 * The Purchase Request's purchasing window is opened at the Lead Stage ("Only
 * this Stage"). Before the fix, a later run of the Open Purchase Request action
 * (at NTP, where buying opens) reused the request and opened nothing, so the
 * Buyer kept only the quick view. Two rules now hold:
 *   - a run that reuses the request re-raises the window for the request's
 *     purchasing members, on the run's visit and with the action's rule;
 *   - while a request has an open line, its Buyer and the SOR's Purchasing
 *     Incharge get the header (participant) and see the current Stage Visit.
 *
 * `stageParticipant` is the purchasing member and the Buyer (given Purchasing
 * access here only). `dealOwner` is the sales side. `ordinary` is unrelated.
 * Reads go through the caller's own token, so a pass is the policy's doing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const DECOY = { buyer_id: null, extra_member_ids: [], left_out_roles: ["deal_owner"], access_until: "terminal" }
const employee = (id) => ({ type: "employee", id })

let saleTypeId, flowId, leadId, buyingId, leadActionId, buyingActionId
let snapshotVersion = 8830
const sorIds = []

async function one(query, what) {
    const { data, error } = await query.select("id").single()
    if (error) throw new Error(`${what}: ${error.message}`)
    return data.id
}

async function rpc(who, name, args) {
    return (await clientFor(who)).rpc(name, args)
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.stageParticipant)
    if (flag.error) throw flag.error

    saleTypeId = await one(svc().from("sale_types").insert({ name: `${MARKER} Buyer Access` }), "sale type")
    flowId = await one(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }), "flow")
    leadId = await one(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Lead`, sort_order: 10 }), "lead stage")
    buyingId = await one(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} NTP`, sort_order: 20 }), "NTP stage")
    leadActionId = await one(svc().from("flow_stage_actions").insert({ stage_id: leadId, kind: "open_purchase_request" }), "lead action")
    buyingActionId = await one(svc().from("flow_stage_actions").insert({ stage_id: buyingId, kind: "open_purchase_request" }), "NTP action")
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.stageParticipant)
    await svc().from("costing_matrices").delete().in("opportunity_id", sorIds)
    await svc().from("purchase_requests").delete().in("opportunity_id", sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sor_action_runs").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_snapshots").delete().eq("flow_id", flowId)
    await svc().from("flow_stage_actions").delete().in("id", [leadActionId, buyingActionId])
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

/**
 * An SOR on the Lead Stage, pinned to a snapshot that saves the Buyer on both
 * actions. The Lead action keeps the default rule (until the Stage is left).
 */
async function freshSor() {
    const id = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        supportSales1Id: ids.support,
        salesDirectorId: ids.head,
        saleTypeId,
        flowStageId: leadId,
    })
    sorIds.push(id)

    snapshotVersion += 1
    const config = { buyer: employee(ids.stageParticipant) }
    const snapshotId = await one(
        svc().from("flow_snapshots").insert({
            flow_id: flowId,
            version: snapshotVersion,
            snapshot_data: {
                actions: [
                    { id: leadActionId, stage_id: leadId, kind: "open_purchase_request", config },
                    { id: buyingActionId, stage_id: buyingId, kind: "open_purchase_request", config },
                ],
            },
        }),
        "snapshot",
    )
    const pinned = await svc().from("sales_opportunities").update({ flow_snapshot_id: snapshotId }).eq("id", id)
    if (pinned.error) throw new Error(pinned.error.message)
    const visit = await svc().from("sor_stage_visits").update({ flow_snapshot_id: snapshotId }).eq("opportunity_id", id)
    if (visit.error) throw new Error(visit.error.message)
    return id
}

async function visitsOf(sorId) {
    const { data, error } = await svc()
        .from("sor_stage_visits")
        .select("id, flow_stage_id, sequence, left_at")
        .eq("opportunity_id", sorId)
        .order("sequence", { ascending: true })
    if (error) throw new Error(error.message)
    return data
}

async function currentVisitOf(sorId) {
    return (await visitsOf(sorId)).at(-1).id
}

/** Run one action as the Deal Owner, the way a Stage move does. */
async function run(sorId, { stageId, actionId, visitId }) {
    const { data, error } = await (await clientFor("dealOwner")).rpc("sor_run_stage_actions", {
        p_opportunity_id: sorId,
        p_stage_id: stageId,
        p_stage_visit_id: visitId,
        p_actions: [
            {
                action_id: actionId,
                kind: "open_purchase_request",
                name: "Open Purchase Request",
                confirm: false,
                purchase_request: DECOY,
            },
        ],
    })
    if (error) throw new Error(error.message)
    return data
}

async function requestOf(sorId) {
    const { data, error } = await svc().from("purchase_requests").select("id, buyer_id").eq("opportunity_id", sorId)
    if (error) throw new Error(error.message)
    return data
}

async function openWindowsOf(sorId, employeeId) {
    const { data, error } = await svc()
        .from("sor_stage_participants")
        .select("id, source, opened_visit_id, until_rule")
        .eq("opportunity_id", sorId)
        .eq("employee_id", employeeId)
        .is("closed_at", null)
    if (error) throw new Error(error.message)
    return data
}

async function addOpenLine(requestId, status = "to_purchase") {
    return one(
        svc()
            .from("purchase_request_items")
            .insert({ request_id: requestId, source: "new", name: `${MARKER} Buyer line`, unit: "pc", quantity: 1, status, requested_by: ids.dealOwner }),
        "item",
    )
}

describe("Lead-only window, then the NTP re-raise", () => {
    let sorId, leadVisitId, buyingVisitId

    beforeAll(async () => {
        sorId = await freshSor()
        leadVisitId = await currentVisitOf(sorId)
        await run(sorId, { stageId: leadId, actionId: leadActionId, visitId: leadVisitId })

        const moved = await svc().from("sales_opportunities").update({ flow_stage_id: buyingId }).eq("id", sorId)
        if (moved.error) throw new Error(moved.error.message)
        buyingVisitId = await currentVisitOf(sorId)
    })

    it("the Lead window closes on the move to NTP, so the Buyer has no open window", async () => {
        expect(await openWindowsOf(sorId, ids.stageParticipant)).toHaveLength(0)
        const { data } = await rpc("stageParticipant", "sor_visible_visit_ids", { p_opportunity_id: sorId })
        expect(data).not.toContain(buyingVisitId)
    })

    it("the NTP run reuses the request and re-raises the Buyer's window on the NTP visit", async () => {
        const result = await run(sorId, { stageId: buyingId, actionId: buyingActionId, visitId: buyingVisitId })
        expect(result.failed).toEqual([])

        expect(await requestOf(sorId)).toHaveLength(1)
        const windows = await openWindowsOf(sorId, ids.stageParticipant)
        expect(windows).toHaveLength(1)
        expect(windows[0]).toMatchObject({ source: "purchase_request", opened_visit_id: buyingVisitId, until_rule: "stage_left" })
    })

    it("the Buyer now reads the NTP visit", async () => {
        const { data, error } = await rpc("stageParticipant", "sor_visible_visit_ids", { p_opportunity_id: sorId })
        expect(error).toBeNull()
        expect(data).toContain(buyingVisitId)
        expect(data).not.toContain(leadVisitId)
    })

    it("a second NTP run opens nothing new", async () => {
        await run(sorId, { stageId: buyingId, actionId: buyingActionId, visitId: buyingVisitId })
        expect(await openWindowsOf(sorId, ids.stageParticipant)).toHaveLength(1)
    })
})

describe("while the request has an open line", () => {
    let sorId, requestId

    beforeAll(async () => {
        sorId = await freshSor()
        const visitId = await currentVisitOf(sorId)
        await run(sorId, { stageId: leadId, actionId: leadActionId, visitId })
        requestId = (await requestOf(sorId))[0].id
    })

    // Every line below belongs to the request opened above.

    it("the Buyer has no header while every line is closed", async () => {
        await addOpenLine(requestId, "received")
        expect((await rpc("stageParticipant", "sor_access_level", { p_opportunity_id: sorId })).data).toBe("locked")
    })

    it("the Buyer gets the header and the current visit once a line is open", async () => {
        await addOpenLine(requestId, "to_purchase")
        const level = await rpc("stageParticipant", "sor_access_level", { p_opportunity_id: sorId })
        expect(level.data).toBe("participant")
        const visible = await rpc("stageParticipant", "sor_visible_visit_ids", { p_opportunity_id: sorId })
        expect(visible.data).toContain(await currentVisitOf(sorId))
    })

    it("an unrelated employee gets nothing from the rule", async () => {
        expect((await rpc("ordinary", "sor_access_level", { p_opportunity_id: sorId })).data).toBe("none")
    })

    it("the SOR's Purchasing Incharge gets the same access, and only once named", async () => {
        // Close every line first so the only way in is the Incharge rule.
        await svc().from("purchase_request_items").update({ status: "received" }).eq("request_id", requestId)
        expect((await rpc("warehouse", "sor_access_level", { p_opportunity_id: sorId })).data).toBe("none")

        const matrix = await one(svc().from("costing_matrices").insert({ opportunity_id: sorId }), "costing matrix")
        await svc().from("costing_matrices").update({ purchasing_incharge_id: ids.warehouse }).eq("id", matrix)
        await addOpenLine(requestId, "to_purchase")
        expect((await rpc("warehouse", "sor_access_level", { p_opportunity_id: sorId })).data).toBe("participant")
    })
})
