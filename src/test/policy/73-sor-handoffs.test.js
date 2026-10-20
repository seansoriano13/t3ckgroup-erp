/**
 * The SOR shows its handoffs (#257, spec #251): `handoffs_for_sor` returns the
 * Transmittals naming an SOR and its Packing Lists, to anyone who can read the
 * SOR and to nobody else, and never a remark, file or evidence path. Builds on
 * 68 to 72 (the same cast and helpers).
 *
 * `dealOwner` owns the SOR, so reads through it are proven; `ordinary` cannot
 * read the SOR and gets nothing back.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { raiseAsPurchaser } from "./support/ipas.js"
import { makeSor } from "./support/rows.js"
import { canRead } from "./support/access.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P7${String(20000 + (poSeq += 1)).padStart(6, "0")}`

const odooCopy = (po) => ({
    po: { id: 661000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 553, name: "Scorpe Technologies", contact: null },
    lines: [
        { line_id: 651000 + poSeq * 10, product_id: 5350, name: "Cutter", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [], brand: "SCORPE" },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

/** A live IPAS for a PO that names the SOR, so the slip's line carries it. */
async function raiseIpasFor(sorId) {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "project",
        p_sor_ids: [sorId],
        p_remarks: null,
        p_odoo_copy: odooCopy(po),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

/** A submitted slip on the SOR, with its PO line. Returns its number. */
async function submittedSlipFor(sorId) {
    const ipas = await raiseIpasFor(sorId)
    const { data: made, error } = await rpc("warehouse", "transmittal_create", {
        p_fields: { origin: "purchasing", check_warehouse: true, check_technical: true, priority: "high", entity: "T3ck Trading" },
        p_product_ids: [],
        p_reference_ids: [],
        p_lines: [{ kind: "po_line", ipas_id: ipas.id, odoo_po_line_id: ipas.odoo_copy.lines[0].line_id, quantity: 6 }],
    })
    if (error) throw new Error(`transmittal_create: ${error.message}`)
    const { error: submitError } = await rpc("warehouse", "transmittal_submit", { p_transmittal_id: made.id })
    if (submitError) throw new Error(`transmittal_submit: ${submitError.message}`)
    return made
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    const { error } = await svc()
        .from("ipas_signer_lists")
        .upsert({ list_key: "transmittal_warehouse", employee_id: ids.warehouse }, { onConflict: "list_key,employee_id" })
    if (error) throw new Error(`Seeding the Warehouse list: ${error.message}`)
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
})

