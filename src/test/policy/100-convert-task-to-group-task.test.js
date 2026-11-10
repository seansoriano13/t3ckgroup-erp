/**
 * Convert a task into a Group Task (#657, spec #646): the RPC refuses anyone who may not manage
 * Group Tasks, refuses Stage Action / submitted / approved / cancelled tasks, and for a head carries
 * the title, description, checklist, attachments and chat history over to the new Group Task, with
 * the owner as first member.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const createdTasks = []
const createdGroups = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const makeTask = async (extra = {}) => {
    const row = await asSvc(
        svc()
            .from("tasks")
            .insert({
                logged_by: ids.ordinary,
                reported_to: ids.head,
                task_description: `${MARKER} Prepare the quarterly stock count`,
                project_title: `${MARKER} Stock count`,
                status: "INCOMPLETE",
                checklist: [{ id: "c1", text: "Count shelf A", done: true }],
                attachment_urls: ["https://example.test/stock.pdf"],
                ...extra,
            })
            .select("id")
            .single(),
        "task",
    )
    createdTasks.push(row.id)
    return row.id
}

beforeAll(async () => {
    await ensureCastLoaded()
})

afterAll(async () => {
    for (const taskId of createdTasks) {
        await svc().from("task_activity").delete().eq("task_id", taskId)
        await svc().from("tasks").delete().eq("id", taskId)
    }
    for (const groupId of createdGroups) {
        await svc().from("system_audit_logs").delete().eq("entity_id", groupId)
        await svc().from("committee_task_activity").delete().eq("task_id", groupId)
        await svc().from("committee_task_logs").delete().eq("committee_task_id", groupId)
        await svc().from("committee_task_members").delete().eq("committee_task_id", groupId)
        await svc().from("committee_tasks").delete().eq("id", groupId)
    }
})

describe("convert_task_to_group_task", () => {
    it("refuses someone who may not manage Group Tasks", async () => {
        const taskId = await makeTask()
        const client = await clientFor("ordinary")
        const { data, error } = await client.rpc("convert_task_to_group_task", { p_task_id: taskId, p_member_ids: [] })
        expect(data).toBeNull()
        expect(error?.code).toBe("42501")
        const task = await asSvc(svc().from("tasks").select("status, converted_to_group_task_id").eq("id", taskId).single(), "task")
        expect(task.converted_to_group_task_id).toBeNull()
    })

    it("refuses submitted, approved and cancelled tasks", async () => {
        const head = await clientFor("head")
        for (const status of ["AWAITING APPROVAL", "COMPLETED", "DELETED"]) {
            const taskId = await makeTask({ status })
            const { error } = await head.rpc("convert_task_to_group_task", { p_task_id: taskId, p_member_ids: [] })
            expect(error?.message, status).toMatch(/open task/)
        }
    })

    it("carries the task and its history over for a head", async () => {
        const taskId = await makeTask()
        await asSvc(
            svc().from("task_activity").insert([
                { task_id: taskId, author_id: ids.ordinary, type: "COMMENT", content: "Started on shelf A" },
                { task_id: taskId, author_id: ids.head, type: "COMMENT", content: "Thanks, keep going" },
            ]),
            "history",
        )
        const head = await clientFor("head")
        const { data: groupId, error } = await head.rpc("convert_task_to_group_task", {
            p_task_id: taskId,
            p_member_ids: [ids.support],
        })
        expect(error).toBeNull()
        createdGroups.push(groupId)

        const group = await asSvc(svc().from("committee_tasks").select("*").eq("id", groupId).single(), "group")
        expect(group.title).toContain("Stock count")
        expect(group.description).toContain("quarterly stock count")

        const members = await asSvc(svc().from("committee_task_members").select("*").eq("committee_task_id", groupId), "members")
        expect(members.map((m) => m.employee_id).sort()).toEqual([ids.ordinary, ids.support].sort())
        const owner = members.find((m) => m.employee_id === ids.ordinary)
        expect(owner.checklist).toEqual([{ id: "c1", text: "Count shelf A", done: true }])
        expect(owner.attachments).toEqual(["https://example.test/stock.pdf"])

        const history = await asSvc(svc().from("committee_task_activity").select("content").eq("task_id", groupId), "activity")
        expect(history.map((h) => h.content).sort()).toEqual(["Started on shelf A", "Thanks, keep going"])

        const old = await asSvc(svc().from("tasks").select("status, converted_to_group_task_id").eq("id", taskId).single(), "old")
        expect(old.status).toBe("DELETED")
        expect(old.converted_to_group_task_id).toBe(groupId)

        const audit = await asSvc(svc().from("system_audit_logs").select("type").eq("entity_id", groupId), "audit")
        expect(audit.some((a) => a.type === "TASK_CONVERTED")).toBe(true)
    })
})
