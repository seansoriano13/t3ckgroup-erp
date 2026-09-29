/**
 * Issue #392 (parent #384) — Revert when Stage Work was done on the Stage
 * being left: the reverter chooses Keep progress or Remove progress, and
 * either way a new Stage Visit on the earlier Stage resumes that Stage's own
 * earlier work. Someone shut out of the Stage being left never sees the
 * choice — their revert always keeps progress.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

let saleTypeId, flowId, stageA, stageB, actionId
const sorIds = []
const groupIds = []
const svc = () => serviceClient()

async function stage(name, sortOrder) {
    const { data, error } = await svc()
        .from("flow_stages")
        .insert({ flow_id: flowId, name: `${MARKER} ${name}`, sort_order: sortOrder })
        .select("id")
        .single()
    if (error) throw new Error(error.message)
    return data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    saleTypeId = (await svc().from("sale_types").insert({ name: `${MARKER} RevertChoice` }).select("id").single()).data.id
    flowId = (await svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()).data.id
    stageA = await stage("A", 10)
    stageB = await stage("B", 20)
    actionId = (await svc().from("flow_stage_actions").insert({ stage_id: stageB, kind: "create_individual_task" }).select("id").single()).data.id
})

afterAll(async () => {
    await svc().from("tasks").delete().in("opportunity_id", sorIds)
    await svc().from("committee_tasks").delete().in("opportunity_id", sorIds)
    await svc().from("sor_action_runs").delete().in("opportunity_id", sorIds)
    await svc().from("system_audit_logs").delete().in("entity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    for (const groupId of groupIds) {
        await svc().from("employee_group_members").delete().eq("group_id", groupId)
        await svc().from("employee_groups").delete().eq("id", groupId)
    }
    await svc().from("flow_stage_access").delete().in("stage_id", [stageA, stageB])
    await svc().from("flow_stage_actions").delete().eq("stage_id", stageB).neq("id", actionId)
    await svc().from("flow_snapshots").delete().eq("flow_id", flowId)
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

/** An SOR moved from A to B, with a real (progressed) task recorded on B. */
async function withProgressOnB() {
    const id = await freshSor()
    await moveAs("dealOwner", id, stageB)
    const [visitA, visitB] = await visits(id)
    const task = (await svc()
        .from("tasks")
        .insert({ logged_by: ids.dealOwner, opportunity_id: id, stage_visit_id: visitB.id, stage_action_id: actionId, task_description: `${MARKER} work`, status: "AWAITING APPROVAL" })
        .select("id")
        .single()).data.id
    return { id, visitA, visitB, task }
}