describe("the SOR's handoffs, to a reader of the SOR only", () => {
    it("shows the Transmittals naming the SOR, and its Packing Lists, to the deal owner", async () => {
        const sor = await makeSor({ registeredBy: ids.outsider, dealOwnerId: ids.dealOwner })
        const slip = await submittedSlipFor(sor)
        const { data: packingList, error: listError } = await rpc("warehouse", "packing_list_create", {
            p_opportunity_id: sor,
            p_odoo_delivery_ref: "TG En/OUT/04410",
        })
        expect(listError).toBeNull()

        const { data, error } = await rpc("dealOwner", "handoffs_for_sor", { p_opportunity_id: sor })
        expect(error).toBeNull()

        expect(data.transmittals).toEqual([
            expect.objectContaining({ id: slip.id, number: slip.number, state: "warehouse_checking", na_count: 0, can_open: false }),
        ])
        expect(data.packing_lists).toEqual([
            expect.objectContaining({ id: packingList.id, number: packingList.number, state: "draft", box_count: 0, odoo_delivery_ref: "TG En/OUT/04410" }),
        ])
    })

    it("leaves out a draft Transmittal", async () => {
        const sor = await makeSor({ registeredBy: ids.outsider, dealOwnerId: ids.dealOwner })
        const ipas = await raiseIpasFor(sor)
        const { error: draftError } = await rpc("warehouse", "transmittal_create", {
            p_fields: { origin: "purchasing", check_warehouse: true, check_technical: false, priority: "low", entity: "T3ck Trading" },
            p_product_ids: [],
            p_reference_ids: [],
            p_lines: [{ kind: "po_line", ipas_id: ipas.id, odoo_po_line_id: ipas.odoo_copy.lines[0].line_id, quantity: 1 }],
        })
        expect(draftError).toBeNull()
        const { data, error } = await rpc("dealOwner", "handoffs_for_sor", { p_opportunity_id: sor })
        expect(error).toBeNull()
        expect(data.transmittals).toEqual([])
    })

    it("lets the Warehouse list find the SOR and read its Product List without prices; refuses anyone else", async () => {
        const sor = await makeSor({ registeredBy: ids.outsider, dealOwnerId: ids.dealOwner })
        const ref = { sales_reference: `S9${String(Date.now()).slice(-5)}` }
        const { error: refError } = await svc().from("sales_opportunities").update(ref).eq("id", sor)
        expect(refError).toBeNull()
        const { error: itemError } = await svc()
            .from("sales_opportunity_items")
            .insert({ opportunity_id: sor, product_name: "Rope kit", quantity: 3, unit: "set", unit_price: 999, sort_order: 1 })
        expect(itemError).toBeNull()

        const found = await rpc("warehouse", "ipas_find_sors", { p_refs: [ref.sales_reference], p_search: null })
        expect(found.error).toBeNull()
        expect(found.data.map((r) => r.opportunity_id)).toContain(sor)

        const products = await rpc("warehouse", "packing_list_sor_products", { p_opportunity_id: sor })
        expect(products.error).toBeNull()
        expect(products.data).toEqual([expect.objectContaining({ product_name: "Rope kit", quantity: 3, unit: "set" })])
        expect(Object.keys(products.data[0])).not.toContain("unit_price")

        for (const who of ["ordinary", "dealOwner"]) {
            const refused = await rpc(who, "packing_list_sor_products", { p_opportunity_id: sor })
            expect(refused.error?.code, who).toBe("42501")
        }
    })

    it("returns nothing to an employee who cannot read the SOR", async () => {
        const sor = await makeSor({ registeredBy: ids.outsider, dealOwnerId: ids.dealOwner })
        await submittedSlipFor(sor)

        // The first cast member the SOR's read rule refuses, so the test does not assume who that is.
        let outsiderOfSor = null
        for (const who of ["ordinary", "hr", "finance", "leaveManager", "logistics", "warehouse", "technical"]) {
            if (!(await canRead(await clientFor(who), "sales_opportunities", sor))) {
                outsiderOfSor = who
                break
            }
        }
        expect(outsiderOfSor, "no cast member is refused the SOR").not.toBeNull()

        const { data, error } = await rpc(outsiderOfSor, "handoffs_for_sor", { p_opportunity_id: sor })
        expect(error).toBeNull()
        expect(data.transmittals, outsiderOfSor).toEqual([])
        expect(data.packing_lists, outsiderOfSor).toEqual([])
    })

    it("carries no remark, file or evidence path, in any row", async () => {
        const sor = await makeSor({ registeredBy: ids.outsider, dealOwnerId: ids.dealOwner })
        await submittedSlipFor(sor)
        await rpc("warehouse", "packing_list_create", { p_opportunity_id: sor, p_odoo_delivery_ref: null })

        const { data, error } = await rpc("dealOwner", "handoffs_for_sor", { p_opportunity_id: sor })
        expect(error).toBeNull()

        const rows = [...data.transmittals, ...data.packing_lists]
        expect(rows.length).toBeGreaterThan(0)
        const allowed = new Set(["id", "number", "prepared_on", "priority", "state", "na_count", "can_open", "box_count", "odoo_delivery_ref"])
        for (const row of rows) {
            for (const key of Object.keys(row)) {
                expect(allowed.has(key), `unexpected column ${key}`).toBe(true)
            }
            expect(JSON.stringify(row)).not.toMatch(/remark|storage_path|evidence|file_name/)
        }
    })
})
