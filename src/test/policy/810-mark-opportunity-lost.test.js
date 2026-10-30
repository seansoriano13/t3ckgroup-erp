/**
 * Issue #810 (parent #799, ADR 0049) — Mark as Lost on a Flow Canvas deal.
 *
 * `mark_opportunity_lost` is the only way to lose a deal. Every assertion runs
 * as a signed-in cast member; the service role only seeds the flow and reads
 * back what the function wrote.
 *
 * The flow: Lead -> Quoting -> Won, plus two Lost Stages (one flow variant with
 * one, one with two), a Closed Won terminal, and a "BG CHECKING"-style terminal
 * with no outcome. Quoting carries a required Stage Field and an unmet Stage
 * Condition in the Flow Snapshot; a normal move would be blocked by them.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const sorIds = []
const flows = [] // { saleTypeId, flowId }

async function ok(promise, what) {
    const { data, error } = await promise
    if (error) throw new Error(`Seeding ${what}: ${error.message}`)
    return data
}

/**
 * Builds a flow and its Flow Snapshot. `lostCount` Lost Stages (0, 1 or 2).
 * Returns the stage ids by name.
 */
async function buildFlow(label, lostCount) {
    const saleType = await ok(svc().from("sale_types").insert({ name: `${MARKER} ${label}` }).select("id").single(), "Sale Type")
    const flow = await ok(svc().from("sales_flows").insert({ sale_type_id: saleType.id }).select("id").single(), "flow")
    flows.push({ saleTypeId: saleType.id, flowId: flow.id })

    const defs = [
        { key: "lead", name: "Lead" },
        { key: "quoting", name: "Quoting" },
        { key: "won", name: "Won" },
        { key: "closedWon", name: "Closed Won", is_terminal: true, terminal_outcome: "won" },
        { key: "bg", name: "BG CHECKING", is_terminal: true },
    ]
    for (let i = 1; i <= lostCount; i++) {
        defs.push({ key: `lost${i}`, name: i === 1 ? "Closed Lost" : "Dropped", is_terminal: true, terminal_outcome: "lost" })
    }
    const stages = {}
    const snapshotStages = []
    let order = 10
    for (const def of defs) {
        const row = await ok(
            svc()
                .from("flow_stages")
                .insert({ flow_id: flow.id, name: `${MARKER} ${def.name}`, sort_order: order, is_terminal: def.is_terminal ?? false, terminal_outcome: def.terminal_outcome ?? null })
                .select("id, name, is_terminal, terminal_outcome")
                .single(),
            def.name,
        )
        order += 10
        stages[def.key] = row.id
        snapshotStages.push({ id: row.id, name: row.name, is_terminal: row.is_terminal, terminal_outcome: row.terminal_outcome })
    }
    const snapshot = await ok(
        svc()
            .from("flow_snapshots")
            .insert({
                flow_id: flow.id,
                version: 1,
                snapshot_data: {
                    stages: snapshotStages,
                    edges: [
                        { from_stage_id: stages.lead, to_stage_id: stages.quoting },
                        { from_stage_id: stages.quoting, to_stage_id: stages.won },
                    ],
                    wonStageId: stages.won,
                    // Quoting needs a field and a condition a normal move would insist on.
                    stageFields: [{ stage_id: stages.quoting, label: "Bid deadline", required: true }],
                    conditions: [{ stage_id: stages.quoting, kind: "tickbox", label: "Quote approved" }],
                },
                created_by: ids.dealOwner,
            })
            .select("id")
            .single(),
        "Flow Snapshot",
    )
    return { saleTypeId: saleType.id, stages, snapshotId: snapshot.id }
}

let oneLost
let twoLost
let noLost

beforeAll(async () => {
    await ensureCastLoaded()
    oneLost = await buildFlow("One Lost", 1)
    twoLost = await buildFlow("Two Lost", 2)
    noLost = await buildFlow("No Lost", 0)
})

