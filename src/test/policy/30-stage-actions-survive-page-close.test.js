/**
 * Issue #409 — Stage Actions used to run as a loop of client round-trips
 * (moveAlongFlow: begin, then create-or-notify, then finish, one action at a
 * time). Closing the tab mid-loop left the rest of the Stage's actions with
 * no run row at all: not created, not failed, and the #204 fire-once gate
 * then refused to ever offer them again.
 *
 * `sor_run_stage_actions` (supabase/migrations/20260930240000_stage_actions_survive_page_close.sql)
 * runs the whole batch in one server-side call. This calls it directly and
 * asserts on `sor_action_runs`/`tasks`/`committee_tasks`/`notifications`
 * without making any further client call — the shape of "the browser closed
 * right after the RPC returned".
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

let saleTypeId, flowId, stageId, individualActionId, groupActionId, confirmActionId, unsupportedActionId
const sorIds = []
const groupTaskIds = []
const svc = () => serviceClient()

beforeAll(async () => {
    await ensureCastLoaded()
    const saleType = await svc().from("sale_types").insert({ name: `${MARKER} Stage Actions Survive` }).select("id").single()
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

    const individual = await svc()
        .from("flow_stage_actions")
        .insert({ stage_id: stageId, kind: "create_individual_task" })
        .select("id")
        .single()
    if (individual.error) throw new Error(individual.error.message)
    individualActionId = individual.data.id

    const group = await svc()
        .from("flow_stage_actions")
        .insert({ stage_id: stageId, kind: "create_group_task" })
        .select("id")
        .single()
    if (group.error) throw new Error(group.error.message)
    groupActionId = group.data.id

    const confirm = await svc()
        .from("flow_stage_actions")
        .insert({ stage_id: stageId, kind: "create_individual_task", config: { confirmMode: "confirm" } })
        .select("id")
        .single()
    if (confirm.error) throw new Error(confirm.error.message)
    confirmActionId = confirm.data.id

    // The RPC branches on the payload's own `kind` string, not on this row's
    // `kind` column (which the db constrains to the two real kinds) — so a
    // real row of either kind stands in here, and the test sends an
    // unsupported `kind` in the payload below to exercise the "no builder
    // for this kind" failure branch.
    const unsupported = await svc()
        .from("flow_stage_actions")
        .insert({ stage_id: stageId, kind: "create_individual_task" })
        .select("id")
        .single()
    if (unsupported.error) throw new Error(unsupported.error.message)
    unsupportedActionId = unsupported.data.id
})

afterAll(async () => {
    await svc().from("committee_task_members").delete().in("committee_task_id", groupTaskIds)
    await svc().from("committee_tasks").delete().in("id", groupTaskIds)
    await svc().from("tasks").delete().in("opportunity_id", sorIds)
    await svc().from("notifications").delete().in("reference_id", sorIds)
    await svc().from("sor_action_runs").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc()
        .from("flow_stage_actions")
        .delete()
        .in("id", [individualActionId, groupActionId, confirmActionId, unsupportedActionId])
    await svc().from("flow_stages").delete().eq("id", stageId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

async function freshSor() {
    const id = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        supportSales1Id: ids.support,
        saleTypeId,
        flowStageId: stageId,
    })
    sorIds.push(id)
    return id
}

const actionsPayload = () => [
    {
        action_id: individualActionId,
        kind: "create_individual_task",
        name: "Individual task action",
        confirm: false,
        task_description: `${MARKER} Do the individual thing`,
        project_title: `${MARKER} Project`,
        category_id: null,
        logged_by: ids.closingSales,
        priority: "MEDIUM",
        checklist: null,
    },
    {
        action_id: groupActionId,
        kind: "create_group_task",
        name: "Group task action",
        confirm: false,
        group_title: `${MARKER} Do the group thing`,
        group_description: "",
        members: [{ employee_id: ids.closingSales, task_description: "Do it", checklist: null, role: null, custom_role: null }],
        tag_ids: null,
        template_id: null,
        created_by: ids.support,
    },
    {
        action_id: confirmActionId,
        kind: "create_individual_task",
        name: "Confirm-mode action",
        confirm: true,
        decider: [{ type: "employee", id: ids.dealOwner }],
        decider_ids: [ids.dealOwner],
        notification_title: "Decide this",
        stage_name: "Test Stage",
    },
    {
        action_id: unsupportedActionId,
        kind: "send_carrier_pigeon",
        name: "Unsupported action",
        confirm: false,
    },
]

describe("sor_run_stage_actions", () => {
    it("every Stage Action on the stage ends up created or failed with no further client call — simulates the mover closing the tab right after the move", async () => {
        const sorId = await freshSor()
        const client = await clientFor("support")

        const { data: result, error } = await client.rpc("sor_run_stage_actions", {
            p_opportunity_id: sorId,
            p_stage_id: stageId,
            p_stage_visit_id: null,
            p_actions: actionsPayload(),
        })

        expect(error).toBeNull()
        expect(result.failed).toEqual(["Unsupported action"])
        expect(result.created).toHaveLength(2)

        // No further call from here on — everything below reads back what
        // the ONE call above already committed.
        const runs = (
            await svc().from("sor_action_runs").select("action_id, outcome, task_id, group_task_id").eq("opportunity_id", sorId)
        ).data
        const byAction = Object.fromEntries(runs.map((r) => [r.action_id, r]))

        expect(byAction[individualActionId].outcome).toBe("created")
        expect(byAction[individualActionId].task_id).toBeTruthy()
        expect(byAction[groupActionId].outcome).toBe("created")
        expect(byAction[groupActionId].group_task_id).toBeTruthy()
        groupTaskIds.push(byAction[groupActionId].group_task_id)
        expect(byAction[confirmActionId].outcome).toBe("pending")
        expect(byAction[unsupportedActionId].outcome).toBe("failed")

        const task = (await svc().from("tasks").select("logged_by, opportunity_id").eq("id", byAction[individualActionId].task_id).single()).data
        expect(task.opportunity_id).toBe(sorId)
        expect(task.logged_by).toBe(ids.closingSales)

        const groupTask = (
            await svc().from("committee_tasks").select("opportunity_id").eq("id", byAction[groupActionId].group_task_id).single()
        ).data
        expect(groupTask.opportunity_id).toBe(sorId)

        const members = (
            await svc().from("committee_task_members").select("employee_id").eq("committee_task_id", byAction[groupActionId].group_task_id)
        ).data
        expect(members.map((m) => m.employee_id)).toEqual([ids.closingSales])

        // The Optional Action's Decider is still notified even with nobody
        // left on the page to send it.
        const notifications = (
            await svc()
                .from("notifications")
                .select("recipient_id, type")
                .eq("reference_id", sorId)
                .eq("type", "OPPORTUNITY_ACTION_DECISION_DUE")
        ).data
        expect(notifications.map((n) => n.recipient_id)).toEqual([ids.dealOwner])
    })

    it("fire-once holds: a second call for the same stage entry creates no duplicates", async () => {
        const sorId = await freshSor()
        const client = await clientFor("support")

        const first = await client.rpc("sor_run_stage_actions", {
            p_opportunity_id: sorId,
            p_stage_id: stageId,
            p_stage_visit_id: null,
            p_actions: actionsPayload(),
        })
        expect(first.error).toBeNull()
        const firstGroupTaskId = first.data.created.find((c) => c.kind === "create_group_task").group_task_id
        groupTaskIds.push(firstGroupTaskId)

        const second = await client.rpc("sor_run_stage_actions", {
            p_opportunity_id: sorId,
            p_stage_id: stageId,
            p_stage_visit_id: null,
            p_actions: actionsPayload(),
        })
        expect(second.error).toBeNull()
        // Every action was already begun by the first call — nothing pending is left to (re)touch.
        expect(second.data.failed).toEqual([])
        expect(second.data.created).toEqual([])

        const tasksForSor = (await svc().from("tasks").select("id").eq("opportunity_id", sorId)).data
        expect(tasksForSor).toHaveLength(1)

        const groupTasksForSor = (await svc().from("committee_tasks").select("id").eq("opportunity_id", sorId)).data
        expect(groupTasksForSor).toHaveLength(1)

        // Unchanged from the pre-#409 behaviour: a "When confirmed" run
        // stays `pending` until a Decider actually decides it (that's the
        // point of Optional Actions), so sor_begin_action_run's fire-once
        // gate does not suppress a second notify-while-pending — same as
        // the old per-action client loop would have done on a second move
        // attempt. Fire-once here is about the run's OUTCOME never being
        // decided twice, not about how many times "it's still pending" gets
        // re-announced.
        const notifications = (
            await svc()
                .from("notifications")
                .select("id")
                .eq("reference_id", sorId)
                .eq("type", "OPPORTUNITY_ACTION_DECISION_DUE")
        ).data
        expect(notifications).toHaveLength(2)
    })

    it("refuses a caller with no full access to the SOR, and begins nothing", async () => {
        const sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
        sorIds.push(sorId)
        const client = await clientFor("outsider")

        const { error } = await client.rpc("sor_run_stage_actions", {
            p_opportunity_id: sorId,
            p_stage_id: stageId,
            p_stage_visit_id: null,
            p_actions: actionsPayload(),
        })

        expect(error).not.toBeNull()
        expect(error.message).toMatch(/lacks full access/)

        const runs = (await svc().from("sor_action_runs").select("id").eq("opportunity_id", sorId)).data
        expect(runs).toEqual([])
    })
})
