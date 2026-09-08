/**
 * Issue #128 — the impersonation account is now a boolean capability
 * (`is_role_simulator`) instead of a literal email inside the `employees`
 * UPDATE policy. Seam A: this only proves anything run through an ordinary
 * client's own token, never the service role.
 *
 * Two identities, seeded here rather than added to the shared CAST — flipping
 * a global capability flag on the cast would change who the rest of the
 * matrix (02-policies.test.js) says may edit an SOR or approve a task.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createClient } from "@supabase/supabase-js"
import { API_URL, ANON_KEY, serviceClient } from "./support/stack.js"
import { FIXTURE_DOMAIN, CAST_PASSWORD } from "./support/cast.js"
import { tryUpdate } from "./support/access.js"

const FLAGGED_EMAIL = `role-simulator@${FIXTURE_DOMAIN}`
const UNFLAGGED_EMAIL = `role-simulator-unflagged@${FIXTURE_DOMAIN}`

const ids = {}
const clients = {}

async function seed(email, isRoleSimulator) {
    const svc = serviceClient()
    const { data, error } = await svc.auth.admin.createUser({
        email,
        password: CAST_PASSWORD,
        email_confirm: true,
    })
    if (error) throw new Error(`Creating auth user ${email}: ${error.message}`)

    const { error: empError } = await svc.from("employees").insert({
        id: data.user.id,
        email,
        name: isRoleSimulator ? "Role Simulator" : "Not A Role Simulator",
        department: "OPERATIONS",
        sub_department: null,
        role: "TEST",
        employment_status: "Regular",
        is_role_simulator: isRoleSimulator,
        offset_hours_balance: 0,
        sil_hours_balance: 0,
    })
    if (empError) throw new Error(`Seeding employee ${email}: ${empError.message}`)

    return data.user.id
}

async function clientFor(email) {
    const client = createClient(API_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error } = await client.auth.signInWithPassword({ email, password: CAST_PASSWORD })
    if (error) throw new Error(`Signing in as ${email}: ${error.message}`)
    return client
}

beforeAll(async () => {
    ids.flagged = await seed(FLAGGED_EMAIL, true)
    ids.unflagged = await seed(UNFLAGGED_EMAIL, false)
    clients.flagged = await clientFor(FLAGGED_EMAIL)
    clients.unflagged = await clientFor(UNFLAGGED_EMAIL)
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("employees").delete().in("id", [ids.flagged, ids.unflagged])
    await svc.auth.admin.deleteUser(ids.flagged)
    await svc.auth.admin.deleteUser(ids.unflagged)
})

describe("is_role_simulator capability on the employees UPDATE policy", () => {
    it("lets a flagged account update another employee's row", async () => {
        const result = await tryUpdate(clients.flagged, "employees", ids.unflagged, {
            name: "Renamed By Simulator",
        })
        expect(result.ok, result.message).toBe(true)
        expect(result.affected).toBe(1)
    })

    it("refuses an unflagged account updating another employee's row", async () => {
        const result = await tryUpdate(clients.unflagged, "employees", ids.flagged, {
            name: "Should Not Land",
        })
        expect(result.ok, result.message).toBe(true)
        expect(result.affected).toBe(0)
    })
})