afterAll(async () => {
    const s = svc()
    for (const id of sorIds) {
        const { data: reqs } = await s.from("purchase_requests").select("id").eq("opportunity_id", id)
        for (const r of reqs ?? []) {
            await s.from("purchase_request_messages").delete().eq("request_id", r.id)
            await s.from("purchase_request_items").delete().eq("request_id", r.id)
            await s.from("purchase_requests").delete().eq("id", r.id)
        }
    }
    await s.from("sales_opportunity_logs").delete().in("opportunity_id", sorIds)
    await s.from("sales_opportunities").delete().in("id", sorIds)
    for (const { flowId, saleTypeId } of flows) {
        await s.from("flow_snapshots").delete().eq("flow_id", flowId)
        await s.from("flow_stages").delete().eq("flow_id", flowId)
        await s.from("sales_flows").delete().eq("id", flowId)
        await s.from("sale_types").delete().eq("id", saleTypeId)
    }
})

async function dealOn(flow, stageKey) {
    const id = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        closingSalesId: ids.closingSales,
        saleTypeId: flow.saleTypeId,
        flowStageId: flow.stages[stageKey],
    })
    sorIds.push(id)
    await ok(svc().from("sales_opportunities").update({ flow_snapshot_id: flow.snapshotId }).eq("id", id), "snapshot link")
    return id
}

async function lose(who, sorId, code, note, lostStageId) {
    const client = await clientFor(who)
    return client.rpc("mark_opportunity_lost", {
        p_opportunity_id: sorId,
        p_reason_code: code,
        p_note: note,
        ...(lostStageId ? { p_lost_stage_id: lostStageId } : {}),
    })
}

async function row(sorId) {
    return ok(
        svc().from("sales_opportunities").select("flow_stage_id, lost_reason_code, lost_reason, lost_from_flow_stage_id").eq("id", sorId).single(),
        "deal row",
    )
}

describe("Mark as Lost, from a middle Stage", () => {
    it("moves to the Lost Stage despite an unmet condition and a required Stage Field, and records where it came from", async () => {
        const sor = await dealOn(oneLost, "quoting")
        const { error } = await lose("dealOwner", sor, "PRICE_TOO_HIGH", "Quoted 20% over")
        expect(error).toBeNull()
        expect(await row(sor)).toEqual({
            flow_stage_id: oneLost.stages.lost1,
            lost_reason_code: "PRICE_TOO_HIGH",
            lost_reason: "Quoted 20% over",
            lost_from_flow_stage_id: oneLost.stages.quoting,
        })
    })

    it("closes the Stage Visit it left and opens one on the Lost Stage", async () => {
        const sor = await dealOn(oneLost, "quoting")
        expect((await lose("dealOwner", sor, "NO_RESPONSE", null)).error).toBeNull()
        const { data: visits } = await svc().from("sor_stage_visits").select("flow_stage_id, left_at, left_by").eq("opportunity_id", sor).order("sequence")
        expect(visits).toHaveLength(2)
        expect(visits[0].flow_stage_id).toBe(oneLost.stages.quoting)
        expect(visits[0].left_at).not.toBeNull()
        expect(visits[0].left_by).toBe(ids.dealOwner)
        expect(visits[1].flow_stage_id).toBe(oneLost.stages.lost1)
        expect(visits[1].left_at).toBeNull()
    })

    it("writes history with who, when, reason and note", async () => {
        const sor = await dealOn(oneLost, "lead")
        expect((await lose("dealOwner", sor, "LOST_TO_COMPETITOR", "Went with Acme")).error).toBeNull()
        const { data: logs } = await svc().from("sales_opportunity_logs").select("author_id, created_at, content, metadata").eq("opportunity_id", sor).eq("metadata->>event", "MARKED_LOST")
        expect(logs).toHaveLength(1)
        expect(logs[0].author_id).toBe(ids.dealOwner)
        expect(logs[0].created_at).toBeTruthy()
        expect(logs[0].content).toBe("Deal marked Lost: Lost to competitor — Went with Acme")
        expect(logs[0].metadata).toMatchObject({ reasonCode: "LOST_TO_COMPETITOR", note: "Went with Acme", from: oneLost.stages.lead, to: oneLost.stages.lost1 })
    })

    it("trims the note and keeps none as null", async () => {
        const sor = await dealOn(oneLost, "lead")
        expect((await lose("dealOwner", sor, "NO_BUDGET", "   ")).error).toBeNull()
        expect((await row(sor)).lost_reason).toBeNull()
    })
})

