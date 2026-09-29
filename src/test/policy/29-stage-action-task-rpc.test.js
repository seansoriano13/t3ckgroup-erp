/**
 * Issue #404 — Individual Task Stage Actions are created through
 * `sor_create_stage_action_task` (supabase/migrations/20260930220000_stage_action_task_via_rpc.sql),
 * not by inserting into `tasks` under the mover's own permissions. That RPC,
 * not the `tasks` insert policy, is what a non-head/HR/Super-Admin mover on
 * the Deal Team relies on to assign the task to someone else.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

let saleTypeId, flowId, stageId, actionId
const sorIds = []
const svc = () => serviceClient()

beforeAll(async () => {
    await ensureCastLoaded()
    const saleType = await svc().from("sale_types").insert({ name: `${MARKER} Stage Action RPC` }).select("id").single()
    if (saleType.error) throw new Error(saleType.error.message)
    saleTypeId = saleType.data.id
    const flow = await svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()
    if (flow.error) throw new Error(flow.error.message)
    flowId = flow.data.id
    const stage = await svc()
        .from("flow_stages")
        .insert({ flow_id: flowId, name: `${MARKER} Stage`, sort_order: 10 })
        .select("id")
        .single()
    if (stage.error) throw new Error(stage.error.message)
    stageId = stage.data.id
    const action = await svc()
        .from("flow_stage_actions")
        .insert({ stage_id: stageId, kind: "create_individual_task" })
        .select("id")
        .single()
    if (action.error) throw new Error(action.error.message)
    actionId = action.data.id
})

afterAll(async () => {
    await svc().from("tasks").delete().in("opportunity_id", sorIds)
    await svc().from("sor_action_runs").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stage_actions").delete().eq("id", actionId)
    await svc().from("flow_stages").delete().eq("id", stageId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

/** A fresh SOR with `support` on its Deal Team (support_sales_1_id), plus a pending run. */
async function freshRun({ dealOwnerId = ids.dealOwner, supportSales1Id = null } = {}) {
    const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId, supportSales1Id, saleTypeId, flowStageId: stageId })
    sorIds.push(id)
    const begin = await svc().rpc("sor_begin_action_run", {
        p_opportunity_id: id,
        p_stage_id: stageId,
        p_action_id: actionId,
    })
    if (begin.error) throw new Error(begin.error.message)
    return { sorId: id, runId: begin.data.id }
}

const createArgs = (runId, overrides = {}) => ({
    p_run_id: runId,
    p_task_description: `${MARKER} Do the thing`,
    p_project_title: `${MARKER} Project`,
    p_category_id: null,
    p_logged_by: null,
    p_priority: "MEDIUM",
    p_checklist: null,
    p_end_at: null,
    p_reported_to: null,
    ...overrides,
})

describe("sor_create_stage_action_task", () => {
    it("a non-head salesperson on the Deal Team can create the task for someone else", async () => {
        const { sorId, runId } = await freshRun({ supportSales1Id: ids.support })
        const client = await clientFor("support")

        const { data: task, error } = await client.rpc(
            "sor_create_stage_action_task",
            createArgs(runId, { p_logged_by: ids.closingSales }),
        )

        expect(error).toBeNull()
        expect(task.opportunity_id).toBe(sorId)
        expect(task.logged_by).toBe(ids.closingSales)
        expect(task.stage_action_id).toBe(actionId)

        const run = (await svc().from("sor_action_runs").select("outcome, task_id").eq("id", runId).single()).data
        expect(run.outcome).toBe("created")
        expect(run.task_id).toBe(task.id)
    })

    it("refuses a caller with no full access to the SOR", async () => {
        const { runId } = await freshRun()
        const client = await clientFor("outsider")

        const { error } = await client.rpc("sor_create_stage_action_task", createArgs(runId))

        expect(error).not.toBeNull()
        expect(error.message).toMatch(/lacks full access/)

        const run = (await svc().from("sor_action_runs").select("outcome").eq("id", runId).single()).data
        expect(run.outcome).toBe("pending")
    })

    it("refuses a run that was skipped, not decided pending/created", async () => {
        const { runId } = await freshRun({ supportSales1Id: ids.support })
        // A skipped run mirrors what sor_decide_action_run leaves behind for
        // a Decider's "Skip" — never a state this RPC should build a task on.
        const skip = await svc().from("sor_action_runs").update({ outcome: "skipped" }).eq("id", runId)
        expect(skip.error).toBeNull()

        const client = await clientFor("support")
        const { error } = await client.rpc("sor_create_stage_action_task", createArgs(runId))

        expect(error).not.toBeNull()
        expect(error.message).toMatch(/not pending/)
    })

    it("allows a run already flipped to `created` by sor_decide_action_run (issue #204's decide-then-build ordering), as long as no task exists yet", async () => {
        const { runId } = await freshRun({ supportSales1Id: ids.support })
        const decided = await svc().from("sor_action_runs").update({ outcome: "created" }).eq("id", runId)
        expect(decided.error).toBeNull()

        const client = await clientFor("support")
        const { data: task, error } = await client.rpc("sor_create_stage_action_task", createArgs(runId))

        expect(error).toBeNull()
        expect(task).toBeTruthy()
    })

    it("fire-once holds: a second call for the same run creates no second task", async () => {
        const { sorId, runId } = await freshRun({ supportSales1Id: ids.support })
        const client = await clientFor("support")

        const first = await client.rpc("sor_create_stage_action_task", createArgs(runId))
        expect(first.error).toBeNull()

        const second = await client.rpc("sor_create_stage_action_task", createArgs(runId))
        expect(second.error).not.toBeNull()
        expect(second.error.message).toMatch(/already has a task/)

        const run = (await svc().from("sor_action_runs").select("task_id").eq("id", runId).single()).data
        const tasksForSor = (await svc().from("tasks").select("id").eq("opportunity_id", sorId)).data
        expect(tasksForSor.map((t) => t.id)).toEqual([run.task_id])
    })

    it("a direct insert into tasks by a non-head mover on someone else's behalf still fails RLS (unchanged policy)", async () => {
        const { sorId } = await freshRun({ supportSales1Id: ids.support })
        const client = await clientFor("support")

        const { error } = await client
            .from("tasks")
            .insert({
                task_description: `${MARKER} direct insert`,
                logged_by: ids.closingSales,
                opportunity_id: sorId,
            })

        expect(error).not.toBeNull()
    })
})
