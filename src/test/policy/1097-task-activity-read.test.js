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

beforeAll(async () => {
    await ensureCastLoaded()
    taskId = await makeTask({ loggedBy: ids.ordinary, reportedTo: ids.head })
    const { error } = await svc()
        .from("task_activity")
        .insert({ task_id: taskId, author_id: ids.head, type: "COMMENT", content: `${MARKER} private task note` })
    if (error) throw new Error(`seed note: ${error.message}`)
})

afterAll(async () => {
    if (!taskId) return
    await svc().from("task_activity").delete().eq("task_id", taskId)
    await svc().from("tasks").delete().eq("id", taskId)
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
})