describe("Revert with a progress choice", () => {
    it("still refuses without a choice, naming the Stage Work", async () => {
        const { id } = await withProgressOnB()
        const { error } = await revertAs("dealOwner", id)
        expect(error?.message).toMatch(/Stage Work was done/)
    })

    it("a Stage Action's own task is Stage Work the moment it's created, even untouched", async () => {
        const id = await freshSor()
        await moveAs("dealOwner", id, stageB)
        const [, visitB] = await visits(id)
        // Untouched: default status, nobody has acted on it — only the Stage
        // Action having created it. Before this fix, Revert treated this as
        // no Stage Work: it silently cancelled the task and closed off its
        // action run, then erased the visit (undone_at), leaving no trace.
        await svc()
            .from("tasks")
            .insert({ logged_by: ids.dealOwner, opportunity_id: id, stage_visit_id: visitB.id, stage_action_id: actionId, task_description: `${MARKER} untouched`, status: "INCOMPLETE" })

        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_revert_needs_progress_choice", { p_opportunity_id: id })).data).toBe(true)

        const { error } = await revertAs("dealOwner", id)
        expect(error?.message).toMatch(/Stage Work was done/)

        const left = (await svc().from("sor_stage_visits").select("undone_at").eq("id", visitB.id).single()).data
        expect(left.undone_at).toBeNull()
    })

    it("refuses an invalid choice", async () => {
        const { id } = await withProgressOnB()
        const { error } = await revertAs("dealOwner", id, "delete-everything")
        expect(error?.message).toMatch(/must be "keep" or "remove"/)
    })

    it("Keep progress: holds the left visit's task and opens a new visit on A with A's own earlier work resumed", async () => {
        const { id, visitA, visitB, task } = await withProgressOnB()
        const olderTask = (await svc()
            .from("tasks")
            .insert({ logged_by: ids.dealOwner, opportunity_id: id, stage_visit_id: visitA.id, task_description: `${MARKER} earlier A work`, status: "INCOMPLETE" })
            .select("id")
            .single()).data.id

        const { error } = await revertAs("dealOwner", id, "keep")
        expect(error).toBeNull()

        const left = (await svc().from("sor_stage_visits").select("*").eq("id", visitB.id).single()).data
        expect(left.revert_choice).toBe("keep")
        expect(left.left_at).not.toBeNull()
        expect(left.undone_at).toBeNull()

        const heldTask = (await svc().from("tasks").select("status, held_from_visit_id").eq("id", task).single()).data
        expect(heldTask.status).toBe("ON_HOLD")
        expect(heldTask.held_from_visit_id).toBe(visitB.id)

        const rows = await visits(id)
        const newestA = rows.filter((v) => v.flow_stage_id === stageA).sort((a, b) => b.sequence - a.sequence)[0]
        expect(newestA.id).not.toBe(visitA.id)
        expect(newestA.left_at).toBeNull()
        expect(newestA.resumed_at).toBeNull()

        const movedOlder = (await svc().from("tasks").select("stage_visit_id").eq("id", olderTask).single()).data
        expect(movedOlder.stage_visit_id).toBe(newestA.id)

        const refreshedA = (await svc().from("sor_stage_visits").select("resumed_into_visit_id").eq("id", visitA.id).single()).data
        expect(refreshedA.resumed_into_visit_id).toBe(newestA.id)
    })

    it("Remove progress: cancels the left visit's task with a reason naming the Revert, closes off its action runs, but leaves it visible", async () => {
        const { id, visitB, task } = await withProgressOnB()
        const run = (await svc()
            .from("sor_action_runs")
            .insert({ opportunity_id: id, stage_id: stageB, action_id: actionId, stage_visit_id: visitB.id, outcome: "created", task_id: task })
            .select("id")
            .single()).data.id

        const { error } = await revertAs("dealOwner", id, "remove")
        expect(error).toBeNull()

        // Left, not undone: the visit stays on the History with its closed-off work.
        const left = (await svc().from("sor_stage_visits").select("*").eq("id", visitB.id).single()).data
        expect(left.revert_choice).toBe("remove")
        expect(left.undone_at).toBeNull()
        expect(left.left_at).not.toBeNull()

        const cancelled = (await svc().from("tasks").select("status, cancel_reason").eq("id", task).single()).data
        expect(cancelled.status).toBe("DELETED")
        expect(cancelled.cancel_reason).toMatch(/Revert/)

        const closedRun = (await svc().from("sor_action_runs").select("closed_off_at, closed_off_reason").eq("id", run).single()).data
        expect(closedRun.closed_off_at).not.toBeNull()
        expect(closedRun.closed_off_reason).toBe("reverted")

        // Still visible on the Journey — the row stands, just cancelled.
        const stillThere = await svc().from("tasks").select("id").eq("id", task).maybeSingle()
        expect(stillThere.data).not.toBeNull()
    })

    it("Keep progress leaves a task whose action carries on past the Stage alone", async () => {
        const { id, visitB, task } = await withProgressOnB()
        const carryId = (await svc().from("flow_stage_actions")
            .insert({ stage_id: stageB, kind: "create_individual_task", config: { carries_on: true } })
            .select("id").single()).data.id
        const snap = await svc().from("flow_snapshots")
            .insert({ flow_id: flowId, version: 9100 + sorIds.length, snapshot_data: { actions: [{ id: carryId, stage_id: stageB, config: { carries_on: true } }] } })
            .select("id").single()
        if (snap.error) throw new Error(snap.error.message)
        await svc().from("sor_stage_visits").update({ flow_snapshot_id: snap.data.id }).eq("id", visitB.id)
        const carried = (await svc().from("tasks")
            .insert({ logged_by: ids.dealOwner, opportunity_id: id, stage_visit_id: visitB.id, stage_action_id: carryId, task_description: `${MARKER} carries on`, status: "INCOMPLETE" })
            .select("id").single()).data.id

        const { error } = await revertAs("dealOwner", id, "keep")
        expect(error).toBeNull()

        expect((await svc().from("tasks").select("status").eq("id", task).single()).data.status).toBe("ON_HOLD")
        expect((await svc().from("tasks").select("status").eq("id", carried).single()).data.status).toBe("INCOMPLETE")
    })

    it.each(["keep", "remove"])("refuses a second Revert straight after a %s-progress Revert (one step only)", async (choice) => {
        const { id } = await withProgressOnB()
        expect((await revertAs("dealOwner", id, choice)).error).toBeNull()

        const { error } = await revertAs("dealOwner", id, choice)
        expect(error?.message).toMatch(/already reverted/)
        const sor = (await svc().from("sales_opportunities").select("flow_stage_id").eq("id", id).single()).data
        expect(sor.flow_stage_id).toBe(stageA)
    })

    it("after Remove progress, moving back into that Stage is not a Return", async () => {
        const { id } = await withProgressOnB()
        expect((await revertAs("dealOwner", id, "remove")).error).toBeNull()

        const client = await clientFor("dealOwner")
        const { error } = await client.rpc("sor_move_and_resume", { p_opportunity_id: id, p_flow_stage_id: stageB })
        expect(error?.message).toMatch(/not a Return/)
    })

    it("records the progress choice on STAGE_REVERTED", async () => {
        const { id } = await withProgressOnB()
        await revertAs("dealOwner", id, "remove")
        const log = await svc()
            .from("sales_opportunity_logs")
            .select("metadata")
            .eq("opportunity_id", id)
            .eq("metadata->>event", "STAGE_REVERTED")
        expect(log.data).toHaveLength(1)
        expect(log.data[0].metadata).toMatchObject({ progressChoice: "remove" })
    })

    it("leaves progressChoice null on an ordinary revert with no Stage Work", async () => {
        const id = await freshSor()
        await moveAs("dealOwner", id, stageB)
        const { error } = await revertAs("dealOwner", id)
        expect(error).toBeNull()
        const log = await svc()
            .from("sales_opportunity_logs")
            .select("metadata")
            .eq("opportunity_id", id)
            .eq("metadata->>event", "STAGE_REVERTED")
        expect(log.data).toHaveLength(1)
        expect(log.data[0].metadata.progressChoice).toBeNull()
    })

    it("says no progress choice is needed for an ordinary revert, and yes once Stage Work is done", async () => {
        const id = await freshSor()
        await moveAs("dealOwner", id, stageB)
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_revert_needs_progress_choice", { p_opportunity_id: id })).data).toBe(false)

        const [, visitB] = await visits(id)
        await svc()
            .from("tasks")
            .insert({ logged_by: ids.dealOwner, opportunity_id: id, stage_visit_id: visitB.id, stage_action_id: actionId, task_description: `${MARKER} work`, status: "AWAITING APPROVAL" })
        expect((await client.rpc("sor_revert_needs_progress_choice", { p_opportunity_id: id })).data).toBe(true)
    })

    it("issue #402: a condition file given on the current visit is Stage Work, same as a tick", async () => {
        const id = await freshSor()
        await moveAs("dealOwner", id, stageB)
        const [, visitB] = await visits(id)
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_revert_needs_progress_choice", { p_opportunity_id: id })).data).toBe(false)

        // Mimics StageChecklist.jsx's stampAndAttach: a condition file is
        // recorded only as an attachment note, tagged with the condition and
        // the current Stage Visit (the trigger-set stage_visit_id column).
        await svc().from("sales_opportunity_logs").insert({
            opportunity_id: id,
            author_id: ids.dealOwner,
            type: "COMMENT",
            content: `${MARKER} Attached document: a condition`,
            metadata: { attachments: [{ url: "https://example.com/f.pdf", name: "f.pdf", conditionId: crypto.randomUUID(), stageVisitId: visitB.id }] },
        })

        expect((await client.rpc("sor_revert_needs_progress_choice", { p_opportunity_id: id })).data).toBe(true)

        const { error } = await revertAs("dealOwner", id)
        expect(error?.message).toMatch(/Stage Work was done/)
    })

    it("a reverter shut out of the Stage being left is never asked, and Revert keeps progress", async () => {
        const group = (await svc().from("employee_groups").insert({ name: `${MARKER} Shut Out Of B` }).select("id").single()).data.id
        groupIds.push(group)
        await svc().from("employee_group_members").insert({ group_id: group, employee_id: ids.dealOwner })
        await svc().from("flow_stage_access").insert({ stage_id: stageB, excluded_group_ids: [group] })

        const { id, visitB, task } = await withProgressOnB()
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_revert_needs_progress_choice", { p_opportunity_id: id })).data).toBe(false)

        const { error } = await revertAs("dealOwner", id)
        expect(error).toBeNull()

        const left = (await svc().from("sor_stage_visits").select("revert_choice, left_at, undone_at").eq("id", visitB.id).single()).data
        expect(left.revert_choice).toBe("keep")
        expect(left.left_at).not.toBeNull()
        expect(left.undone_at).toBeNull()
        expect((await svc().from("tasks").select("status").eq("id", task).single()).data.status).toBe("ON_HOLD")

        await svc().from("flow_stage_access").delete().eq("stage_id", stageB)
        await svc().from("employee_group_members").delete().eq("group_id", group)
        await svc().from("employee_groups").delete().eq("id", group)
        groupIds.pop()
    })
})
