/**
 * Issue #405 (parent #384) — leaving a Stage auto-skips its still-pending
 * Optional Actions (opportunityService.js's step 2b). Reverting that leaving
 * move must undo the skip it made (S94004), while Reverting with a Keep
 * choice must instead hold a still-pending Optional Action left behind, not
 * leave it decidable while the SOR sits elsewhere (S94005).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

let saleTypeId, flowId, stageA, stageB, stageTerminal, actionId
const sorIds = []
const svc = () => serviceClient()

async function stage(name, sortOrder, extra = {}) {
    const { data, error } = await svc()
        .from("flow_stages")
        .insert({ flow_id: flowId, name: `${MARKER} ${name}`, sort_order: sortOrder, ...extra })
        .select("id")
        .single()
    if (error) throw new Error(error.message)
    return data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    saleTypeId = (await svc().from("sale_types").insert({ name: `${MARKER} RevertSkippedAction` }).select("id").single()).data.id
    flowId = (await svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()).data.id
    stageA = await stage("A", 10)
    stageB = await stage("B", 20)
    stageTerminal = await stage("Terminal", 30, { is_terminal: true })
    actionId = (await svc().from("flow_stage_actions").insert({ stage_id: stageB, kind: "create_individual_task" }).select("id").single()).data.id
})

afterAll(async () => {
    await svc().from("tasks").delete().in("opportunity_id", sorIds)
    await svc().from("committee_tasks").delete().in("opportunity_id", sorIds)
    await svc().from("sor_action_runs").delete().in("opportunity_id", sorIds)
    await svc().from("system_audit_logs").delete().in("entity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stage_actions").delete().eq("id", actionId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

async function freshSor() {
    const id = await makeSor({
        registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, closingSalesId: ids.closingSales, saleTypeId, flowStageId: stageA,
    })
    sorIds.push(id)
    return id
}

async function moveAs(who, sorId, toStage) {
    const client = await clientFor(who)
    const { error } = await client.from("sales_opportunities").update({ flow_stage_id: toStage }).eq("id", sorId)
    if (error) throw new Error(`Moving as ${who}: ${error.message}`)
}

async function revertAs(who, sorId, progressChoice = null) {
    const client = await clientFor(who)
    return client.rpc("sor_revert_stage", { p_opportunity_id: sorId, p_progress_choice: progressChoice })
}

async function visits(sorId) {
    const { data } = await svc().from("sor_stage_visits").select("*").eq("opportunity_id", sorId).order("sequence")
    return data
}

/** Mimics opportunityService.js's leaving-stage auto-skip: a run that was
 * `pending` on the visit being left flips to `skipped` with no decider. */
async function autoSkip(runId) {
    const client = await clientFor("dealOwner")
    const { error } = await client.rpc("sor_finish_action_run", { p_run_id: runId, p_outcome: "skipped" })
    if (error) throw new Error(`Auto-skip: ${error.message}`)
}

