/**
 * Issue #822 (spec #800, ADR 0050) — the database refuses every S0 write that does not come
 * through the save step.
 *
 * Direct writes run as a signed-in cast member through the browser client. The service role seeds
 * the deals (it is let through by the guard, as server code is) and reads back what happened.
 *
 * Old pipeline: Lead is the first Stage; a throwaway second pipeline Stage is "past Lead".
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded, castEmail } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const sorIds = []
const queueIds = []
const NEXT_CODE = "M822NEXT"
let counter = 0

async function ok(promise, what) {
    const { data, error } = await promise
    if (error) throw new Error(`Seeding ${what}: ${error.message}`)
    return data
}

const s0 = () => `S7${Math.floor(1000000 + Math.random() * 8999999)}${counter++ % 10}`.slice(0, 9)

/** An old-pipeline deal, owned by the deal owner. `past` puts it past Lead (needs an S0). */
async function deal({ past = false, salesReference = null } = {}) {
    const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(id)
    const ref = salesReference ?? (past ? s0() : null)
    const patch = {}
    if (ref) patch.sales_reference = ref
    if (past) patch.status = NEXT_CODE
    if (Object.keys(patch).length) await ok(svc().from("sales_opportunities").update(patch).eq("id", id), "deal")
    return id
}

const row = (id) => ok(svc().from("sales_opportunities").select("sales_reference, status").eq("id", id).single(), "row")

const save = (who, sorId, ref, { reason } = {}) =>
    svc().rpc("set_sales_reference", {
        p_actor_email: castEmail(who),
        p_opportunity_id: sorId,
        p_sales_reference: ref,
        ...(reason === undefined ? {} : { p_reason: reason }),
    })

beforeAll(async () => {
    await ensureCastLoaded()
    await ok(svc().from("crm_pipeline_stages").upsert({ code: NEXT_CODE, label: "M822 Next", sort_order: 9991 }), "pipeline Stage")
})

afterAll(async () => {
    const s = svc()
    if (queueIds.length) await s.from("odoo_retail_queue").delete().in("id", queueIds)
    await s.from("system_audit_logs").delete().in("entity_id", sorIds)
    await s.from("sales_opportunity_logs").delete().in("opportunity_id", sorIds)
    await s.from("sales_opportunities").delete().in("id", sorIds)
    await s.from("crm_pipeline_stages").delete().eq("code", NEXT_CODE)
})

const directInsert = (client, extra = {}) =>
    client
        .from("sales_opportunities")
        .insert({
            registered_by: ids.dealOwner,
            deal_owner_id: ids.dealOwner,
            lead_source: "REFERRAL",
            client_name: "[policy-tier] 822 direct insert",
            project_title: "[policy-tier] 822 direct insert",
            expected_value: 1,
            status: "LEAD",
            ...extra,
        })
        .select("id")

describe("direct writes are refused", () => {
    it("refuses an insert with an S0 from a signed-in client", async () => {
        const owner = await clientFor("dealOwner")
        const { data, error } = await directInsert(owner, { sales_reference: s0() })
        if (data?.length) sorIds.push(...data.map((r) => r.id))
        expect(error).not.toBeNull()
        expect(error.message).toMatch(/S0 card/i)
    })

    it("allows an insert with no S0", async () => {
        const owner = await clientFor("dealOwner")
        const { data, error } = await directInsert(owner)
        if (data?.length) sorIds.push(...data.map((r) => r.id))
        expect(error).toBeNull()
    })

    it("refuses an update that sets, changes or clears the S0", async () => {
        const owner = await clientFor("dealOwner")
        const fresh = await deal()
        const set = await owner.from("sales_opportunities").update({ sales_reference: s0() }).eq("id", fresh).select("id")
        expect(set.error?.message).toMatch(/S0 card/i)
        expect((await row(fresh)).sales_reference).toBeNull()

        const held = s0()
        const withRef = await deal({ salesReference: held })
        const change = await owner.from("sales_opportunities").update({ sales_reference: s0() }).eq("id", withRef).select("id")
        expect(change.error?.message).toMatch(/S0 card/i)
        const clear = await owner.from("sales_opportunities").update({ sales_reference: null }).eq("id", withRef).select("id")
        expect(clear.error?.message).toMatch(/S0 card/i)
        expect((await row(withRef)).sales_reference).toBe(held)
    })

    it("refuses a Super Admin's direct write too", async () => {
        const admin = await clientFor("superAdmin")
        const id = await deal({ salesReference: s0() })
        const { error } = await admin.from("sales_opportunities").update({ sales_reference: s0() }).eq("id", id).select("id")
        expect(error?.message).toMatch(/S0 card/i)
    })

    it("allows writing the same S0 back, and other columns", async () => {
        const owner = await clientFor("dealOwner")
        const held = s0()
        const id = await deal({ salesReference: held })
        const same = await owner.from("sales_opportunities").update({ sales_reference: held, contact_person: "Same Value" }).eq("id", id).select("id")
        expect(same.error).toBeNull()
        expect(same.data).toHaveLength(1)
        const other = await owner.from("sales_opportunities").update({ project_title: "[policy-tier] renamed" }).eq("id", id).select("id")
        expect(other.error).toBeNull()
    })
})

