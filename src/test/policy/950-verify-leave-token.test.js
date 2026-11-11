/**
 * verify_form_token recognises a leave (SIL) token. The leave branch once fell
 * back to sil_leaves.updated_at, a column that table does not have, so every
 * leave token raised and the verification page said "Record Not Found".
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest"
import { createHash } from "node:crypto"
import { ids, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"

const svc = () => serviceClient()
const cleanup = []

afterEach(async () => {
    while (cleanup.length) await cleanup.pop()()
})

beforeAll(async () => {
    await ensureCastLoaded()
})

async function seedLeave({ status = "APPROVED", processed = true } = {}) {
    const groupId = crypto.randomUUID()
    const date = "2026-03-10"
    const reason = "[policy-tier] private reason"
    const applicationHash = createHash("sha256").update(`${ids.ordinary}||${date}|8|${reason}`).digest("hex")
    const { data, error } = await svc()
        .from("sil_leaves")
        .insert({
            employee_id: ids.ordinary,
            date,
            hours: 8,
            reason,
            status,
            leave_group_id: groupId,
            application_hash: applicationHash,
            ...(processed ? { hr_processed_by: ids.hr, hr_processed_at: new Date().toISOString() } : {}),
        })
        .select("id, verification_token")
        .single()
    if (error) throw new Error(`Seeding sil_leaves: ${error.message}`)
    cleanup.push(async () => {
        await svc().from("sil_leaves").delete().eq("leave_group_id", groupId)
    })
    return data
}

describe("verify_form_token for a leave", () => {
    it("returns the record to an anonymous caller, without the reason", async () => {
        const row = await seedLeave()
        const { data, error } = await anonymousClient().rpc("verify_form_token", { lookup_token: row.verification_token })
        expect(error).toBeNull()
        expect(data.form_type).toBe("Leave")
        expect(data.status).toBe("APPROVED")
        expect(data.application_valid).toBe(true)
        expect(JSON.stringify(data)).not.toContain("private reason")
    })

    it("still answers for a leave HR has not processed", async () => {
        const row = await seedLeave({ status: "PENDING", processed: false })
        const { data, error } = await anonymousClient().rpc("verify_form_token", { lookup_token: row.verification_token })
        expect(error).toBeNull()
        expect(data.status).toBe("PENDING")
        expect(data.approval_date).toBeNull()
    })
})