describe("Mark as Lost refuses bad input in the database", () => {
    it.each([
        ["an empty reason", "", null, /pick a reason/i],
        ["a blank reason", "   ", null, /pick a reason/i],
        ["an unknown reason", "BORED", null, /not a reason on the list/i],
        ["Other without a note", "OTHER", null, /say what happened/i],
        ["Other with a blank note", "OTHER", "  ", /say what happened/i],
    ])("refuses %s and leaves the deal where it was", async (_label, code, note, message) => {
        const sor = await dealOn(oneLost, "quoting")
        const { error } = await lose("dealOwner", sor, code, note)
        expect(error?.message).toMatch(message)
        expect(await row(sor)).toMatchObject({ flow_stage_id: oneLost.stages.quoting, lost_reason_code: null })
    })

    it("accepts Other with a note", async () => {
        const sor = await dealOn(oneLost, "quoting")
        expect((await lose("dealOwner", sor, "OTHER", "Client merged")).error).toBeNull()
        expect(await row(sor)).toMatchObject({ lost_reason_code: "OTHER", lost_reason: "Client merged" })
    })

    it("refuses a deal that is already closed (Lost, Closed Won, or any terminal)", async () => {
        const lost = await dealOn(oneLost, "lost1")
        const won = await dealOn(oneLost, "closedWon")
        const bg = await dealOn(oneLost, "bg")
        for (const sor of [lost, won, bg]) {
            expect((await lose("dealOwner", sor, "NO_RESPONSE", null)).error?.message).toMatch(/already closed/i)
        }
    })
})

describe("Mark as Lost and the flow's Lost Stages", () => {
    it("refuses on a flow with no Lost Stage, with the message, and the BG CHECKING-style terminal is not a Lost Stage", async () => {
        const sor = await dealOn(noLost, "quoting")
        const { error } = await lose("dealOwner", sor, "NO_RESPONSE", null)
        expect(error?.message).toBe("This flow has no Lost Stage. Add one in Flow Canvas.")
        expect((await row(sor)).flow_stage_id).toBe(noLost.stages.quoting)
    })

    it("asks which one when the flow has two, and moves to the one picked", async () => {
        const sor = await dealOn(twoLost, "quoting")
        const refused = await lose("dealOwner", sor, "NO_RESPONSE", null)
        expect(refused.error?.message).toMatch(/more than one Lost Stage/i)
        expect((await row(sor)).flow_stage_id).toBe(twoLost.stages.quoting)

        expect((await lose("dealOwner", sor, "NO_RESPONSE", null, twoLost.stages.lost2)).error).toBeNull()
        expect((await row(sor)).flow_stage_id).toBe(twoLost.stages.lost2)
    })

    it("refuses a Stage picked that is not a Lost Stage", async () => {
        const sor = await dealOn(twoLost, "quoting")
        for (const bad of [twoLost.stages.won, twoLost.stages.closedWon, twoLost.stages.bg, oneLost.stages.lost1]) {
            expect((await lose("dealOwner", sor, "NO_RESPONSE", null, bad)).error?.message).toMatch(/not a Lost Stage/i)
        }
        expect((await row(sor)).flow_stage_id).toBe(twoLost.stages.quoting)
    })
})

describe("Mark as Lost permission", () => {
    it.each(["outsider", "ordinary"])("refuses %s, who cannot move this deal's Stage", async (who) => {
        const sor = await dealOn(oneLost, "quoting")
        const { error } = await lose(who, sor, "NO_RESPONSE", null)
        expect(error).not.toBeNull()
        expect(await row(sor)).toMatchObject({ flow_stage_id: oneLost.stages.quoting, lost_reason_code: null })
    })

    it("refuses a signed-out caller", async () => {
        const { anonymousClient } = await import("./support/cast.js")
        const { error } = await anonymousClient().rpc("mark_opportunity_lost", {
            p_opportunity_id: await dealOn(oneLost, "quoting"),
            p_reason_code: "NO_RESPONSE",
        })
        expect(error).not.toBeNull()
    })

    it("lets a Super Admin do it", async () => {
        const sor = await dealOn(oneLost, "quoting")
        expect((await lose("superAdmin", sor, "NO_RESPONSE", null)).error).toBeNull()
    })
})

