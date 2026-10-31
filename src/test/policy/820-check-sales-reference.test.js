/**
 * Issue #820 (spec #800, ADR 0050) — registration runs the save step's checks.
 *
 * `check_sales_reference` is the read-only half of `set_sales_reference`: same order (format,
 * duplicates, Odoo), same refusal hints, nothing written. Registration calls it before the SOR is
 * created, then registers through `set_sales_reference` (covered by 815-set-sales-reference).
 * The last test runs the two together, the way the form's save does.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded, castEmail } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const sorIds = []
const used = new Set()

function s0() {
    for (;;) {
        const n = `S8${Math.floor(1000000 + Math.random() * 8999999)}`
        if (!used.has(n)) {
            used.add(n)
            return n
        }
    }
}

const check = (ref, odoo) =>
    svc().rpc("check_sales_reference", {
        p_actor_email: castEmail("ordinary"),
        p_sales_reference: ref,
        ...(odoo === undefined ? {} : { p_odoo: odoo }),
    })

async function sorWith(ref, extra = {}) {
    const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(id)
    const { error } = await svc().from("sales_opportunities").update({ sales_reference: ref, ...extra }).eq("id", id)
    if (error) throw new Error(error.message)
    return id
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

describe("check_sales_reference", () => {
    it("is for the service role only", async () => {
        const { error } = await (await clientFor("ordinary")).rpc("check_sales_reference", {
            p_actor_email: castEmail("ordinary"),
            p_sales_reference: s0(),
        })
        expect(error).toBeTruthy()
    })

    it("lets a free, well-formed S0 through (found, or Not checked when Odoo did not answer)", async () => {
        const ref = s0()
        const found = await check(ref, "found")
        expect(found.error).toBeNull()
        expect(found.data).toMatchObject({ sales_reference: ref, odoo_state: "found" })
        const outage = await check(ref, "unreachable")
        expect(outage.error).toBeNull()
        expect(outage.data).toMatchObject({ sales_reference: ref, odoo_state: "not_checked" })
    })

    it("reads SO123 as S123 and passes a blank S0 through (it can be added later)", async () => {
        const n = s0().slice(1)
        expect((await check(`so${n}`, "found")).data.sales_reference).toBe(`S${n}`)
        const blank = await check("  ")
        expect(blank.error).toBeNull()
        expect(blank.data.sales_reference).toBeNull()
    })

    it("refuses a number that is not an S0", async () => {
        const { error } = await check("not-a-quote", "found")
        expect(error?.hint).toBe("format")
    })

    it("refuses an S0 already on another SOR, Lost included, even when Odoo is down", async () => {
        const ref = s0()
        await sorWith(ref)
        const { error } = await check(ref, "unreachable")
        expect(error?.hint).toBe("duplicate")
        expect(error?.message).toMatch(/One S0 per SOR/)
    })

    it("does not count a deleted SOR", async () => {
        const ref = s0()
        await sorWith(ref, { is_deleted: true })
        const { error } = await check(ref, "found")
        expect(error).toBeNull()
    })

    it("refuses an S0 Odoo does not have", async () => {
        const { error } = await check(s0(), "not_found")
        expect(error?.hint).toBe("not_found")
    })

    it("writes nothing", async () => {
        const ref = s0()
        await check(ref, "found")
        const { data } = await svc().from("sales_opportunities").select("id").eq("sales_reference", ref)
        expect(data).toHaveLength(0)
    })

    it("registers through the save step after a clean check: S0 written, Odoo state set, products pulled", async () => {
        const ref = s0()
        expect((await check(ref, "found")).error).toBeNull()
        const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
        sorIds.push(id)
        const saved = await svc().rpc("set_sales_reference", {
            p_actor_email: castEmail("dealOwner"),
            p_opportunity_id: id,
            p_sales_reference: ref,
            p_odoo: "found",
            p_items: [{ product_name: "Pumper", unit: "Units", quantity: 2, unit_price: 1500, odoo_product_id: 7, odoo_line_id: 9001, removed_from_s0: false }],
        })
        expect(saved.error).toBeNull()
        expect(saved.data).toMatchObject({ sales_reference: ref, odoo_state: "found" })
        const { data: items } = await svc().from("sales_opportunity_items").select("product_name, odoo_line_id").eq("opportunity_id", id)
        expect(items).toEqual([{ product_name: "Pumper", odoo_line_id: 9001 }])
    })
})
