/**
 * Transmittal from an IPAS (#725, spec #718): `transmittal_ipas_po_lines` returns
 * every PO line of one live IPAS so a New Transmittal can fill them as draft
 * lines. Only a Transmittal preparer may ask, no money column comes back, and the
 * slip is still written (and refused) by `transmittal_create`, unchanged.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded, castEmail } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P7${String(10000 + (poSeq += 1)).padStart(6, "0")}`

const line = (id, name, quantity) => ({
    line_id: id, product_id: 5350, name, quantity, unit: "Unit", price_unit: 100, price_subtotal: 100 * quantity,
    taxes: [], analytic: [], brand: "SCORPE",
})

async function raiseIpas() {
    const po = nextPo()
    const base = 971000 + poSeq * 10
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: {
            po: { id: base, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
            supplier: { id: 553, name: "Scorpe Technologies", contact: null },
            lines: [line(base + 1, "Cutter", 6), line(base + 2, "Blade", 12)],
            receipts: { status: "pending", done: 0, total: 1 },
            bills: { count: 0, draft: 0 },
        },
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const HEADER = { origin: "purchasing", check_warehouse: true, check_technical: false, priority: "high", entity: "T3ck Trading" }

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    const { error } = await svc()
        .from("ipas_signer_lists")
        .upsert({ list_key: "transmittal_warehouse", employee_id: ids.warehouse }, { onConflict: "list_key,employee_id" })
    if (error) throw new Error(`Seeding the warehouse list for ${castEmail("warehouse")}: ${error.message}`)
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await svc().from("ipas_signer_lists").delete().eq("employee_id", ids.warehouse).eq("list_key", "transmittal_warehouse")
})

describe("a New Transmittal fills its lines from an IPAS", () => {
    it("returns every PO line of that IPAS, and no price, supplier or bank column", async () => {
        const ipas = await raiseIpas()
        const { data, error } = await rpc("warehouse", "transmittal_ipas_po_lines", { p_ipas_number: ipas.number })
        expect(error).toBeNull()
        expect(data.map((r) => r.product_name)).toEqual(["Cutter", "Blade"])
        expect(data.map((r) => Number(r.quantity))).toEqual([6, 12])
        for (const row of data) {
            expect(row.ipas_id).toBe(ipas.id)
            for (const key of Object.keys(row)) expect(key).not.toMatch(/price|supplier|bank|subtotal|tax/i)
        }
    })

    it("refuses someone who is not a preparer, and an IPAS that does not exist", async () => {
        const ipas = await raiseIpas()
        const ordinary = await rpc("ordinary", "transmittal_ipas_po_lines", { p_ipas_number: ipas.number })
        expect(ordinary.error).toBeTruthy()
        const unknown = await rpc("warehouse", "transmittal_ipas_po_lines", { p_ipas_number: "IPAS-NOPE-0" })
        expect(unknown.error).toBeTruthy()
    })

    it("lets the preparer keep some lines and change a quantity, with the slip rules as before", async () => {
        const ipas = await raiseIpas()
        const { data: lines } = await rpc("warehouse", "transmittal_ipas_po_lines", { p_ipas_number: ipas.number })
        // Unticked the first line; the second arrived in part (5 of 12).
        const kept = [{ kind: "po_line", ipas_id: ipas.id, odoo_po_line_id: lines[1].odoo_po_line_id, quantity: 5 }]
        const created = await rpc("warehouse", "transmittal_create", {
            p_fields: HEADER, p_product_ids: [], p_reference_ids: [], p_lines: kept,
        })
        expect(created.error).toBeNull()
        const { data: rows } = await svc().from("transmittal_lines").select("odoo_po_line_id, quantity").eq("transmittal_id", created.data.id)
        expect(rows).toHaveLength(1)
        expect(Number(rows[0].quantity)).toBe(5)

        // A line that is not on the IPAS is still refused.
        const bad = await rpc("warehouse", "transmittal_create", {
            p_fields: HEADER, p_product_ids: [], p_reference_ids: [],
            p_lines: [{ ...kept[0], odoo_po_line_id: 1 }],
        })
        expect(bad.error).toBeTruthy()
    })
})