describe("the save step still works", () => {
    it("sets the S0 through set_sales_reference", async () => {
        const id = await deal()
        const ref = s0()
        const { error } = await save("dealOwner", id, ref)
        expect(error).toBeNull()
        expect((await row(id)).sales_reference).toBe(ref)
    })

    it("lets the old-pipeline Lead exit run in the order the app uses: save the S0, then move", async () => {
        const owner = await clientFor("dealOwner")
        const id = await deal()

        // Moving first is still refused (the old rule stays).
        const early = await owner.from("sales_opportunities").update({ status: NEXT_CODE }).eq("id", id).select("id")
        expect(early.error?.message).toMatch(/Sales Reference/i)

        const ref = s0()
        expect((await save("dealOwner", id, ref)).error).toBeNull()
        const move = await owner.from("sales_opportunities").update({ status: NEXT_CODE }).eq("id", id).select("id")
        expect(move.error).toBeNull()
        expect(await row(id)).toMatchObject({ sales_reference: ref, status: NEXT_CODE })
    })
})

describe("day one: existing deals past the first Stage", () => {
    it("is locked when it has an S0", async () => {
        const id = await deal({ past: true })
        const owner = await clientFor("dealOwner")
        const { data, error } = await owner.rpc("sales_reference_card", { p_opportunity_id: id })
        expect(error).toBeNull()
        expect(data.lock).toBe("locked")
        expect(data.can_edit).toBe(false)
        const refused = await save("dealOwner", id, s0())
        expect(refused.error?.hint).toBe("locked")
    })

    it("can fill the S0 once when it has none, then locks", async () => {
        const id = await deal({ past: true })
        // Past Lead with no S0: only possible for a deal that predates the rule.
        await ok(svc().from("sales_opportunities").update({ sales_reference: null }).eq("id", id), "clear S0")
        const owner = await clientFor("dealOwner")
        const card = await owner.rpc("sales_reference_card", { p_opportunity_id: id })
        expect(card.data.lock).toBe("fill_once")
        expect(card.data.can_edit).toBe(true)

        expect((await save("dealOwner", id, s0())).error).toBeNull()
        const after = await owner.rpc("sales_reference_card", { p_opportunity_id: id })
        expect(after.data.lock).toBe("locked")
        expect((await save("dealOwner", id, s0())).error?.hint).toBe("locked")
    })
})

describe("retail", () => {
    it("still creates the Retail SOR with the Odoo S0 when the queue item is approved", async () => {
        const ref = s0()
        const queue = await ok(
            svc()
                .from("odoo_retail_queue")
                .insert({
                    odoo_so_number: ref,
                    odoo_so_id: 822000 + counter++,
                    odoo_partner_name: "[policy-tier] Shopee",
                    odoo_amount: 100,
                    deal_owner_id: ids.dealOwner,
                })
                .select("id")
                .single(),
            "retail queue item",
        )
        queueIds.push(queue.id)
        const admin = await clientFor("superAdmin")
        const { data, error } = await admin.rpc("approve_retail_queue_item", { p_queue_item_id: queue.id })
        expect(error).toBeNull()
        sorIds.push(data)
        const created = await ok(svc().from("sales_opportunities").select("sales_reference, is_retail").eq("id", data).single(), "retail SOR")
        expect(created).toMatchObject({ sales_reference: ref, is_retail: true })
    })

    it("does not let a client insert a retail row with an S0 itself", async () => {
        const admin = await clientFor("superAdmin")
        const { data, error } = await directInsert(admin, { is_retail: true, registered_by: ids.superAdmin, sales_reference: s0() })
        if (data?.length) sorIds.push(...data.map((r) => r.id))
        expect(error?.message).toMatch(/S0 card/i)
    })
})