describe("Revert restores an Optional Action the reverted move skipped", () => {
    it("S94004: reverting the move that auto-skipped a pending run puts it back to pending, undecided by anyone", async () => {
        const id = await freshSor()
        await moveAs("dealOwner", id, stageB)
        const [, visitB] = await visits(id)

        const run = (await svc()
            .from("sor_action_runs")
            .insert({ opportunity_id: id, stage_id: stageB, action_id: actionId, stage_visit_id: visitB.id, decider: [{ type: "role", role: "deal_owner" }] })
            .select("id")
            .single()).data.id

        // Leaving B (undecided) auto-skips it, exactly as opportunityService's
        // step 2b does on a real move.
        await moveAs("dealOwner", id, stageTerminal)
        await autoSkip(run)

        const skipped = (await svc().from("sor_action_runs").select("outcome, decided_by").eq("id", run).single()).data
        expect(skipped.outcome).toBe("skipped")
        expect(skipped.decided_by).toBeNull()

        const { error } = await revertAs("dealOwner", id)
        expect(error).toBeNull()

        const restored = (await svc().from("sor_action_runs").select("outcome, decided_by, held_at, closed_off_at").eq("id", run).single()).data
        expect(restored.outcome).toBe("pending")
        expect(restored.decided_by).toBeNull()
        expect(restored.held_at).toBeNull()
        expect(restored.closed_off_at).toBeNull()

        // Timeline records the restore.
        const log = await svc()
            .from("sales_opportunity_logs")
            .select("metadata")
            .eq("opportunity_id", id)
            .eq("metadata->>event", "ACTION_RUN_RESTORED")
        expect(log.data).toHaveLength(1)
        expect(log.data[0].metadata.runId).toBe(run)
    })

    it("a run the Decider skipped stays skipped through a Revert", async () => {
        const id = await freshSor()
        await moveAs("dealOwner", id, stageB)
        const [, visitB] = await visits(id)

        const run = (await svc()
            .from("sor_action_runs")
            .insert({ opportunity_id: id, stage_id: stageB, action_id: actionId, stage_visit_id: visitB.id, decider: [{ type: "role", role: "deal_owner" }] })
            .select("id")
            .single()).data.id

        const client = await clientFor("dealOwner")
        const { error: decideError } = await client.rpc("sor_decide_action_run", { p_run_id: run, p_decision: "skip", p_actor_id: ids.dealOwner })
        expect(decideError).toBeNull()

        await moveAs("dealOwner", id, stageTerminal)
        const { error } = await revertAs("dealOwner", id)
        expect(error).toBeNull()

        const stillSkipped = (await svc().from("sor_action_runs").select("outcome, decided_by").eq("id", run).single()).data
        expect(stillSkipped.outcome).toBe("skipped")
        expect(stillSkipped.decided_by).toBe(ids.dealOwner)
    })

    it("S94005: a Keep-progress Revert holds a still-pending run — not decidable until Resume", async () => {
        const id = await freshSor()
        await moveAs("dealOwner", id, stageB)
        const [, visitB] = await visits(id)

        // Real Stage Work on B (an AWAITING APPROVAL task) forces the choice.
        expect((await svc()
            .from("tasks")
            .insert({ logged_by: ids.dealOwner, opportunity_id: id, stage_visit_id: visitB.id, stage_action_id: actionId, task_description: `${MARKER} work`, status: "AWAITING APPROVAL" })
            .select("id")
            .single()).error).toBeNull()
        const run = (await svc()
            .from("sor_action_runs")
            .insert({ opportunity_id: id, stage_id: stageB, action_id: actionId, stage_visit_id: visitB.id, decider: [{ type: "role", role: "deal_owner" }] })
            .select("id")
            .single()).data.id

        const { error } = await revertAs("dealOwner", id, "keep")
        expect(error).toBeNull()

        const held = (await svc().from("sor_action_runs").select("outcome, held_at, closed_off_at").eq("id", run).single()).data
        expect(held.outcome).toBe("pending")
        expect(held.held_at).not.toBeNull()
        expect(held.closed_off_at).toBeNull()

        // Not decidable while held.
        const client = await clientFor("dealOwner")
        const { error: decideError } = await client.rpc("sor_decide_action_run", { p_run_id: run, p_decision: "create", p_actor_id: ids.dealOwner })
        expect(decideError?.message).toMatch(/on hold, not decidable/)

        // Resume back into B brings it back pending and decidable.
        const { error: resumeError } = await client.rpc("sor_move_and_resume", { p_opportunity_id: id, p_flow_stage_id: stageB })
        expect(resumeError).toBeNull()

        const resumed = (await svc().from("sor_action_runs").select("outcome, held_at").eq("id", run).single()).data
        expect(resumed.outcome).toBe("pending")
        expect(resumed.held_at).toBeNull()

        const { error: decideAfterResume } = await client.rpc("sor_decide_action_run", { p_run_id: run, p_decision: "create", p_actor_id: ids.dealOwner })
        expect(decideAfterResume).toBeNull()
    })

    it("S94005 mirror: a Remove-progress Revert closes off a still-pending run instead of holding it", async () => {
        const id = await freshSor()
        await moveAs("dealOwner", id, stageB)
        const [, visitB] = await visits(id)

        expect((await svc()
            .from("tasks")
            .insert({ logged_by: ids.dealOwner, opportunity_id: id, stage_visit_id: visitB.id, stage_action_id: actionId, task_description: `${MARKER} work`, status: "AWAITING APPROVAL" })
            .select("id")
            .single()).error).toBeNull()
        const run = (await svc()
            .from("sor_action_runs")
            .insert({ opportunity_id: id, stage_id: stageB, action_id: actionId, stage_visit_id: visitB.id, decider: [{ type: "role", role: "deal_owner" }] })
            .select("id")
            .single()).data.id

        const { error } = await revertAs("dealOwner", id, "remove")
        expect(error).toBeNull()

        const closed = (await svc().from("sor_action_runs").select("outcome, held_at, closed_off_at, closed_off_reason").eq("id", run).single()).data
        expect(closed.outcome).toBe("pending")
        expect(closed.held_at).toBeNull()
        expect(closed.closed_off_at).not.toBeNull()
        expect(closed.closed_off_reason).toBe("reverted")

        const client = await clientFor("dealOwner")
        const { error: decideError } = await client.rpc("sor_decide_action_run", { p_run_id: run, p_decision: "create", p_actor_id: ids.dealOwner })
        expect(decideError?.message).toMatch(/closed off, not decidable/)
    })
})
