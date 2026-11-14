/**
 * Group Task chat read rule (#1002, spec #1000 A2).
 *
 * committee_task_activity used to be readable by every signed-in employee. It now follows the Group Task's
 * own read rule: an outsider gets no rows, a member still reads and posts, a Super Admin reads everything.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeGroupTask } from "./support/rows.js"

const svc = () => serviceClient()
let group

beforeAll(async () => {
    await ensureCastLoaded()
    group = await makeGroupTask({ createdBy: ids.head, memberId: ids.ordinary })
    const { error } = await svc()
        .from("committee_task_activity")
        .insert({ task_id: group.taskId, author_id: ids.head, type: "COMMENT", content: `${MARKER} private group hello` })
    if (error) throw new Error(`seed message: ${error.message}`)
})

afterAll(async () => {
    if (!group) return
    await svc().from("committee_task_activity").delete().eq("task_id", group.taskId)
    await svc().from("committee_task_members").delete().eq("committee_task_id", group.taskId)
    await svc().from("committee_tasks").delete().eq("id", group.taskId)
})

describe("committee_task_activity read rule (#1002)", () => {
    it("gives an employee who is not creator, evaluator or member no rows", async () => {
        const client = await clientFor("outsider")
        const { data, error } = await client.from("committee_task_activity").select("id").eq("task_id", group.taskId)
        expect(error).toBeNull()
        expect(data).toEqual([])
    })

    it("lets a member read and post in the chat", async () => {
        const client = await clientFor("ordinary")
        const read = await client.from("committee_task_activity").select("id").eq("task_id", group.taskId)
        expect(read.error).toBeNull()
        expect(read.data.length).toBe(1)

        const post = await client
            .from("committee_task_activity")
            .insert({ task_id: group.taskId, author_id: ids.ordinary, type: "COMMENT", content: `${MARKER} member reply` })
            .select("id")
            .single()
        expect(post.error).toBeNull()
        expect(post.data.id).toBeTruthy()
    })

    it("lets a Super Admin read everything", async () => {
        const client = await clientFor("superAdmin")
        const { data, error } = await client.from("committee_task_activity").select("id").eq("task_id", group.taskId)
        expect(error).toBeNull()
        expect(data.length).toBeGreaterThanOrEqual(1)
    })
})
