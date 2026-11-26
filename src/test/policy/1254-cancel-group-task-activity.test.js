/**
 * Cancelling a Group Task cancels its Calendar entry (#1254, spec #1246).
 *
 *   anyone who may cancel the Group Task can cancel its Activity, even when someone else filed it
 *   refused unless the Group Task is already Cancelled
 *   refused for someone who may not cancel the Group Task
 *   the Activity ends Cancelled with the reason "Group Task cancelled"; a declined one is not touched
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeGroupTask } from "./support/rows.js"
import { ahead } from "./support/dates.js"

const svc = () => serviceClient()
const created = []
const tasks = []
let n = 0

const setup = async () => {
    const { taskId } = await makeGroupTask({ createdBy: ids.head, memberId: ids.ordinary })
    tasks.push(taskId)
    n += 1
    const d = Date.UTC(...ahead(210 + n), 1, 0, 0)
    const { data, error } = await (await clientFor("ordinary")).rpc("file_meeting_request", {
        p_venue_id: null,
        p_starts_at: new Date(d).toISOString(),
        p_ends_at: new Date(d + 3_600_000).toISOString(),
        p_facilitator_id: ids.ordinary,
        p_purpose: "x",
        p_guests: [],
        p_participant_ids: [ids.ordinary],
        p_activity_type: "GROUP_TASK",
        p_group_task_id: taskId,
    })
    expect(error).toBeNull()
    created.push(data)
    return { taskId, requestId: data }
}
const cancelTask = (taskId) => svc().from("committee_tasks").update({ status: "CANCELLED" }).eq("id", taskId)
const call = async (who, taskId) => (await clientFor(who)).rpc("cancel_group_task_activity", { p_group_task_id: taskId })
const row = async (id) => (await svc().from("meeting_requests").select("*").eq("id", id).single()).data

beforeAll(async () => {
    await ensureCastLoaded()
})
afterAll(async () => {
    if (created.length) {
        await svc().from("notifications").delete().in("reference_id", created)
        await svc().from("meeting_requests").delete().in("id", created)
    }
    if (tasks.length) {
        await svc().from("committee_task_members").delete().in("committee_task_id", tasks)
        await svc().from("committee_tasks").delete().in("id", tasks)
    }
})

describe("cancel_group_task_activity", () => {
    it("a head who did not file it cancels it, with the reason", async () => {
        const { taskId, requestId } = await setup()
        await cancelTask(taskId)
        const { data, error } = await call("head", taskId)
        expect(error).toBeNull()
        expect(data).toMatchObject({ id: requestId, to_status: "CANCELLED", from_status: "APPROVED", applicant_id: ids.ordinary })
        expect(data.participant_ids).toContain(ids.ordinary)
        expect(await row(requestId)).toMatchObject({ status: "CANCELLED", cancel_reason: "Group Task cancelled", cancelled_by: ids.head })
    })

    it("HR and a Super Admin may too", async () => {
        for (const who of ["hr", "superAdmin"]) {
            const { taskId, requestId } = await setup()
            await cancelTask(taskId)
            expect((await call(who, taskId)).error).toBeNull()
            expect((await row(requestId)).status).toBe("CANCELLED")
        }
    })

    it("is refused while the Group Task is not Cancelled", async () => {
        const { taskId, requestId } = await setup()
        const { error } = await call("head", taskId)
        expect(error?.message).toMatch(/Cancel the Group Task first/)
        expect((await row(requestId)).status).toBe("APPROVED")
    })

    it("is refused for someone who may not cancel the Group Task, even the filer", async () => {
        const { taskId, requestId } = await setup()
        await cancelTask(taskId)
        const { error } = await call("ordinary", taskId)
        expect(error?.code).toBe("42501")
        expect((await row(requestId)).status).toBe("APPROVED")
    })

    it("is refused for a non-manager even on a Stage Action Group Task (the Group Task window offers cancel to managers only)", async () => {
        const { taskId, requestId } = await setup()
        const { data: action } = await svc().from("flow_stage_actions").select("id").limit(1).maybeSingle()
        const { data: opp } = await svc().from("opportunities").select("id").limit(1).maybeSingle()
        if (!action || !opp) return
        await svc().from("committee_tasks").update({ stage_action_id: action.id, opportunity_id: opp.id }).eq("id", taskId)
        await cancelTask(taskId)
        const { error } = await call("ordinary", taskId)
        expect(error?.code).toBe("42501")
        expect((await row(requestId)).status).toBe("APPROVED")
    })

    it("says so when there is no live Activity", async () => {
        const { taskId, requestId } = await setup()
        await svc().from("meeting_requests").update({ status: "DECLINED" }).eq("id", requestId)
        await cancelTask(taskId)
        const { error } = await call("head", taskId)
        expect(error?.message).toMatch(/no live Activity/)
        expect((await row(requestId)).status).toBe("DECLINED")
    })
})