describe("Mark as Lost and the Purchase Request chat", () => {
    it("posts 'Deal marked Lost: <reason>' in the chat and cancels nothing", async () => {
        const sor = await dealOn(oneLost, "quoting")
        const request = await ok(svc().from("purchase_requests").insert({ opportunity_id: sor, created_by: ids.dealOwner }).select("id").single(), "request")
        const item = await ok(
            svc()
                .from("purchase_request_items")
                .insert({ request_id: request.id, source: "new", name: "Hose", quantity: 2, status: "to_purchase", requested_by: ids.dealOwner })
                .select("id")
                .single(),
            "item",
        )

        expect((await lose("dealOwner", sor, "CLIENT_CANCELLED", null)).error).toBeNull()

        const { data: messages } = await svc().from("purchase_request_messages").select("author_id, content, metadata").eq("request_id", request.id)
        expect(messages).toHaveLength(1)
        expect(messages[0].content).toBe("Deal marked Lost: Client cancelled the project")
        expect(messages[0].author_id).toBe(ids.dealOwner)

        const { data: after } = await svc().from("purchase_request_items").select("status").eq("id", item.id).single()
        expect(after.status).toBe("to_purchase")
    })

    it("works when there is no Purchase Request", async () => {
        const sor = await dealOn(oneLost, "lead")
        expect((await lose("dealOwner", sor, "NO_RESPONSE", null)).error).toBeNull()
    })
})

/**
 * Issue #812 — the same function on an old-pipeline deal (status codes, no
 * Flow Stage). The local pipeline may hold only LEAD, so the test adds the
 * statuses it needs (a middle one, a Won and a Lost) and removes what it added.
 */
