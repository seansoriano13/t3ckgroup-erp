/**
 * Issue #136 — nobody edits their own hidden_nav_keys override, not even HR
 * or a Super Admin; HR and Super Admins may edit anyone else's. Governed by
 * the same prevent_role_escalation trigger that guards the capability flags
 * (see 20260908093616_hidden_nav_overrides.sql).
 *
 * Seam A: every assertion runs through an ordinary client holding a real
 * signed-in user's token, never the service role.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createClient } from "@supabase/supabase-js"
import { API_URL, ANON_KEY, serviceClient } from "./support/stack.js"
import { FIXTURE_DOMAIN, CAST_PASSWORD } from "./support/cast.js"
import { tryUpdate } from "./support/access.js"

const HR_EMAIL = `nav-override-hr@${FIXTURE_DOMAIN}`
const SUPER_ADMIN_EMAIL = `nav-override-super-admin@${FIXTURE_DOMAIN}`
const ORDINARY_EMAIL = `nav-override-ordinary@${FIXTURE_DOMAIN}`

const ids = {}
const clients = {}

async function seed(email, extra = {}) {
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
        name: email.split("@")[0],
        department: "OPERATIONS",
        sub_department: null,
        role: "TEST",
        employment_status: "Regular",
        offset_hours_balance: 0,
        sil_hours_balance: 0,
        hidden_nav_keys: [],
        ...extra,
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
    ids.hr = await seed(HR_EMAIL, { is_hr: true })
    ids.superAdmin = await seed(SUPER_ADMIN_EMAIL, { is_super_admin: true })
    ids.ordinary = await seed(ORDINARY_EMAIL, {})
    clients.hr = await clientFor(HR_EMAIL)
    clients.superAdmin = await clientFor(SUPER_ADMIN_EMAIL)
    clients.ordinary = await clientFor(ORDINARY_EMAIL)
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("employees").delete().in("id", [ids.hr, ids.superAdmin, ids.ordinary])
    await svc.auth.admin.deleteUser(ids.hr)
    await svc.auth.admin.deleteUser(ids.superAdmin)
    await svc.auth.admin.deleteUser(ids.ordinary)
})

describe("hidden_nav_keys write path", () => {
    it("lets HR set another employee's overrides", async () => {
        const result = await tryUpdate(clients.hr, "employees", ids.ordinary, {
            hidden_nav_keys: ["workspace.dashboard"],
        })
        expect(result.ok, result.message).toBe(true)
        expect(result.affected).toBe(1)

        const { data } = await serviceClient().from("employees").select("hidden_nav_keys").eq("id", ids.ordinary).single()
        expect(data.hidden_nav_keys).toEqual(["workspace.dashboard"])
    })

    it("lets a Super Admin set another employee's overrides", async () => {
        const result = await tryUpdate(clients.superAdmin, "employees", ids.ordinary, {
            hidden_nav_keys: ["workspace.myTasks"],
        })
        expect(result.ok, result.message).toBe(true)
        expect(result.affected).toBe(1)

        const { data } = await serviceClient().from("employees").select("hidden_nav_keys").eq("id", ids.ordinary).single()
        expect(data.hidden_nav_keys).toEqual(["workspace.myTasks"])
    })

    it("refuses an ordinary employee setting their own overrides", async () => {
        const result = await tryUpdate(clients.ordinary, "employees", ids.ordinary, {
            hidden_nav_keys: ["workspace.dashboard"],
        })
        // The row-update itself is allowed (an employee may edit their own
        // profile); the trigger silently reverts just this field.
        expect(result.ok, result.message).toBe(true)

        const { data } = await serviceClient().from("employees").select("hidden_nav_keys").eq("id", ids.ordinary).single()
        expect(data.hidden_nav_keys).not.toEqual(["workspace.dashboard"])
    })

    it("refuses HR setting their own overrides", async () => {
        const before = await serviceClient().from("employees").select("hidden_nav_keys").eq("id", ids.hr).single()

        const result = await tryUpdate(clients.hr, "employees", ids.hr, {
            hidden_nav_keys: ["workspace.dashboard"],
        })
        expect(result.ok, result.message).toBe(true)

        const after = await serviceClient().from("employees").select("hidden_nav_keys").eq("id", ids.hr).single()
        expect(after.data.hidden_nav_keys).toEqual(before.data.hidden_nav_keys)
    })

    it("refuses a Super Admin setting their own overrides", async () => {
        const before = await serviceClient().from("employees").select("hidden_nav_keys").eq("id", ids.superAdmin).single()

        const result = await tryUpdate(clients.superAdmin, "employees", ids.superAdmin, {
            hidden_nav_keys: ["workspace.dashboard"],
        })
        expect(result.ok, result.message).toBe(true)

        const after = await serviceClient().from("employees").select("hidden_nav_keys").eq("id", ids.superAdmin).single()
        expect(after.data.hidden_nav_keys).toEqual(before.data.hidden_nav_keys)
    })
})
