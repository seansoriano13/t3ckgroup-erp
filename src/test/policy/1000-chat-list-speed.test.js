/**
 * Chat list and Group Task list speed (#1001, spec #1000 A1).
 *
 * `get_user_active_chats` and `GET committee_tasks` timed out (HTTP 500, 57014) for a normal employee:
 * the read rules ran the caller lookup once per row and the Group Task member rule ran
 * committee_task_visible() per member row. The fix keeps every answer the same and only changes the shape,
 * so this file checks three things: a staff user's call finishes well inside the statement timeout, the
 * chat list still returns the person's own chats (a Task they commented on, a Group Task they belong to),
 * and the Group Task list still shows members their task and hides it from outsiders.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeGroupTask } from "./support/rows.js"

const svc = () => serviceClient()

// The hosted statement timeout for authenticated is 8s; the call has to be nowhere near it.
const BUDGET_MS = 5000

let taskId
let group

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

beforeAll(async () => {
    await ensureCastLoaded()
    taskId = (
        await asSvc(
            svc()
                .from("tasks")
                .insert({
                    logged_by: ids.ordinary,
                    reported_to: ids.head,
                    task_description: `${MARKER} Chat speed task`,
                    project_title: `${MARKER} Chat speed`,
                    status: "INCOMPLETE",
                })
                .select("id")
                .single(),
            "task",
        )
    ).id
    await asSvc(
        svc().from("task_activity").insert({ task_id: taskId, author_id: ids.ordinary, type: "COMMENT", content: `${MARKER} hello` }),
        "task comment",
    )
    group = await makeGroupTask({ createdBy: ids.head, memberId: ids.ordinary })
    await asSvc(
        svc().from("committee_task_activity").insert({ task_id: group.taskId, author_id: ids.head, type: "COMMENT", content: `${MARKER} group hello` }),
        "group comment",
    )
})

afterAll(async () => {
    if (taskId) {
        await svc().from("task_activity").delete().eq("task_id", taskId)
        await svc().from("tasks").delete().eq("id", taskId)
    }
    if (group) {
        await svc().from("committee_task_activity").delete().eq("task_id", group.taskId)
        await svc().from("committee_task_members").delete().eq("committee_task_id", group.taskId)
        await svc().from("committee_tasks").delete().eq("id", group.taskId)
    }
})

describe("get_user_active_chats as a staff user (#1001)", () => {
    it("returns inside the statement timeout, with the person's Task and Group Task chats", async () => {
        const client = await clientFor("ordinary")
        const started = Date.now()
        const { data, error } = await client.rpc("get_user_active_chats", { p_user_id: ids.ordinary, p_limit: 30 })
        const took = Date.now() - started

        expect(error).toBeNull()
        expect(took).toBeLessThan(BUDGET_MS)
        const byKey = (rows) => new Set(rows.map((r) => `${r.entity_type}:${r.entity_id}`))
        expect(byKey(data)).toContain(`TASK:${taskId}`)
        expect(byKey(data)).toContain(`COMMITTEE_TASK:${group.taskId}`)
    })

    it("returns one row per chat, newest message first", async () => {
        const client = await clientFor("ordinary")
        const { data, error } = await client.rpc("get_user_active_chats", { p_user_id: ids.ordinary, p_limit: 30 })
        expect(error).toBeNull()
        const keys = data.map((r) => `${r.entity_type}:${r.entity_id}`)
        expect(new Set(keys).size).toBe(keys.length)
        const times = data.map((r) => new Date(r.latest_created_at).getTime())
        expect(times).toEqual([...times].sort((a, b) => b - a))
    })
})

describe("Group Task list as a staff user (#1001)", () => {
    it("loads inside the statement timeout and shows a task the person is a member of", async () => {
        const client = await clientFor("ordinary")
        const started = Date.now()
        const { data, error } = await client.from("committee_tasks").select("id").order("created_at", { ascending: false })
        const took = Date.now() - started

        expect(error).toBeNull()
        expect(took).toBeLessThan(BUDGET_MS)
        expect(data.map((r) => r.id)).toContain(group.taskId)
    })

    it("still hides a task from someone who is not a member", async () => {
        const client = await clientFor("outsider")
        const { data, error } = await client.from("committee_tasks").select("id").eq("id", group.taskId)
        expect(error).toBeNull()
        expect(data).toEqual([])
    })
})
