/**
 * Task activity read rule (#1097, spec #1093 A3).
 *
 * task_activity used to be readable by every signed-in employee. It now follows the task: an outsider gets
 * no rows, the logger and the reporter still read, a Super Admin reads everything.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeTask } from "./support/rows.js"

const svc = () => serviceClient()
let taskId
let otherDeptTaskId

beforeAll(async () => {
    await ensureCastLoaded()
    taskId = await makeTask({ loggedBy: ids.ordinary, reportedTo: ids.head })
    const { error } = await svc()
        .from("task_activity")
        .insert({ task_id: taskId, author_id: ids.head, type: "COMMENT", content: `${MARKER} private task note` })
    if (error) throw new Error(`seed note: ${error.message}`)
    // An OPERATIONS task nobody in SALES is on.
    otherDeptTaskId = await makeTask({ loggedBy: ids.outsider })
    const other = await svc()
        .from("task_activity")
        .insert({ task_id: otherDeptTaskId, author_id: ids.outsider, type: "COMMENT", content: `${MARKER} ops note` })
    if (other.error) throw new Error(`seed ops note: ${other.error.message}`)
})

afterAll(async () => {
    for (const id of [taskId, otherDeptTaskId].filter(Boolean)) {
        await svc().from("task_activity").delete().eq("task_id", id)
        await svc().from("tasks").delete().eq("id", id)
    }
})

describe("task_activity read rule (#1097)", () => {
    it("gives an employee with no part in the task no rows", async () => {
        const client = await clientFor("outsider")
        const { data, error } = await client.from("task_activity").select("id").eq("task_id", taskId)
        expect(error).toBeNull()
        expect(data).toEqual([])
    })

    it("lets the employee who logged the task read its activity", async () => {
        const client = await clientFor("ordinary")
        const { data, error } = await client.from("task_activity").select("id").eq("task_id", taskId)
        expect(error).toBeNull()
        expect(data.length).toBe(1)
    })

    it("lets the reporter read and lets a Super Admin read everything", async () => {
        for (const who of ["head", "superAdmin"]) {
            const client = await clientFor(who)
            const { data, error } = await client.from("task_activity").select("id").eq("task_id", taskId)
            expect(error).toBeNull()
            expect(data.length).toBeGreaterThanOrEqual(1)
        }
    })

    it("lets a head read a task in their own department they are not on", async () => {
        const client = await clientFor("subHead")
        const { data, error } = await client.from("task_activity").select("id").eq("task_id", taskId)
        expect(error).toBeNull()
        expect(data.length).toBe(1)
    })

    it("gives a head no rows for a task in another department", async () => {
        const client = await clientFor("head")
        const { data, error } = await client.from("task_activity").select("id").eq("task_id", otherDeptTaskId)
        expect(error).toBeNull()
        expect(data).toEqual([])
    })
})
