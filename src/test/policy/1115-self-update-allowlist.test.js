/**
 * #1115 (spec #1114 D1-D3) — a person editing their own `employees` row may
 * change only avatar_path, dashboard_banner_path, dashboard_quote,
 * signature_path (plus updated_at and last_seen_changelog_version, which the
 * app writes itself). Every other column is refused with an error, and
 * dashboard_quote is limited to 100 characters.
 *
 * The test walks every column the table returns: a column that is neither in
 * ALLOWED nor in REFUSED_PATCHES fails the coverage check, so a new column has
 * to be classified here on purpose.
 *
 * Seam A: assertions go through a real signed-in client, never the service
 * role (which only seeds and reads back).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createClient } from "@supabase/supabase-js"
import { API_URL, ANON_KEY, serviceClient } from "./support/stack.js"
import { FIXTURE_DOMAIN, CAST_PASSWORD } from "./support/cast.js"
import { tryUpdate, RLS_VIOLATION } from "./support/access.js"

const HR_EMAIL = `self-allow-hr@${FIXTURE_DOMAIN}`
const SUPER_ADMIN_EMAIL = `self-allow-super-admin@${FIXTURE_DOMAIN}`
const ORDINARY_EMAIL = `self-allow-ordinary@${FIXTURE_DOMAIN}`

const ALLOWED = {
    avatar_path: "avatars/new.png",
    dashboard_banner_path: "https://example.com/banner.png",
    dashboard_quote: "A short quote",
    signature_path: "signatures/new.png",
    last_seen_changelog_version: "9.9.9",
}

// One distinct new value per column that must be refused. `id` is the key.
const REFUSED_PATCHES = {
    created_at: "2001-01-01T00:00:00Z",
    updated_by: "00000000-0000-0000-0000-000000000001",
    email: `self-allow-changed@${FIXTURE_DOMAIN}`,
    name: "Changed Name",
    department: "SALES",
    sub_department: "Changed Sub",
    role: "CHANGED",
    is_head: true,
    is_hr: true,
    is_super_admin: true,
    is_deleted: true,
    has_sales_flow: true,
    has_task_flow: false,
    offset_hours_balance: 99,
    employment_status: "Probationary",
    sil_hours_balance: 99,
    has_purchasing_flow: true,
    can_manage_leaves: true,
    is_role_simulator: true,
    hidden_nav_keys: ["workspace.dashboard"],
    company_id: "00000000-0000-0000-0000-000000000002",
    is_issued_password: true,
    can_edit_sales_flows: true,
    has_retail_access: true,
    has_bug_report_access: true,
    has_finance_flow: true,
    call_sign: "9115",
}

const ids = {}
const clients = {}

async function seed(email, extra = {}) {
    const svc = serviceClient()
    const { data, error } = await svc.auth.admin.createUser({ email, password: CAST_PASSWORD, email_confirm: true })
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
    const client = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    const { error } = await client.auth.signInWithPassword({ email, password: CAST_PASSWORD })
    if (error) throw new Error(`Signing in as ${email}: ${error.message}`)
    return client
}

async function rowOf(id) {
    const { data, error } = await serviceClient().from("employees").select("*").eq("id", id).single()
    if (error) throw new Error(`Reading employee ${id}: ${error.message}`)
    return data
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
    for (const id of [ids.hr, ids.superAdmin, ids.ordinary]) await svc.auth.admin.deleteUser(id)
})

describe("self-update allowlist on employees", () => {
    it("classifies every column the table has", async () => {
        const row = await rowOf(ids.ordinary)
        const known = new Set(["id", "updated_at", ...Object.keys(ALLOWED), ...Object.keys(REFUSED_PATCHES)])
        const unclassified = Object.keys(row).filter((c) => !known.has(c))
        expect(unclassified, "new employees column: add it to ALLOWED or REFUSED_PATCHES").toEqual([])
    })

    for (const [column, value] of Object.entries(REFUSED_PATCHES)) {
        it(`refuses an employee changing their own ${column}`, async () => {
            const before = await rowOf(ids.ordinary)
            const result = await tryUpdate(clients.ordinary, "employees", ids.ordinary, { [column]: value })
            expect(result.ok, `${column} was accepted`).toBe(false)
            expect(result.code).toBe(RLS_VIOLATION)
            expect((await rowOf(ids.ordinary))[column]).toEqual(before[column])
        })
    }

    it("saves avatar, banner, quote, signature and the changelog version", async () => {
        const result = await tryUpdate(clients.ordinary, "employees", ids.ordinary, {
            ...ALLOWED,
            updated_at: new Date().toISOString(),
        })
        expect(result.ok, result.message).toBe(true)
        expect(result.affected).toBe(1)
        const after = await rowOf(ids.ordinary)
        for (const [column, value] of Object.entries(ALLOWED)) expect(after[column]).toBe(value)
    })

    it("refuses a mixed save that carries one forbidden column, and saves nothing", async () => {
        const result = await tryUpdate(clients.ordinary, "employees", ids.ordinary, {
            dashboard_quote: "Should not land",
            department: "SALES",
        })
        expect(result.ok).toBe(false)
        const after = await rowOf(ids.ordinary)
        expect(after.dashboard_quote).not.toBe("Should not land")
        expect(after.department).toBe("OPERATIONS")
    })
})

describe("quote length", () => {
    it("accepts a quote of exactly 100 characters", async () => {
        const quote = "q".repeat(100)
        const result = await tryUpdate(clients.ordinary, "employees", ids.ordinary, { dashboard_quote: quote })
        expect(result.ok, result.message).toBe(true)
        expect((await rowOf(ids.ordinary)).dashboard_quote).toBe(quote)
    })

    it("refuses a quote of 101 characters", async () => {
        const before = (await rowOf(ids.ordinary)).dashboard_quote
        const result = await tryUpdate(clients.ordinary, "employees", ids.ordinary, { dashboard_quote: "q".repeat(101) })
        expect(result.ok).toBe(false)
        expect((await rowOf(ids.ordinary)).dashboard_quote).toBe(before)
    })

    it("refuses an over-long quote from HR on someone else too", async () => {
        const result = await tryUpdate(clients.hr, "employees", ids.ordinary, { dashboard_quote: "q".repeat(101) })
        expect(result.ok).toBe(false)
    })
})

describe("HR and Super Admin are unchanged", () => {
    it("lets HR edit another person's department and role", async () => {
        const result = await tryUpdate(clients.hr, "employees", ids.ordinary, { department: "SALES", role: "CHANGED" })
        expect(result.ok, result.message).toBe(true)
        expect(result.affected).toBe(1)
        const after = await rowOf(ids.ordinary)
        expect(after.department).toBe("SALES")
        await serviceClient().from("employees").update({ department: "OPERATIONS", role: "TEST" }).eq("id", ids.ordinary)
    })

    it("lets HR edit their own non-privileged columns", async () => {
        const result = await tryUpdate(clients.hr, "employees", ids.hr, { sub_department: "People" })
        expect(result.ok, result.message).toBe(true)
        expect(result.affected).toBe(1)
    })

    it("lets a Super Admin edit another person and grant a flag", async () => {
        const result = await tryUpdate(clients.superAdmin, "employees", ids.ordinary, {
            department: "SALES",
            can_edit_sales_flows: true,
        })
        expect(result.ok, result.message).toBe(true)
        expect(result.affected).toBe(1)
        await serviceClient()
            .from("employees")
            .update({ department: "OPERATIONS", can_edit_sales_flows: false })
            .eq("id", ids.ordinary)
    })
})
