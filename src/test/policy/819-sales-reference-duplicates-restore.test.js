/**
 * Issue #819 (spec #800, ADR 0050) — duplicate S0s show on the card, and restore refuses an S0
 * another SOR now uses.
 *
 * The service role seeds the SORs (two can share an S0 only because they predate the rule). The
 * cast member named in each call is the caller; the browser path is `clientFor(...).rpc`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const sorIds = []

async function ok(promise, what) {
    const { data, error } = await promise
    if (error) throw new Error(`Seeding ${what}: ${error.message}`)
    return data
}

let counter = 0
const s0 = () => `S8${Math.floor(1000000 + Math.random() * 8999999)}${counter++ % 10}`.slice(0, 9)

async function sor(salesReference, { deleted = false } = {}) {
    const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(id)
    const patch = { sales_reference: salesReference }
    if (deleted) Object.assign(patch, { is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: ids.dealOwner })
    await ok(svc().from("sales_opportunities").update(patch).eq("id", id), "S0")
    return id
}

const row = (id) => ok(svc().from("sales_opportunities").select("*").eq("id", id).single(), "row")

beforeAll(async () => {
    await ensureCastLoaded()
})

afterAll(async () => {
    const s = svc()
    await s.from("system_audit_logs").delete().in("entity_id", sorIds)
    await s.from("sales_opportunity_logs").delete().in("opportunity_id", sorIds)
    await s.from("sales_opportunities").delete().in("id", sorIds)
})

describe("the S0 card lists duplicates", () => {
    it("names the other live SORs on the same S0, and only those", async () => {
        const ref = s0()
        const mine = await sor(ref)
        const other = await sor(ref)
        await sor(ref, { deleted: true })
        await sor(s0())

        const owner = await clientFor("dealOwner")
        const { data, error } = await owner.rpc("sales_reference_card", { p_opportunity_id: mine })
        expect(error).toBeNull()
        expect(data.duplicates).toHaveLength(1)
        expect(data.duplicates[0].id).toBe(other)
        expect(data.duplicates[0].name).toContain("Rope Rescue Equipment")
        expect(data.duplicates[0].name).toContain("Acme Rescue Supplies")
    })

    it("lists none when the S0 is unique or empty", async () => {
        const unique = await sor(s0())
        const empty = await sor(null)
        const owner = await clientFor("dealOwner")
        for (const id of [unique, empty]) {
            const { data } = await owner.rpc("sales_reference_card", { p_opportunity_id: id })
            expect(data.duplicates).toEqual([])
        }
    })
})

describe("restore_opportunity", () => {
    it("is refused when another SOR now has the S0, naming it, and changes nothing", async () => {
        const ref = s0()
        const deleted = await sor(ref, { deleted: true })
        const taker = await sor(ref)
        const before = await row(deleted)
        const takerBefore = await row(taker)

        const owner = await clientFor("dealOwner")
        const { error } = await owner.rpc("restore_opportunity", { p_opportunity_id: deleted })
        expect(error).not.toBeNull()
        expect(error.hint).toBe("duplicate")
        expect(error.message).toContain(ref)
        expect(error.message).toContain("Rope Rescue Equipment")

        expect(await row(deleted)).toEqual(before)
        expect(await row(taker)).toEqual(takerBefore)
    })

    it("is allowed when the S0 is free, and writes the restore note", async () => {
        const deleted = await sor(s0(), { deleted: true })
        const owner = await clientFor("dealOwner")
        const { data, error } = await owner.rpc("restore_opportunity", { p_opportunity_id: deleted })
        expect(error).toBeNull()
        expect(data.is_deleted).toBe(false)

        const after = await row(deleted)
        expect(after.is_deleted).toBe(false)
        expect(after.deleted_at).toBeNull()
        expect(after.deleted_by).toBeNull()

        const { data: notes } = await svc()
            .from("sales_opportunity_logs")
            .select("metadata")
            .eq("opportunity_id", deleted)
            .eq("metadata->>event", "OPPORTUNITY_RESTORED")
        expect(notes).toHaveLength(1)
    })

    it("lets a Super Admin restore, even a SOR with no S0, and ignores a deleted twin", async () => {
        const ref = s0()
        const deleted = await sor(ref, { deleted: true })
        await sor(ref, { deleted: true })
        const admin = await clientFor("superAdmin")
        const { error } = await admin.rpc("restore_opportunity", { p_opportunity_id: deleted })
        expect(error).toBeNull()

        const bare = await sor(null, { deleted: true })
        const { error: bareError } = await admin.rpc("restore_opportunity", { p_opportunity_id: bare })
        expect(bareError).toBeNull()
    })

    it("refuses anyone who is neither a Super Admin nor the Deal Owner", async () => {
        const deleted = await sor(s0(), { deleted: true })
        const ordinary = await clientFor("ordinary")
        const { error } = await ordinary.rpc("restore_opportunity", { p_opportunity_id: deleted })
        expect(error?.message).toMatch(/Super Admin or this SOR's Deal Owner/)
        expect((await row(deleted)).is_deleted).toBe(true)
    })
})
