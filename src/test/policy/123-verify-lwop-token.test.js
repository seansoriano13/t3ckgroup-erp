/**
 * #621 (spec #609): verify_form_token recognises an LWOP token, returns the record's live status,
 * and the reason stays behind lwop_leaves RLS (HR and the employee only).
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest"
import { createHash } from "node:crypto"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"

const svc = () => serviceClient()
const cleanup = []

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()()
})

beforeAll(async () => {
    await ensureCastLoaded()
})

async function seedLwop({ status = "APPROVED" } = {}) {
    const groupId = crypto.randomUUID()
    const date = "2026-03-10"
    const reason = "[policy-tier] private reason"
    const applicationHash = createHash("sha256").update(`${ids.ordinary}||${date}|8|${reason}`).digest("hex")
    const approvalHash = createHash("sha256").update(`${applicationHash}|${status}|${ids.hr}|`).digest("hex")
    const { data, error } = await svc()
        .from("lwop_leaves")
        .insert({
            employee_id: ids.ordinary,
            date,
            hours: 8,
            reason,
            status,
            leave_group_id: groupId,
            application_hash: applicationHash,
            approval_hash: approvalHash,
            hr_processed_by: ids.hr,
            hr_processed_at: new Date().toISOString(),
        })
        .select("id, verification_token")
        .single()
    if (error) throw new Error(`Seeding lwop_leaves: ${error.message}`)
    cleanup.push(async () => {
        await svc().from("lwop_leaves").delete().eq("leave_group_id", groupId)
    })
    return data
}

describe("verify_form_token for an LWOP", () => {
    it("returns the record's live status to an anonymous caller, without the reason", async () => {
        const row = await seedLwop()
        const { data, error } = await anonymousClient().rpc("verify_form_token", { lookup_token: row.verification_token })
        expect(error).toBeNull()
        expect(data.form_type).toBe("LWOP")
        expect(data.status).toBe("APPROVED")
        expect(data.application_valid).toBe(true)
        expect(data.approval_valid).toBe(true)
        expect(JSON.stringify(data)).not.toContain("private reason")

        await svc().from("lwop_leaves").update({ status: "CANCELLED" }).eq("id", row.id)
        const again = await anonymousClient().rpc("verify_form_token", { lookup_token: row.verification_token })
        expect(again.data.status).toBe("CANCELLED")
    })

    it("opens the reason to the employee and HR, and to nobody else", async () => {
        const row = await seedLwop()
        const read = async (key) => (await (await clientFor(key)).from("lwop_leaves").select("reason").eq("id", row.id)).data
        expect(await read("ordinary")).toHaveLength(1)
        expect(await read("hr")).toHaveLength(1)
        expect(await read("outsider")).toHaveLength(0)
        const anon = await anonymousClient().from("lwop_leaves").select("reason").eq("id", row.id)
        expect(anon.data ?? []).toHaveLength(0)
    })
})
