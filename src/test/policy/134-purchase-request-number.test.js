/**
 * Purchase Request numbers (#683, 20261104100000_purchase_request_number.sql):
 * PR_ and four digits from a sequence, on Project and Direct requests alike,
 * never reused and never changed, and the queue carries it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor, MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const SHAPE = /^PR_\d{4,}$/

let sorId, project, direct

async function insert(row) {
    const { data, error } = await svc().from("purchase_requests").insert(row).select("id, pr_number").single()
    if (error) throw new Error(`Seeding purchase_requests: ${error.message}`)
    return data
}

beforeAll(async () => {
    await ensureCastLoaded()
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    project = await insert({ opportunity_id: sorId, created_by: ids.dealOwner })
    direct = await insert({ created_by: ids.stageParticipant, buyer_id: ids.stageParticipant, title: `${MARKER} Direct` })
    // The queue lists what the caller may read; the Buyer reads it as a member.
    const member = await svc().from("purchase_request_members").insert({ request_id: direct.id, employee_id: ids.stageParticipant, side: "purchasing" })
    if (member.error) throw member.error
})

afterAll(async () => {
    await svc().from("purchase_requests").delete().in("id", [project?.id, direct?.id].filter(Boolean))
    if (sorId) await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("a Purchase Request's number", () => {
    it("is given to a Project and a Direct request, and never repeats", () => {
        expect(project.pr_number).toMatch(SHAPE)
        expect(direct.pr_number).toMatch(SHAPE)
        expect(project.pr_number).not.toBe(direct.pr_number)
    })

    it("ignores a number the client sends", async () => {
        const row = await insert({ created_by: ids.stageParticipant, title: `${MARKER} Chosen`, pr_number: "PR_9999" })
        await svc().from("purchase_requests").delete().eq("id", row.id)
        expect(row.pr_number).not.toBe("PR_9999")
    })

    it("is never changed", async () => {
        const { error } = await svc().from("purchase_requests").update({ pr_number: "PR_0001" }).eq("id", direct.id)
        expect(error?.code).toBe("42501")
    })

    it("is in the queue", async () => {
        const { data, error } = await (await clientFor("stageParticipant")).rpc("purchase_request_queue", { p_request_id: direct.id })
        expect(error).toBeNull()
        expect(data[0].pr_number).toBe(direct.pr_number)
    })
})
