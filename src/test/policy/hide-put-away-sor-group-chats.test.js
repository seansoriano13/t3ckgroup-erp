/**
 * Group chats of an archived or deleted SOR leave the chat list, and come back when the SOR does.
 * The Group Task itself is untouched and still opens for its members.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor, makeGroupTask } from "./support/rows.js"

const svc = () => serviceClient()
let sorId
let group

const chatKeys = async () => {
    const client = await clientFor("ordinary")
    const { data, error } = await client.rpc("get_user_active_chats", { p_user_id: ids.ordinary, p_limit: 200 })
    expect(error).toBeNull()
    return new Set(data.map((r) => `${r.entity_type}:${r.entity_id}`))
}

const setSor = async (patch) => {
    const { error } = await svc().from("sales_opportunities").update(patch).eq("id", sorId)
    if (error) throw new Error(`Updating the SOR: ${error.message}`)
}

beforeAll(async () => {
    await ensureCastLoaded()
    sorId = await makeSor({ registeredBy: ids.head })
    group = await makeGroupTask({ createdBy: ids.head, memberId: ids.ordinary })
    const linked = await svc().from("committee_tasks").update({ opportunity_id: sorId }).eq("id", group.taskId)
    if (linked.error) throw new Error(`Linking the Group Task: ${linked.error.message}`)
    const said = await svc()
        .from("committee_task_activity")
        .insert({ task_id: group.taskId, author_id: ids.head, type: "COMMENT", content: `${MARKER} sor group hello` })
    if (said.error) throw new Error(`Group comment: ${said.error.message}`)
})

afterAll(async () => {
    if (group) {
        await svc().from("committee_task_activity").delete().eq("task_id", group.taskId)
        await svc().from("committee_task_members").delete().eq("committee_task_id", group.taskId)
        await svc().from("committee_tasks").delete().eq("id", group.taskId)
    }
    if (sorId) await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("Group chats of a put-away SOR", () => {
    it("shows while the SOR is live", async () => {
        expect(await chatKeys()).toContain(`COMMITTEE_TASK:${group.taskId}`)
    })

    it("hides while the SOR is archived, and comes back on un-archive", async () => {
        await setSor({ archived_at: new Date().toISOString() })
        expect(await chatKeys()).not.toContain(`COMMITTEE_TASK:${group.taskId}`)
        await setSor({ archived_at: null })
        expect(await chatKeys()).toContain(`COMMITTEE_TASK:${group.taskId}`)
    })

    it("hides while the SOR is deleted, and comes back on restore", async () => {
        await setSor({ is_deleted: true })
        expect(await chatKeys()).not.toContain(`COMMITTEE_TASK:${group.taskId}`)
        await setSor({ is_deleted: false })
        expect(await chatKeys()).toContain(`COMMITTEE_TASK:${group.taskId}`)
    })
})
