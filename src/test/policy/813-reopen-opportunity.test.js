/**
 * Issue #813 (parent #799, ADR 0049) — Reopen a Lost deal.
 *
 * `reopen_opportunity` is the only way out of a Lost Stage or status. Every
 * assertion runs as a signed-in cast member; the service role only seeds and
 * reads back. Deals are lost through `mark_opportunity_lost` so the
 * `lost_from_*` columns are the ones the real function wrote.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded, anonymousClient } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const sorIds = []
let flow
let saleTypeId
let flowId
const added = []

async function ok(promise, what) {
    const { data, error } = await promise
    if (error) throw new Error(`Seeding ${what}: ${error.message}`)
    return data
}

beforeAll(async () => {
    await ensureCastLoaded()
    const saleType = await ok(svc().from("sale_types").insert({ name: `${MARKER} Reopen` }).select("id").single(), "Sale Type")
    saleTypeId = saleType.id
    const f = await ok(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")
    flowId = f.id
    const defs = [
        { key: "lead", name: "Lead" },
        { key: "quoting", name: "Quoting" },
        { key: "won", name: "Won" },
        { key: "closedWon", name: "Closed Won", is_terminal: true, terminal_outcome: "won" },
        { key: "lost", name: "Closed Lost", is_terminal: true, terminal_outcome: "lost" },
    ]
    const stages = {}
    const snapshotStages = []
    let order = 10
    for (const def of defs) {
        const row = await ok(
            svc()
                .from("flow_stages")
                .insert({ flow_id: flowId, name: `${MARKER} ${def.name}`, sort_order: order, is_terminal: def.is_terminal ?? false, terminal_outcome: def.terminal_outcome ?? null })
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
                flow_id: flowId,
                version: 1,
                snapshot_data: {
                    stages: snapshotStages,
                    edges: [{ from_stage_id: stages.lead, to_stage_id: stages.quoting }],
                    wonStageId: stages.won,
                    // A required Stage Field and an unmet condition: Reopen must skip both.
                    stageFields: [{ stage_id: stages.quoting, label: "Bid deadline", required: true }],
                    conditions: [{ stage_id: stages.quoting, kind: "tickbox", label: "Quote approved" }],
                },
                created_by: ids.dealOwner,
            })
            .select("id")
            .single(),
        "Flow Snapshot",
    )
    flow = { stages, snapshotId: snapshot.id }
})

afterAll(async () => {
    const s = svc()
    for (const id of sorIds) {
        const { data: reqs } = await s.from("purchase_requests").select("id").eq("opportunity_id", id)
        for (const r of reqs ?? []) {
            await s.from("purchase_request_messages").delete().eq("request_id", r.id)
            await s.from("purchase_requests").delete().eq("id", r.id)
        }
    }
    await s.from("sales_opportunity_logs").delete().in("opportunity_id", sorIds)
    await s.from("sales_opportunities").update({ lost_from_status: null }).in("id", sorIds)
    await s.from("sales_opportunities").delete().in("id", sorIds)
    await s.from("flow_snapshots").delete().eq("flow_id", flowId)
    await s.from("flow_stages").delete().eq("flow_id", flowId)
    await s.from("sales_flows").delete().eq("id", flowId)
    await s.from("sale_types").delete().eq("id", saleTypeId)
    if (added.length) await s.from("crm_pipeline_stages").delete().in("code", added)
})

async function flowDeal(stageKey) {
    const id = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        closingSalesId: ids.closingSales,
        saleTypeId,
        flowStageId: flow.stages[stageKey],
    })
    sorIds.push(id)
    await ok(svc().from("sales_opportunities").update({ flow_snapshot_id: flow.snapshotId }).eq("id", id), "snapshot link")
    return id
}

const lose = async (who, sorId, code = "NO_RESPONSE", note = null) =>
    (await clientFor(who)).rpc("mark_opportunity_lost", { p_opportunity_id: sorId, p_reason_code: code, p_note: note })
const reopen = async (who, sorId) => (await clientFor(who)).rpc("reopen_opportunity", { p_opportunity_id: sorId })

const row = (sorId) =>
    ok(
        svc()
            .from("sales_opportunities")
            .select("status, flow_stage_id, lost_reason_code, lost_reason, lost_from_flow_stage_id, lost_from_status")
            .eq("id", sorId)
            .single(),
        "deal row",
    )

describe("Reopen on a Flow Canvas deal", () => {
    it("returns the deal to the exact Stage it was lost from, skipping Stage Fields and Conditions", async () => {
        const sor = await flowDeal("quoting")
        expect((await lose("dealOwner", sor, "PRICE_TOO_HIGH", "Quoted 20% over")).error).toBeNull()
        expect((await row(sor)).flow_stage_id).toBe(flow.stages.lost)

        const { error } = await reopen("dealOwner", sor)
        expect(error).toBeNull()
        expect(await row(sor)).toMatchObject({
            flow_stage_id: flow.stages.quoting,
            lost_reason_code: null,
            lost_reason: null,
            lost_from_flow_stage_id: null,
            lost_from_status: null,
        })
    })

    it("keeps the Lost history, logs REOPENED, and moves the Stage Visit back", async () => {
        const sor = await flowDeal("quoting")
        await lose("dealOwner", sor, "LOST_TO_COMPETITOR", "Went with Acme")
        expect((await reopen("dealOwner", sor)).error).toBeNull()

        const { data: lost } = await svc().from("sales_opportunity_logs").select("content, metadata").eq("opportunity_id", sor).eq("metadata->>event", "MARKED_LOST")
        expect(lost).toHaveLength(1)
        expect(lost[0].metadata).toMatchObject({ reasonCode: "LOST_TO_COMPETITOR", note: "Went with Acme" })

        const { data: reopened } = await svc().from("sales_opportunity_logs").select("author_id, content, metadata").eq("opportunity_id", sor).eq("metadata->>event", "REOPENED")
        expect(reopened).toHaveLength(1)
        expect(reopened[0].author_id).toBe(ids.dealOwner)
        expect(reopened[0].content).toBe("Deal reopened")
        expect(reopened[0].metadata).toMatchObject({ from: flow.stages.lost, to: flow.stages.quoting })

        const { data: visits } = await svc().from("sor_stage_visits").select("flow_stage_id, left_at").eq("opportunity_id", sor).order("sequence")
        expect(visits.at(-1).flow_stage_id).toBe(flow.stages.quoting)
        expect(visits.at(-1).left_at).toBeNull()
    })

    it("lets the deal be lost again, recording the second loss afresh", async () => {
        const sor = await flowDeal("lead")
        await lose("dealOwner", sor, "NO_BUDGET", null)
        await reopen("dealOwner", sor)
        expect((await lose("dealOwner", sor, "OTHER", "Client merged")).error).toBeNull()
        expect(await row(sor)).toMatchObject({
            flow_stage_id: flow.stages.lost,
            lost_reason_code: "OTHER",
            lost_reason: "Client merged",
            lost_from_flow_stage_id: flow.stages.lead,
        })
    })

    it("posts 'Deal reopened' in the Purchase Request chat", async () => {
        const sor = await flowDeal("quoting")
        const request = await ok(svc().from("purchase_requests").insert({ opportunity_id: sor, created_by: ids.dealOwner }).select("id").single(), "request")
        await lose("dealOwner", sor)
        expect((await reopen("dealOwner", sor)).error).toBeNull()
        const { data: messages } = await svc().from("purchase_request_messages").select("content, author_id").eq("request_id", request.id).order("created_at")
        expect(messages.map((m) => m.content).sort()).toEqual(["Deal marked Lost: No response from client", "Deal reopened"])
        expect(messages.find((m) => m.content === "Deal reopened").author_id).toBe(ids.dealOwner)
    })

    it("works when there is no Purchase Request", async () => {
        const sor = await flowDeal("lead")
        await lose("dealOwner", sor)
        expect((await reopen("dealOwner", sor)).error).toBeNull()
    })
})

describe("Reopen is refused on a deal that is not Lost", () => {
    it("refuses an open deal and leaves it where it was", async () => {
        const sor = await flowDeal("quoting")
        expect((await reopen("dealOwner", sor)).error?.message).toMatch(/not Lost/i)
        expect((await row(sor)).flow_stage_id).toBe(flow.stages.quoting)
    })

    it("refuses a Won terminal deal: it cannot be left", async () => {
        const sor = await flowDeal("closedWon")
        expect((await reopen("dealOwner", sor)).error?.message).toMatch(/not Lost/i)
        expect((await row(sor)).flow_stage_id).toBe(flow.stages.closedWon)
    })

    it("refuses a Lost deal with no record of where it was lost from", async () => {
        const sor = await flowDeal("lost")
        expect((await reopen("dealOwner", sor)).error?.message).toMatch(/no record/i)
        expect((await row(sor)).flow_stage_id).toBe(flow.stages.lost)
    })

    it("refuses a deal that does not exist", async () => {
        expect((await reopen("dealOwner", "00000000-0000-0000-0000-000000000000")).error?.message).toMatch(/could not be found/i)
    })
})

describe("Reopen permission", () => {
    it.each(["outsider", "ordinary"])("refuses %s, who cannot move this deal's Stage", async (who) => {
        const sor = await flowDeal("quoting")
        await lose("dealOwner", sor)
        expect((await reopen(who, sor)).error).not.toBeNull()
        expect((await row(sor)).flow_stage_id).toBe(flow.stages.lost)
    })

    it("refuses a signed-out caller", async () => {
        const sor = await flowDeal("quoting")
        await lose("dealOwner", sor)
        expect((await anonymousClient().rpc("reopen_opportunity", { p_opportunity_id: sor })).error).not.toBeNull()
    })

    it("lets a Super Admin do it", async () => {
        const sor = await flowDeal("quoting")
        await lose("dealOwner", sor)
        expect((await reopen("superAdmin", sor)).error).toBeNull()
    })
})

describe("Reopen on an old-pipeline deal", () => {
    let midCode
    let lostCode

    beforeAll(async () => {
        const find = async (col) => (await svc().from("crm_pipeline_stages").select("code").eq(col, true).maybeSingle()).data?.code
        lostCode = await find("is_lost")
        if (!lostCode) {
            lostCode = "T813_LOST"
            await ok(svc().from("crm_pipeline_stages").insert({ code: lostCode, label: lostCode, sort_order: 920, is_lost: true }), "Lost status")
            added.push(lostCode)
        }
        midCode = "T813_MID"
        await ok(svc().from("crm_pipeline_stages").insert({ code: midCode, label: midCode, sort_order: 900 }), "mid status")
        added.push(midCode)
    })

    async function oldDeal(status, salesReference = "S81300") {
        const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, closingSalesId: ids.closingSales })
        sorIds.push(id)
        await ok(svc().from("sales_opportunities").update({ sales_reference: salesReference }).eq("id", id), "reference")
        if (status !== "LEAD") await ok(svc().from("sales_opportunities").update({ status }).eq("id", id), "status")
        return id
    }

    it("returns the deal to the status it was lost from and clears the current loss", async () => {
        const sor = await oldDeal(midCode)
        expect((await lose("dealOwner", sor, "PRICE_TOO_HIGH", "Too dear")).error).toBeNull()
        expect((await row(sor)).status).toBe(lostCode)

        expect((await reopen("dealOwner", sor)).error).toBeNull()
        expect(await row(sor)).toMatchObject({ status: midCode, lost_reason_code: null, lost_reason: null, lost_from_status: null })

        const { data: logs } = await svc().from("sales_opportunity_logs").select("metadata").eq("opportunity_id", sor).in("metadata->>event", ["MARKED_LOST", "REOPENED"])
        expect(logs.map((l) => l.metadata.event).sort()).toEqual(["MARKED_LOST", "REOPENED"])
    })

    it("can be lost again after a reopen", async () => {
        const sor = await oldDeal(midCode)
        await lose("dealOwner", sor)
        await reopen("dealOwner", sor)
        expect((await lose("dealOwner", sor, "NO_BUDGET")).error).toBeNull()
        expect(await row(sor)).toMatchObject({ status: lostCode, lost_reason_code: "NO_BUDGET", lost_from_status: midCode })
    })

    it("refuses a deal that is not Lost", async () => {
        const sor = await oldDeal(midCode)
        expect((await reopen("dealOwner", sor)).error?.message).toMatch(/not Lost/i)
        expect((await row(sor)).status).toBe(midCode)
    })

    it.each(["outsider", "ordinary"])("refuses %s", async (who) => {
        const sor = await oldDeal(midCode)
        await lose("dealOwner", sor)
        expect((await reopen(who, sor)).error).not.toBeNull()
        expect((await row(sor)).status).toBe(lostCode)
    })
})
