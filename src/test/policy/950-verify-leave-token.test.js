/**
 * verify_form_token recognises a leave (SIL) token. The leave branch once fell
 * back to sil_leaves.updated_at, a column that table does not have, so every
 * leave token raised and the verification page said "Record Not Found".
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest"
import { createHash } from "node:crypto"
import { ids, anonymousClient, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"

const svc = () => serviceClient()
const cleanup = []

// #1134: the verify limiter is keyed on the caller address, so earlier anonymous calls in the
// same run can exhaust it. Start and leave every test with an empty limiter.
const resetLimiter = async () => {
    await serviceClient().from("verification_rate_limits").delete().neq("ip_address", "")
}

beforeEach(resetLimiter)

afterEach(async () => {
    await resetLimiter()
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

describe("verify_form_token limit (#1134)", () => {
    const callWith = async (token, headers) => {
        const { createClient } = await import("@supabase/supabase-js")
        const { API_URL, ANON_KEY } = await import("./support/stack.js")
        return createClient(API_URL, ANON_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
            global: { headers },
        }).rpc("verify_form_token", { lookup_token: token })
    }

    it("raises its own code over the limit, and a made-up X-Forwarded-For does not reset the count", async () => {
        const row = await seedLeave()
        // Same real caller every time; only the made-up header value changes.
        let limited = null
        for (let i = 0; i < 30 && !limited; i++) {
            const { error } = await callWith(row.verification_token, {
                "x-forwarded-for": `10.9.${i}.1`,
            })
            if (error) limited = error
        }
        expect(limited).not.toBeNull()
        expect(limited.code).toBe("VF429")
        expect(limited.message).toBe("verify_rate_limited")
    })

    it("still counts a caller who makes up a Cloudflare address header", async () => {
        const row = await seedLeave()
        let limited = null
        for (let i = 0; i < 30 && !limited; i++) {
            const { error } = await callWith(row.verification_token, {
                "cf-connecting-ip": `10.8.${i}.1`,
            })
            if (error) limited = error
        }
        expect(limited?.code).toBe("VF429")
    })

    it("counts the call before it looks the code up, so a wrong code is limited too", async () => {
        let limited = null
        for (let i = 0; i < 30 && !limited; i++) {
            const { error } = await callWith(`not-a-real-code-${i}`, {})
            if (error) limited = error
        }
        expect(limited?.code).toBe("VF429")
    })

    it("does not limit signed-in HR", async () => {
        const row = await seedLeave()
        const hr = await clientFor("hr")
        for (let i = 0; i < 25; i++) {
            const { error } = await hr.rpc("verify_form_token", { lookup_token: row.verification_token })
            expect(error).toBeNull()
        }
    })
})
