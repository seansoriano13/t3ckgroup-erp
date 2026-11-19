/**
 * Settings tables the screen calls "Super Admin only" (#1095, spec #1093, tracker A2): the database says it too.
 *
 *   crm_lead_sources, system_updates: everyone signed in reads; only a Super Admin inserts, updates, deletes
 *   meal_break_settings (HR & Schedule): everyone signed in reads; only HR or a Super Admin writes
 *   a plain employee and the Flow editor are refused on every write
 * A refused update or delete changes no rows, so each test also checks the row is still as it was.
 * Every row a test adds is removed again.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { RLS_VIOLATION } from "./support/access.js"

const svc = () => serviceClient()
const TAG = `ZZ_1095_${Date.now().toString(36).toUpperCase()}`
const addedUpdates = []

const NOT_ALLOWED = ["ordinary", "flowEditor"]

beforeAll(async () => {
    await ensureCastLoaded()
})

afterAll(async () => {
    await svc().from("crm_lead_sources").delete().like("value", `${TAG}%`)
    if (addedUpdates.length) await svc().from("system_updates").delete().in("id", addedUpdates)
    await svc().from("system_updates").delete().like("content", `${TAG}%`)
    await svc().from("meal_break_settings").update({ start_time: "18:00", end_time: "19:00", enabled: false }).eq("key", "dinner")
})

const leadSource = async (value) => (await svc().from("crm_lead_sources").select("*").eq("value", value)).data?.[0] ?? null

describe("crm_lead_sources (Settings > Sales Configuration)", () => {
    it("is read by a plain employee", async () => {
        await svc().from("crm_lead_sources").insert({ value: `${TAG}_READ`, label: "Readable" })
        const { data, error } = await (await clientFor("ordinary")).from("crm_lead_sources").select("value, label, is_active")
        expect(error).toBeNull()
        expect(data.length).toBeGreaterThan(0)
    })

    it.each(NOT_ALLOWED)("refuses an insert by %s", async (who) => {
        const { error } = await (await clientFor(who)).from("crm_lead_sources").insert({ value: `${TAG}_${who}`, label: "Nope" })
        expect(error?.code).toBe(RLS_VIOLATION)
        expect(await leadSource(`${TAG}_${who}`)).toBeNull()
    })

    it("lets a Super Admin add, rename, switch off and delete one", async () => {
        const sa = await clientFor("superAdmin")
        const value = `${TAG}_SA`
        expect((await sa.from("crm_lead_sources").insert({ value, label: "Mine" })).error).toBeNull()
        const renamed = await sa.from("crm_lead_sources").update({ label: "Renamed" }).eq("value", value).select()
        expect(renamed.data).toHaveLength(1)
        const off = await sa.from("crm_lead_sources").update({ is_active: false }).eq("value", value).select()
        expect(off.data).toHaveLength(1)
        const gone = await sa.from("crm_lead_sources").delete().eq("value", value).select()
        expect(gone.data).toHaveLength(1)
    })

    it.each(NOT_ALLOWED)("changes nothing when %s renames, switches off or deletes one", async (who) => {
        const value = `${TAG}_KEEP_${who}`
        await svc().from("crm_lead_sources").insert({ value, label: "Keep" })
        const client = await clientFor(who)
        expect((await client.from("crm_lead_sources").update({ label: "Hacked" }).eq("value", value).select()).data ?? []).toHaveLength(0)
        expect((await client.from("crm_lead_sources").update({ is_active: false }).eq("value", value).select()).data ?? []).toHaveLength(0)
        expect((await client.from("crm_lead_sources").delete().eq("value", value).select()).data ?? []).toHaveLength(0)
        expect(await leadSource(value)).toMatchObject({ label: "Keep", is_active: true })
    })
})

describe("system_updates (Settings > System Announcements)", () => {
    it("is read by a plain employee, live announcement included", async () => {
        const { data: row } = await svc().from("system_updates").insert({ content: `${TAG} live`, created_by: ids.superAdmin, is_active: true }).select("id").single()
        addedUpdates.push(row.id)
        const { data, error } = await (await clientFor("ordinary"))
            .from("system_updates")
            .select("id, content")
            .eq("is_active", true)
            .gt("expires_at", new Date().toISOString())
        expect(error).toBeNull()
        expect(data.map((r) => r.id)).toContain(row.id)
    })

    it.each(NOT_ALLOWED)("refuses an insert by %s", async (who) => {
        const { error } = await (await clientFor(who)).from("system_updates").insert({ content: `${TAG} from ${who}`, created_by: ids[who], is_active: false })
        expect(error?.code).toBe(RLS_VIOLATION)
        const { data } = await svc().from("system_updates").select("id").eq("content", `${TAG} from ${who}`)
        expect(data).toHaveLength(0)
    })

    it("lets a Super Admin post, edit and delete one", async () => {
        const sa = await clientFor("superAdmin")
        const posted = await sa.from("system_updates").insert({ content: `${TAG} sa`, created_by: ids.superAdmin, is_active: false }).select("id").single()
        expect(posted.error).toBeNull()
        addedUpdates.push(posted.data.id)
        const edited = await sa.from("system_updates").update({ content: `${TAG} sa edited` }).eq("id", posted.data.id).select()
        expect(edited.data).toHaveLength(1)
        const gone = await sa.from("system_updates").delete().eq("id", posted.data.id).select()
        expect(gone.data).toHaveLength(1)
    })

    it.each(NOT_ALLOWED)("changes nothing when %s edits, switches off or deletes one", async (who) => {
        const { data: row } = await svc().from("system_updates").insert({ content: `${TAG} keep ${who}`, created_by: ids.superAdmin, is_active: true }).select("id").single()
        addedUpdates.push(row.id)
        const client = await clientFor(who)
        expect((await client.from("system_updates").update({ content: "Hacked" }).eq("id", row.id).select()).data ?? []).toHaveLength(0)
        expect((await client.from("system_updates").update({ is_active: false }).eq("id", row.id).select()).data ?? []).toHaveLength(0)
        expect((await client.from("system_updates").delete().eq("id", row.id).select()).data ?? []).toHaveLength(0)
        const { data } = await svc().from("system_updates").select("content, is_active").eq("id", row.id).single()
        expect(data).toEqual({ content: `${TAG} keep ${who}`, is_active: true })
    })
})

describe("meal_break_settings (Settings > HR & Schedule)", () => {
    const window = { key: "dinner", start_time: "18:30", end_time: "19:30", enabled: true }
    const current = async () => (await svc().from("meal_break_settings").select("*").eq("key", "dinner").single()).data

    it("is read by a plain employee", async () => {
        await svc().from("crm_lead_sources").insert({ value: `${TAG}_READ`, label: "Readable" })
        const { data, error } = await (await clientFor("ordinary")).from("meal_break_settings").select("key")
        expect(error).toBeNull()
        expect(data.length).toBeGreaterThan(0)
    })

    it.each(NOT_ALLOWED)("refuses a save by %s", async (who) => {
        const before = await current()
        const client = await clientFor(who)
        const upsert = await client.from("meal_break_settings").upsert(window)
        expect(upsert.error).not.toBeNull()
        const upd = await client.from("meal_break_settings").update({ enabled: true }).eq("key", "dinner").select()
        expect(upd.data ?? []).toHaveLength(0)
        expect(await current()).toEqual(before)
    })

    it.each(["hr", "superAdmin"])("lets %s save a window", async (who) => {
        const { error } = await (await clientFor(who)).from("meal_break_settings").upsert(window)
        expect(error).toBeNull()
        expect(await current()).toMatchObject({ start_time: "18:30:00", end_time: "19:30:00", enabled: true })
        await svc().from("meal_break_settings").update({ start_time: "18:00", end_time: "19:00", enabled: false }).eq("key", "dinner")
    })
})
