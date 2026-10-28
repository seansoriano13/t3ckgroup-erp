/**
 * Buying opens here, with Order early (#724, 20261113060000_724_buying_opens_here.sql).
 *
 * Operations flags at most one Stage per flow. The flag is read from the Flow Snapshot the SOR
 * is pinned to. Attaching a P0 to a project line before the SOR has entered that Stage is refused
 * (22023) unless it is sent with Order early and a non-blank reason; the reason is stored on the
 * line, written to the request history and sent to the Deal Owner. A version with no flagged
 * Stage, and a Direct request (no SOR), are not gated.
 *
 * `stageParticipant` is the Buyer (given Purchasing access here); `dealOwner` is the SOR's Deal Owner.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, ensureCastLoaded, castEmail } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const FACTS = { state: "confirmed", ordered: 10, received: 0, bought_as: "Harness" }
const created = { requests: [], sors: [], flows: [], saleTypes: [] }

async function one(query, what) {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

/** A flow with a "Lead" and a "Award" Stage and one published version, flagged at Award or not. */
async function seedFlow(label, { flagged }) {
    const saleTypeId = (await one(svc().from("sale_types").insert({ name: `${MARKER} ${label}` }).select("id").single(), "Sale Type")).id
    created.saleTypes.push(saleTypeId)
    const flowId = (await one(svc().from("sales_flows").insert({ sale_type_id: saleTypeId, state: "draft" }).select("id").single(), "Flow")).id
    created.flows.push(flowId)
    const stages = await one(
        svc()
            .from("flow_stages")
            .insert([
                { flow_id: flowId, name: `${MARKER} Lead`, sort_order: 0 },
                { flow_id: flowId, name: `${MARKER} Award`, sort_order: 1, buying_opens_here: flagged },
            ])
            .select("*"),
        "Stages",
    )
    const [lead, award] = stages.sort((a, b) => a.sort_order - b.sort_order)
    const snapshotId = (
        await one(
            svc().from("flow_snapshots").insert({ flow_id: flowId, version: 1, snapshot_data: { stages, edges: [] } }).select("id").single(),
            "Snapshot",
        )
    ).id
    return { flowId, lead, award, snapshotId }
}

/** An SOR pinned to the version, a project request with a Buyer, and a line. */
async function seedLine(flow) {
    const sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId: null })
    created.sors.push(sorId)
    await one(svc().from("sales_opportunities").update({ flow_snapshot_id: flow.snapshotId }).eq("id", sorId), "Pinning the SOR")
    await one(svc().from("sor_stage_visits").insert({ opportunity_id: sorId, flow_stage_id: flow.lead.id, flow_snapshot_id: flow.snapshotId, sequence: 1 }), "Lead visit")
    const requestId = await seedRequest({ opportunity_id: sorId })
    return { sorId, requestId, itemId: await seedItem(requestId) }
}

async function seedRequest(extra) {
    const id = (
        await one(
            svc().from("purchase_requests").insert({ created_by: ids.dealOwner, buyer_id: ids.stageParticipant, ...extra }).select("id").single(),
            "Request",
        )
    ).id
    created.requests.push(id)
    for (const [employee, side] of [["dealOwner", "sales"], ["stageParticipant", "purchasing"]]) {
        await one(svc().from("purchase_request_members").insert({ request_id: id, employee_id: ids[employee], side }), "Member")
    }
    return id
}

const seedItem = async (requestId) =>
    (
        await one(
            svc()
                .from("purchase_request_items")
                .insert({ request_id: requestId, source: "new", name: `${MARKER} Harness`, unit: "pc", quantity: 10, status: "to_purchase", requested_by: ids.dealOwner })
                .select("id")
                .single(),
            "Item",
        )
    ).id

const attach = (itemId, args = {}) =>
    svc().rpc("purchase_request_item_attach_po", {
        p_actor_email: castEmail("stageParticipant"),
        p_item_id: itemId,
        p_po_number: "P01234",
        p_facts: FACTS,
        ...args,
    })

const itemRow = async (id) => (await one(svc().from("purchase_request_items").select("*").eq("id", id).single(), "Reading the item"))

let flagged, unflagged

beforeAll(async () => {
    await ensureCastLoaded()
    await one(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.stageParticipant), "Purchasing access")
    flagged = await seedFlow("Flagged", { flagged: true })
    unflagged = await seedFlow("Unflagged", { flagged: false })
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.stageParticipant)
    if (created.requests.length) {
        await svc().from("notifications").delete().in("reference_id", created.requests)
        await svc().from("purchase_requests").delete().in("id", created.requests)
    }
    if (created.sors.length) await svc().from("sales_opportunities").delete().in("id", created.sors)
    if (created.flows.length) {
        await svc().from("flow_snapshots").delete().in("flow_id", created.flows)
        await svc().from("flow_stages").delete().in("flow_id", created.flows)
        await svc().from("sales_flows").delete().in("id", created.flows)
    }
    if (created.saleTypes.length) await svc().from("sale_types").delete().in("id", created.saleTypes)
})

