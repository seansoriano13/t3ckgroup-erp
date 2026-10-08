/**
 * A Terminal Stage says how deals end there, Won or Lost
 * (20261005132000_terminal_stage_outcome.sql).
 *
 * The flow here is shaped like the real ones: Lead → Won (the Won Stage,
 * mid-flow) → Closed Won, and Closed Lost and Cancelled reachable from every
 * Stage, after the Won Stage too (docs/crm-pipeline-redesign.md D36).
 * Re-running the migration's backfill must mark only the Stage named Closed
 * Won (any spacing or case) as won, leave Closed Lost and Cancelled unset
 * (lost), and do the same inside a Flow Snapshot. Restoring a snapshot
 * carries the outcome.
 */
import { readFileSync } from "fs"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const stage = {}
let saleTypeId, flowId, snapshotId

async function one(query, what) {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const outcomes = async () =>
    Object.fromEntries(
        (await one(svc().from("flow_stages").select("id, terminal_outcome").eq("flow_id", flowId), "Reading Stages")).map((s) => [
            s.id,
            s.terminal_outcome,
        ]),
    )

beforeAll(async () => {
    await ensureCastLoaded()
    saleTypeId = (await one(svc().from("sale_types").insert({ name: `${MARKER} Outcome` }).select("id").single(), "Seeding a Sale Type")).id
    flowId = (await one(svc().from("sales_flows").insert({ sale_type_id: saleTypeId, state: "draft" }).select("id").single(), "Seeding a flow")).id
    const stages = await one(
        svc()
            .from("flow_stages")
            .insert([
                { flow_id: flowId, name: `${MARKER} Lead`, sort_order: 0, is_terminal: false },
                { flow_id: flowId, name: `${MARKER} Won`, sort_order: 1, is_terminal: false },
                // Unprefixed: the backfill matches the name itself.
                { flow_id: flowId, name: "  CLOSED WON ", sort_order: 2, is_terminal: true },
                { flow_id: flowId, name: "Closed Lost", sort_order: 3, is_terminal: true },
                { flow_id: flowId, name: `${MARKER} Cancelled`, sort_order: 4, is_terminal: true },
            ])
            .select("id, sort_order"),
        "Seeding Stages",
    )
    ;[stage.lead, stage.won, stage.closedWon, stage.lost, stage.cancelled] = stages.sort((a, b) => a.sort_order - b.sort_order).map((s) => s.id)
    const edges = await one(
        svc()
            .from("flow_edges")
            .insert([
                { flow_id: flowId, from_stage_id: stage.lead, to_stage_id: stage.won },
                { flow_id: flowId, from_stage_id: stage.won, to_stage_id: stage.closedWon },
                { flow_id: flowId, from_stage_id: stage.lead, to_stage_id: stage.lost },
                { flow_id: flowId, from_stage_id: stage.won, to_stage_id: stage.lost },
                { flow_id: flowId, from_stage_id: stage.won, to_stage_id: stage.cancelled },
            ])
            .select("*"),
        "Seeding moves",
    )
    await one(svc().from("sales_flows").update({ won_stage_id: stage.won }).eq("id", flowId), "Naming the Won Stage")

    const liveStages = await one(svc().from("flow_stages").select("*").eq("flow_id", flowId), "Reading Stages")
    snapshotId = (
        await one(
            svc()
                .from("flow_snapshots")
                .insert({ flow_id: flowId, version: 1, snapshot_data: { stages: liveStages, edges, wonStageId: stage.won, saleTypeId } })
                .select("id")
                .single(),
            "Seeding a snapshot",
        )
    ).id

    // The migration is idempotent; running it again backfills these rows.
    await sql().query(readFileSync("supabase/migrations/20261005132000_terminal_stage_outcome.sql", "utf8"))
})

afterAll(async () => {
    await svc().from("flow_snapshots").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").update({ won_stage_id: null }).eq("id", flowId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("the backfill", () => {
    it("marks only the Terminal Stage named Closed Won as won; Closed Lost and Cancelled stay lost though reachable after the Won Stage", async () => {
        expect(await outcomes()).toEqual({
            [stage.lead]: null,
            [stage.won]: null,
            [stage.closedWon]: "won",
            [stage.lost]: null,
            [stage.cancelled]: null,
        })
    })

    it("does the same inside a Flow Snapshot", async () => {
        const snap = await one(svc().from("flow_snapshots").select("snapshot_data").eq("id", snapshotId).single(), "Reading the snapshot")
        const byId = Object.fromEntries(snap.snapshot_data.stages.map((s) => [s.id, s.terminal_outcome ?? null]))
        expect(byId).toEqual({
            [stage.lead]: null,
            [stage.won]: null,
            [stage.closedWon]: "won",
            [stage.lost]: null,
            [stage.cancelled]: null,
        })
    })
})

describe("the rule", () => {
    it("refuses an outcome on a Stage that isn't terminal", async () => {
        const { error } = await svc().from("flow_stages").update({ terminal_outcome: "won" }).eq("id", stage.lead)
        expect(error?.message).toMatch(/flow_stages_terminal_outcome_chk/)
    })

    it("refuses an outcome other than won or lost", async () => {
        const { error } = await svc().from("flow_stages").update({ terminal_outcome: "maybe" }).eq("id", stage.lost)
        expect(error?.message).toMatch(/flow_stages_terminal_outcome_chk/)
    })
})

describe("restoring a Flow Snapshot", () => {
    it("brings back each Terminal Stage's outcome", async () => {
        // Closed Won is set to Lost by hand after the backfill; the snapshot
        // still says won, so a restore brings won back.
        await one(svc().from("flow_stages").update({ terminal_outcome: "lost" }).eq("id", stage.closedWon), "Setting Closed Won to lost")
        await one(svc().rpc("restore_flow_snapshot", { p_flow_id: flowId, p_snapshot_id: snapshotId }), "Restoring")
        expect((await outcomes())[stage.closedWon]).toBe("won")
    })
})