describe("Mark as Lost on an old-pipeline deal", () => {
    const added = []
    let midCode
    let wonCode
    let lostCode

    async function ensureStatus(code, flags, sortOrder) {
        const col = flags.is_won ? "is_won" : flags.is_lost ? "is_lost" : null
        if (col) {
            const { data } = await svc().from("crm_pipeline_stages").select("code").eq(col, true).maybeSingle()
            if (data) return data.code
        }
        await ok(svc().from("crm_pipeline_stages").insert({ code, label: code, sort_order: sortOrder, ...flags }), `status ${code}`)
        added.push(code)
        return code
    }

    beforeAll(async () => {
        midCode = await ensureStatus("T812_MID", {}, 900)
        wonCode = await ensureStatus("T812_WON", { is_won: true }, 910)
        lostCode = await ensureStatus("T812_LOST", { is_lost: true }, 920)
    })

    afterAll(async () => {
        await svc().from("sales_opportunities").update({ lost_from_status: null }).in("id", sorIds)
        await svc().from("sales_opportunities").delete().in("id", sorIds)
        if (added.length) await svc().from("crm_pipeline_stages").delete().in("code", added)
    })

    async function oldDeal(status, salesReference = null) {
        const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, closingSalesId: ids.closingSales })
        sorIds.push(id)
        // LEAD may be set without a Sales Reference; leaving LEAD needs one, except to Lost.
        if (salesReference) await ok(svc().from("sales_opportunities").update({ sales_reference: salesReference }).eq("id", id), "reference")
        if (status !== "LEAD") await ok(svc().from("sales_opportunities").update({ status }).eq("id", id), "status")
        return id
    }

    const oldRow = (sorId) =>
        ok(svc().from("sales_opportunities").select("status, flow_stage_id, lost_reason_code, lost_reason, lost_from_status, lost_from_flow_stage_id, sales_reference").eq("id", sorId).single(), "deal row")

    it("moves to the Lost status and records the status it came from", async () => {
        const sor = await oldDeal(midCode, "S81200")
        const { error } = await lose("dealOwner", sor, "PRICE_TOO_HIGH", "Quoted 20% over")
        expect(error).toBeNull()
        expect(await oldRow(sor)).toMatchObject({
            status: lostCode,
            flow_stage_id: null,
            lost_reason_code: "PRICE_TOO_HIGH",
            lost_reason: "Quoted 20% over",
            lost_from_status: midCode,
            lost_from_flow_stage_id: null,
        })
    })

    it("loses a deal with no Sales Reference (the Lost exemption)", async () => {
        const sor = await oldDeal("LEAD")
        expect((await oldRow(sor)).sales_reference).toBeNull()
        const { error } = await lose("dealOwner", sor, "NO_RESPONSE", null)
        expect(error).toBeNull()
        expect(await oldRow(sor)).toMatchObject({ status: lostCode, lost_from_status: "LEAD", sales_reference: null })
    })

    it("writes the same history and posts the same chat message as the Flow Canvas case", async () => {
        const sor = await oldDeal(midCode, "S81201")
        const request = await ok(svc().from("purchase_requests").insert({ opportunity_id: sor, created_by: ids.dealOwner }).select("id").single(), "request")
        expect((await lose("dealOwner", sor, "LOST_TO_COMPETITOR", "Went with Acme")).error).toBeNull()

        const { data: logs } = await svc().from("sales_opportunity_logs").select("author_id, content, metadata").eq("opportunity_id", sor).eq("metadata->>event", "MARKED_LOST")
        expect(logs).toHaveLength(1)
        expect(logs[0].author_id).toBe(ids.dealOwner)
        expect(logs[0].content).toBe("Deal marked Lost: Lost to competitor — Went with Acme")
        expect(logs[0].metadata).toMatchObject({ reasonCode: "LOST_TO_COMPETITOR", note: "Went with Acme", from: midCode, to: lostCode })

        const { data: messages } = await svc().from("purchase_request_messages").select("content, metadata").eq("request_id", request.id)
        expect(messages).toHaveLength(1)
        expect(messages[0].content).toBe("Deal marked Lost: Lost to competitor — Went with Acme")
        expect(messages[0].metadata).toMatchObject({ event: "deal_marked_lost" })
        await svc().from("purchase_request_messages").delete().eq("request_id", request.id)
        await svc().from("purchase_requests").delete().eq("id", request.id)
    })

    it.each([
        ["an empty reason", "", null, /pick a reason/i],
        ["an unknown reason", "BORED", null, /not a reason on the list/i],
        ["Other without a note", "OTHER", "  ", /say what happened/i],
    ])("refuses %s and leaves the deal where it was", async (_label, code, note, message) => {
        const sor = await oldDeal(midCode, "S81202")
        const { error } = await lose("dealOwner", sor, code, note)
        expect(error?.message).toMatch(message)
        expect(await oldRow(sor)).toMatchObject({ status: midCode, lost_reason_code: null, lost_from_status: null })
    })

    it("refuses a deal already at the Won or Lost status", async () => {
        for (const status of [wonCode, lostCode]) {
            const sor = await oldDeal(status, "S81203")
            expect((await lose("dealOwner", sor, "NO_RESPONSE", null)).error?.message).toMatch(/already closed/i)
            expect((await oldRow(sor)).status).toBe(status)
        }
    })

    it.each(["outsider", "ordinary"])("refuses %s, who cannot move this deal", async (who) => {
        const sor = await oldDeal(midCode, "S81204")
        const { error } = await lose(who, sor, "NO_RESPONSE", null)
        expect(error).not.toBeNull()
        expect(await oldRow(sor)).toMatchObject({ status: midCode, lost_reason_code: null })
    })

    it("lets a Super Admin do it", async () => {
        const sor = await oldDeal(midCode, "S81205")
        expect((await lose("superAdmin", sor, "NO_RESPONSE", null)).error).toBeNull()
    })
})
