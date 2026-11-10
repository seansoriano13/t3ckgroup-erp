/**
 * IPAS Remarks (#551, spec #544): Purchasing edits Remarks until the IPAS is filed or cancelled.
 *
 *   - a purchaser edits and clears Remarks; each change is one "header_changed" event in the history
 *   - a filed or cancelled IPAS refuses it (22023, like every other header field)
 *   - Finance and a Super Admin who isn't in Purchasing can't touch Remarks (42501)
 *   - a non-text Remarks is refused with a sentence (22023)
 *
 * `outsider` holds Purchasing access for the file. The SOR list isn't a header field, so
 * ipas_set_header refuses it by name (22023).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const copyFor = (po) => ({
    po: { id: 830000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_700_000 + poSeq, name: "Remarks Supplier", contact: null },
    lines: [{ line_id: 840000 + poSeq * 10, product_id: 7500, name: "Item 1", quantity: 2, unit: "Unit", price_unit: 100, price_subtotal: 200, taxes: [], analytic: [], brand: null }],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise() {
    const po = `P9${String(70000 + (poSeq += 1)).padStart(6, "0")}`
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po),
    })
    if (error) throw new Error(`raise ${po}: ${error.message}`)
    return data
}

const setRemarks = (who, ipasId, remarks) => rpc(who, "ipas_set_header", { p_ipas_id: ipasId, p_fields: { remarks } })
const remarksOf = async (ipasId) => (await svc().from("ipas").select("remarks").eq("id", ipasId).single()).data.remarks
const headerEvents = async (ipasId) =>
    (await svc().from("ipas_events").select("detail").eq("ipas_id", ipasId).eq("kind", "header_changed").order("created_at")).data
const flag = async (who, on) => {
    const { error } = await svc().from("employees").update({ has_purchasing_flow: on }).eq("id", ids[who])
    if (error) throw error
}

beforeAll(async () => {
    await ensureCastLoaded()
    await flag("outsider", true)
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", [ids.outsider, ids.superAdmin, ids.finance])
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("Remarks on an open IPAS", () => {
    it("are edited by Purchasing, with each change in the history", async () => {
        const ipas = await raise()
        expect((await setRemarks("outsider", ipas.id, "  Rush order  ")).error).toBeNull()
        expect(await remarksOf(ipas.id)).toBe("Rush order")
        expect((await setRemarks("outsider", ipas.id, "Rush order, split delivery")).error).toBeNull()

        const events = await headerEvents(ipas.id)
        expect(events.map((e) => e.detail.fields.remarks)).toEqual([
            { from: null, to: "Rush order" },
            { from: "Rush order", to: "Rush order, split delivery" },
        ])
    })

    it("are cleared by a blank, and an unchanged value writes no event", async () => {
        const ipas = await raise()
        await setRemarks("outsider", ipas.id, "Keep")
        await setRemarks("outsider", ipas.id, "Keep")
        expect(await headerEvents(ipas.id)).toHaveLength(1)
        expect((await setRemarks("outsider", ipas.id, "  ")).error).toBeNull()
        expect(await remarksOf(ipas.id)).toBeNull()
    })

    it("must be text", async () => {
        const ipas = await raise()
        expect((await setRemarks("outsider", ipas.id, 42)).error?.code).toBe("22023")
        expect((await setRemarks("outsider", ipas.id, { a: 1 })).error?.code).toBe("22023")
    })

    it("can be set beside other header fields in one call", async () => {
        const ipas = await raise()
        const res = await rpc("outsider", "ipas_set_header", { p_ipas_id: ipas.id, p_fields: { remarks: "Both", pi_number: "PI-9" } })
        expect(res.error).toBeNull()
        expect(await remarksOf(ipas.id)).toBe("Both")
    })
})

describe("Remarks once the IPAS is filed or cancelled", () => {
    it("are refused on a filed IPAS", async () => {
        const ipas = await raise()
        await setRemarks("outsider", ipas.id, "Before filing")
        await sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [ipas.id])
        expect((await setRemarks("outsider", ipas.id, "After filing")).error?.code).toBe("22023")
        expect(await remarksOf(ipas.id)).toBe("Before filing")
    })

    it("are refused on a cancelled IPAS", async () => {
        const ipas = await raise()
        expect((await rpc("outsider", "ipas_cancel", { p_ipas_id: ipas.id, p_reason: "Raised in error" })).error).toBeNull()
        expect((await setRemarks("outsider", ipas.id, "Too late")).error?.code).toBe("22023")
        expect(await remarksOf(ipas.id)).toBeNull()
    })
})

describe("Who may edit Remarks", () => {
    it("is Purchasing only: Finance and a Super Admin outside Purchasing are refused", async () => {
        await flag("superAdmin", false)
        const ipas = await raise()
        await sql().query(`update public.ipas set computation_status = 'lc_odoo_done' where id = $1`, [ipas.id])
        for (const who of ["finance", "superAdmin", "ordinary"]) {
            expect((await setRemarks(who, ipas.id, "Nope")).error?.code, who).toBe("42501")
        }
        // Not even beside a status step.
        const both = await rpc("finance", "ipas_set_header", {
            p_ipas_id: ipas.id,
            p_fields: { computation_status: "lc_gs_done", remarks: "Sneaky" },
        })
        expect(both.error?.code).toBe("42501")
        expect(await remarksOf(ipas.id)).toBeNull()
    })
})

describe("The SOR list", () => {
    it("isn't a header field, so ipas_set_header refuses it", async () => {
        const ipas = await raise()
        const res = await rpc("outsider", "ipas_set_header", { p_ipas_id: ipas.id, p_fields: { sor_ids: [] } })
        expect(res.error?.code).toBe("22023")
    })
})
