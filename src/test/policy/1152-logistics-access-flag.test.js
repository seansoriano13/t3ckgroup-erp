/**
 * #1152 (spec #1151, T1) — Logistics access.
 *
 * `employees.has_logistics_flow` is granted only by HR or a Super Admin, never
 * by HR to themselves, and a change by anyone else does not stick. A holder of
 * the flag alone reads every IPAS (ipas_can_read), and the flag is not the
 * Logistics signer list. Seam A: assertions go through real signed-in clients.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createClient } from "@supabase/supabase-js"
import { API_URL, ANON_KEY, serviceClient } from "./support/stack.js"
import { FIXTURE_DOMAIN, CAST_PASSWORD } from "./support/cast.js"

const email = (slug) => `logi-flag-${slug}@${FIXTURE_DOMAIN}`
const SLUGS = ["hr", "super", "ordinary", "target", "holder"]
const ids = {}
const clients = {}

async function seed(slug, extra = {}) {
    const svc = serviceClient()
    const { data, error } = await svc.auth.admin.createUser({ email: email(slug), password: CAST_PASSWORD, email_confirm: true })
    if (error) throw new Error(`Creating auth user ${slug}: ${error.message}`)
    const { error: empError } = await svc.from("employees").insert({
        id: data.user.id,
        email: email(slug),
        name: `logi-flag-${slug}`,
        department: "OPERATIONS",
        sub_department: null,
        role: "TEST",
        employment_status: "Regular",
        offset_hours_balance: 0,
        sil_hours_balance: 0,
        hidden_nav_keys: [],
        ...extra,
    })
    if (empError) throw new Error(`Seeding employee ${slug}: ${empError.message}`)
    ids[slug] = data.user.id
    const client = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    const signedIn = await client.auth.signInWithPassword({ email: email(slug), password: CAST_PASSWORD })
    if (signedIn.error) throw new Error(`Signing in as ${slug}: ${signedIn.error.message}`)
    clients[slug] = client
}

const flagOf = async (id) =>
    (await serviceClient().from("employees").select("has_logistics_flow").eq("id", id).single()).data.has_logistics_flow

const setFlag = (client, id, on) => client.from("employees").update({ has_logistics_flow: on }).eq("id", id)

beforeAll(async () => {
    await seed("hr", { is_hr: true })
    await seed("super", { is_super_admin: true })
    await seed("ordinary")
    await seed("target")
    await seed("holder", { has_logistics_flow: true })
})

afterAll(async () => {
    const svc = serviceClient()
    const all = SLUGS.map((s) => ids[s]).filter(Boolean)
    await svc.from("employees").delete().in("id", all)
    for (const id of all) await svc.auth.admin.deleteUser(id)
})

describe("Logistics access is granted by HR or a Super Admin", () => {
    it("lets HR turn it on and off for another employee", async () => {
        await setFlag(clients.hr, ids.target, true)
        expect(await flagOf(ids.target)).toBe(true)
        await setFlag(clients.hr, ids.target, false)
        expect(await flagOf(ids.target)).toBe(false)
    })

    it("lets a Super Admin grant it to another employee and to themselves", async () => {
        await setFlag(clients.super, ids.target, true)
        expect(await flagOf(ids.target)).toBe(true)
        await setFlag(clients.super, ids.target, false)
        await setFlag(clients.super, ids.super, true)
        expect(await flagOf(ids.super)).toBe(true)
        await serviceClient().from("employees").update({ has_logistics_flow: false }).eq("id", ids.super)
    })

    it("does not let HR grant it to themselves", async () => {
        await setFlag(clients.hr, ids.hr, true)
        expect(await flagOf(ids.hr)).toBe(false)
    })

    it("does not let an ordinary employee grant it to anyone", async () => {
        await setFlag(clients.ordinary, ids.ordinary, true)
        await setFlag(clients.ordinary, ids.target, true)
        expect(await flagOf(ids.ordinary)).toBe(false)
        expect(await flagOf(ids.target)).toBe(false)
    })

    it("does not let an ordinary employee take it away from a holder", async () => {
        await setFlag(clients.ordinary, ids.holder, false)
        expect(await flagOf(ids.holder)).toBe(true)
    })
})

describe("Logistics access reads IPAS and nothing more", () => {
    it("makes has_logistics_access and ipas_can_read true for the holder", async () => {
        expect((await clients.holder.rpc("has_logistics_access")).data).toBe(true)
        expect((await clients.holder.rpc("ipas_can_read")).data).toBe(true)
    })

    it("leaves both false for an employee without it", async () => {
        expect((await clients.ordinary.rpc("has_logistics_access")).data).toBe(false)
        expect((await clients.ordinary.rpc("ipas_can_read")).data).toBe(false)
    })

    it("does not give Finance access or a place on the Logistics signer list", async () => {
        expect((await clients.holder.rpc("has_finance_access")).data).toBe(false)
        const { data } = await serviceClient().from("ipas_signer_lists").select("list_key").eq("employee_id", ids.holder)
        expect(data).toEqual([])
    })
})
