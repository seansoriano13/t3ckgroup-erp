/**
 * #884 (spec #907 decision 5) — only a Super Admin may give the Flow editor
 * flag (`can_edit_sales_flows`), on a new employee or on an existing one.
 *
 * The update path is guarded by prevent_role_escalation (20261013100700). The
 * insert path had no guard, so 20261123000000_flow_editor_insert_guard.sql adds
 * one: an HR user could otherwise create an employee already holding the flag.
 *
 * Seam A: every assertion runs through an ordinary client holding a real
 * signed-in user's token, never the service role (except for seeding and
 * reading back what actually landed).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createClient } from "@supabase/supabase-js"
import { API_URL, ANON_KEY, serviceClient } from "./support/stack.js"
import { FIXTURE_DOMAIN, CAST_PASSWORD } from "./support/cast.js"
import { tryInsert, tryUpdate, RLS_VIOLATION } from "./support/access.js"

const HR_EMAIL = `flow-editor-hr@${FIXTURE_DOMAIN}`
const SUPER_ADMIN_EMAIL = `flow-editor-super-admin@${FIXTURE_DOMAIN}`
const ORDINARY_EMAIL = `flow-editor-ordinary@${FIXTURE_DOMAIN}`
const NEW_EMAIL_PREFIX = `flow-editor-new-`

const ids = {}
const clients = {}
const createdIds = []

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

function newRow(suffix, extra = {}) {
    return {
        email: `${NEW_EMAIL_PREFIX}${suffix}@${FIXTURE_DOMAIN}`,
        name: `New ${suffix}`,
        department: "OPERATIONS",
        sub_department: null,
        role: "TEST",
        employment_status: "Regular",
        offset_hours_balance: 0,
        sil_hours_balance: 0,
        hidden_nav_keys: [],
        ...extra,
    }
}

async function flowFlag(id) {
    const { data, error } = await serviceClient().from("employees").select("can_edit_sales_flows").eq("id", id).single()
    if (error) throw new Error(`Reading flag for ${id}: ${error.message}`)
    return data.can_edit_sales_flows
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
    if (createdIds.length) await svc.from("employees").delete().in("id", createdIds)
    await svc.from("employees").delete().like("email", `${NEW_EMAIL_PREFIX}%`)
    await svc.from("employees").delete().in("id", [ids.hr, ids.superAdmin, ids.ordinary])
    await svc.auth.admin.deleteUser(ids.hr)
    await svc.auth.admin.deleteUser(ids.superAdmin)
    await svc.auth.admin.deleteUser(ids.ordinary)
})

describe("can_edit_sales_flows write path, existing employee", () => {
    it("refuses HR granting another employee the Flow editor flag", async () => {
        const result = await tryUpdate(clients.hr, "employees", ids.ordinary, { can_edit_sales_flows: true })
        expect(result.ok).toBe(false)
        expect(result.code).toBe(RLS_VIOLATION)
        expect(await flowFlag(ids.ordinary)).toBe(false)
    })

    it("refuses an ordinary employee granting themselves the Flow editor flag", async () => {
        const result = await tryUpdate(clients.ordinary, "employees", ids.ordinary, { can_edit_sales_flows: true })
        expect(result.ok).toBe(false)
        expect(await flowFlag(ids.ordinary)).toBe(false)
    })

    it("lets a Super Admin grant and then remove the Flow editor flag", async () => {
        const grant = await tryUpdate(clients.superAdmin, "employees", ids.ordinary, { can_edit_sales_flows: true })
        expect(grant.ok, grant.message).toBe(true)
        expect(grant.affected).toBe(1)
        expect(await flowFlag(ids.ordinary)).toBe(true)

        const revoke = await tryUpdate(clients.superAdmin, "employees", ids.ordinary, { can_edit_sales_flows: false })
        expect(revoke.ok, revoke.message).toBe(true)
        expect(await flowFlag(ids.ordinary)).toBe(false)
    })
})

describe("can_edit_sales_flows write path, new employee", () => {
    it("refuses HR creating an employee who already holds the Flow editor flag", async () => {
        const result = await tryInsert(clients.hr, "employees", newRow("hr-grant", { can_edit_sales_flows: true }))
        expect(result.ok).toBe(false)
        expect(result.code).toBe(RLS_VIOLATION)
    })

    it("lets HR create an employee without the Flow editor flag", async () => {
        const result = await tryInsert(clients.hr, "employees", newRow("hr-plain"))
        expect(result.ok, result.message).toBe(true)
        createdIds.push(result.id)
        expect(await flowFlag(result.id)).toBe(false)
    })

    it("lets a Super Admin create an employee with the Flow editor flag", async () => {
        const result = await tryInsert(clients.superAdmin, "employees", newRow("sa-grant", { can_edit_sales_flows: true }))
        expect(result.ok, result.message).toBe(true)
        createdIds.push(result.id)
        expect(await flowFlag(result.id)).toBe(true)
    })
})
