/**
 * Issue #817 (spec #800, ADR 0050) — `recheck_sales_reference`: the background re-check when a SOR
 * opens. Service role only (the edge function calls it with the caller's email and Odoo's answer).
 *
 * found: state found + read time. unreachable: nothing changes. not_found: state gone and ONE
 * history entry, however many times it runs. Nothing else on the deal moves.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, ensureCastLoaded, castEmail } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const sorIds = []
let counter = 0

async function ok(promise, what) {
    const { data, error } = await promise
    if (error) throw new Error(`Seeding ${what}: ${error.message}`)
    return data
}

beforeAll(async () => {
    await ensureCastLoaded()
})

afterAll(async () => {
    const s = svc()
    await s.from("system_audit_logs").delete().in("entity_id", sorIds)
    await s.from("sales_opportunity_logs").delete().in("opportunity_id", sorIds)
    await s.from("sales_opportunities").delete().in("id", sorIds)
})

async function deal(state, { salesReference = `S98${Date.now().toString().slice(-6)}${counter++}` } = {}) {
    const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(id)
    const patch = { sales_reference: salesReference, sales_reference_odoo_state: state }
    await ok(svc().from("sales_opportunities").update(patch).eq("id", id), "deal")
    return id
}

const recheck = (who, sorId, odoo) =>
    svc().rpc("recheck_sales_reference", { p_actor_email: castEmail(who), p_opportunity_id: sorId, p_odoo: odoo })

const row = (sorId) => ok(svc().from("sales_opportunities").select("*").eq("id", sorId).single(), "row")

async function goneHistory(sorId) {
    const { data } = await svc()
        .from("sales_opportunity_logs")
        .select("metadata")
        .eq("opportunity_id", sorId)
        .eq("metadata->>event", "SALES_REFERENCE_GONE")
    const { data: audit } = await svc()
        .from("system_audit_logs")
        .select("metadata")
        .eq("entity_id", sorId)
        .eq("metadata->>event", "SALES_REFERENCE_GONE")
    return { logs: data ?? [], audit: audit ?? [] }
}

describe("recheck_sales_reference", () => {
    it("turns a Not checked S0 into Found, with the read time", async () => {
        const sor = await deal("not_checked")
        const { error } = await recheck("dealOwner", sor, "found")
        expect(error).toBeNull()
        const after = await row(sor)
        expect(after.sales_reference_odoo_state).toBe("found")
        expect(after.sales_reference_checked_at).not.toBeNull()
        expect((await goneHistory(sor)).logs).toHaveLength(0)
    })

    it("changes nothing when Odoo cannot answer", async () => {
        const sor = await deal("found")
        const before = await row(sor)
        const { error } = await recheck("dealOwner", sor, "unreachable")
        expect(error).toBeNull()
        expect(await row(sor)).toEqual(before)
    })

    it("marks the S0 gone with exactly one history entry, even when run twice", async () => {
        const sor = await deal("found")
        const before = await row(sor)
        expect((await recheck("dealOwner", sor, "not_found")).error).toBeNull()
        expect((await recheck("dealOwner", sor, "not_found")).error).toBeNull()

        const after = await row(sor)
        expect(after.sales_reference_odoo_state).toBe("gone")
        const history = await goneHistory(sor)
        expect(history.logs).toHaveLength(1)
        expect(history.audit).toHaveLength(1)
        expect(history.logs[0].metadata.old).toBe(before.sales_reference)

        // Nothing else on the deal moved.
        const { sales_reference_odoo_state: _a, updated_at: _b, ...rest } = after
        const { sales_reference_odoo_state: _c, updated_at: _d, ...restBefore } = before
        expect(rest).toEqual(restBefore)
    })

    it("lets any reader of the SOR trigger it, and refuses someone who cannot open it", async () => {
        const sor = await deal("not_checked")
        expect((await recheck("superAdmin", sor, "found")).error).toBeNull()
        const { error } = await recheck("outsider", sor, "found")
        expect(error?.hint ?? error?.message).toBeTruthy()
        expect(error.code).toBe("42501")
    })

    it("does nothing for a SOR with no S0", async () => {
        const sor = await deal(null, { salesReference: null })
        const { error } = await recheck("dealOwner", sor, "not_found")
        expect(error).toBeNull()
        expect((await row(sor)).sales_reference_odoo_state).toBeNull()
        expect((await goneHistory(sor)).logs).toHaveLength(0)
    })
})