describe("the flag", () => {
    it("allows one flagged Stage per flow", async () => {
        const { error } = await svc().from("flow_stages").update({ buying_opens_here: true }).eq("id", flagged.lead.id)
        expect(error?.code).toBe("23505")
        await svc().from("flow_stages").update({ buying_opens_here: false }).eq("id", flagged.lead.id)
    })
})

describe("before the SOR has entered the flagged Stage", () => {
    it("refuses an attach with no Order early, and changes nothing", async () => {
        const { itemId } = await seedLine(flagged)
        const { error } = await attach(itemId)
        expect(error?.code).toBe("22023")
        expect(error?.message).toMatch(/buying opens at/i)
        expect(await itemRow(itemId)).toMatchObject({ status: "to_purchase", po_number: null, ordered_early_reason: null })
    })

    it.each([null, "", "   "])("refuses Order early with the reason %j", async (reason) => {
        const { itemId } = await seedLine(flagged)
        const { error } = await attach(itemId, { p_order_early: true, p_order_early_reason: reason })
        expect(error?.code).toBe("22023")
        expect(error?.message).toMatch(/needs a reason/i)
        expect((await itemRow(itemId)).po_number).toBeNull()
    })

    it("attaches with Order early and a reason: stored on the line, written to history, sent to the Deal Owner", async () => {
        const { itemId, requestId } = await seedLine(flagged)
        const { data, error } = await attach(itemId, { p_order_early: true, p_order_early_reason: "  Supplier price ends Friday  " })
        expect(error).toBeNull()
        expect(data).toMatchObject({ status: "purchased", po_number: "P01234", ordered_early_reason: "Supplier price ends Friday" })

        const { data: events } = await svc().from("purchase_request_messages").select("content, metadata").eq("request_id", requestId)
        const event = events.find((e) => e.metadata?.event === "item_po_attached")
        expect(event.content).toMatch(/Ordered early: Supplier price ends Friday/)
        expect(event.metadata).toMatchObject({ ordered_early: true, ordered_early_reason: "Supplier price ends Friday" })

        const { data: notes } = await svc().from("notifications").select("recipient_id, sender_id, message").eq("reference_id", requestId).eq("type", "PURCHASE_REQUEST_ORDERED_EARLY")
        expect(notes).toHaveLength(1)
        expect(notes[0]).toMatchObject({ recipient_id: ids.dealOwner, sender_id: ids.stageParticipant })
        expect(notes[0].message).toMatch(/Supplier price ends Friday/)
    })
})

describe("once the SOR has entered the flagged Stage", () => {
    it("attaches with no reason, and an unneeded reason is not recorded as Ordered early", async () => {
        const { sorId, itemId, requestId } = await seedLine(flagged)
        await one(svc().from("sor_stage_visits").insert({ opportunity_id: sorId, flow_stage_id: flagged.award.id, flow_snapshot_id: flagged.snapshotId, sequence: 2 }), "Award visit")
        const { data, error } = await attach(itemId, { p_order_early: true, p_order_early_reason: "not needed" })
        expect(error).toBeNull()
        expect(data).toMatchObject({ po_number: "P01234", ordered_early_reason: null })
        const { data: notes } = await svc().from("notifications").select("id").eq("reference_id", requestId).eq("type", "PURCHASE_REQUEST_ORDERED_EARLY")
        expect(notes).toHaveLength(0)
    })
})

describe("not gated", () => {
    it("a version with no flagged Stage", async () => {
        const { itemId } = await seedLine(unflagged)
        const { data, error } = await attach(itemId)
        expect(error).toBeNull()
        expect(data).toMatchObject({ po_number: "P01234", ordered_early_reason: null })
    })

    it("a Direct request (no SOR)", async () => {
        const requestId = await seedRequest({ title: `${MARKER} Office supplies` })
        const itemId = await seedItem(requestId)
        const { data, error } = await attach(itemId)
        expect(error).toBeNull()
        expect(data).toMatchObject({ po_number: "P01234", ordered_early_reason: null })
    })
})

describe("the existing rules still hold", () => {
    it("only Purchasing attaches", async () => {
        const { itemId } = await seedLine(flagged)
        const { error } = await svc().rpc("purchase_request_item_attach_po", {
            p_actor_email: castEmail("dealOwner"),
            p_item_id: itemId,
            p_po_number: "P01234",
            p_facts: FACTS,
            p_order_early: true,
            p_order_early_reason: "because",
        })
        expect(error?.code).toBe("42501")
    })
})
