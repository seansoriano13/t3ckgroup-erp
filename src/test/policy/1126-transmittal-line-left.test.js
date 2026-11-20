/**
 * What a Transmittal line has left (#1126, spec #1123, tracker B1 + B3).
 *   - transmittal_pickable_po_lines / transmittal_ipas_po_lines return "left": the P0 quantity
 *     less what live (not cancelled) slips carry, a line rated NA counting as not delivered.
 *   - A slip that carries more than a line has left gets an 'over_claim' warning from
 *     transmittal_create, transmittal_update_draft and transmittal_submit. It is never an error.
 *   - A unit counted in whole things refuses a decimal; a measured unit takes one.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded, castEmail } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P8${String(10000 + (poSeq += 1)).padStart(6, "0")}`

const line = (id, name, quantity, unit = "Unit") => ({
    line_id: id, product_id: 5350, name, quantity, unit, price_unit: 100, price_subtotal: 100 * quantity,
    taxes: [], analytic: [], brand: "SCORPE",
})

async function raiseIpas(lines) {
    const po = nextPo()
    const base = 981000 + poSeq * 10
    const built = lines(base)
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
            lines: built,
            receipts: { status: "pending", done: 0, total: 1 },
            bills: { count: 0, draft: 0 },
        },
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return { ...data, lineIds: built.map((l) => l.line_id) }
}

const HEADER = { origin: "purchasing", check_warehouse: true, check_technical: false, priority: "high", entity: "T3ck Trading" }

const slip = (who, ipas, lineId, quantity, extra = {}) =>
    rpc(who, "transmittal_create", {
        p_fields: HEADER,
        p_product_ids: [],
        p_reference_ids: [],
        p_lines: [{ kind: "po_line", ipas_id: ipas.id, odoo_po_line_id: lineId, quantity, ...extra }],
    })

const leftOf = async (ipas, lineId) => {
    const { data, error } = await rpc("warehouse", "transmittal_ipas_po_lines", { p_ipas_number: ipas.number })
    expect(error).toBeNull()
    return Number(data.find((r) => r.odoo_po_line_id === lineId).left)
}

beforeAll(async () => {
    await ensureCastLoaded()
    const { error } = await svc()
        .from("ipas_signer_lists")
        .upsert({ list_key: "transmittal_warehouse", employee_id: ids.warehouse }, { onConflict: "list_key,employee_id" })
    if (error) throw new Error(`Seeding the warehouse list for ${castEmail("warehouse")}: ${error.message}`)
})

afterAll(async () => {
    await svc().from("ipas_signer_lists").delete().eq("employee_id", ids.warehouse).eq("list_key", "transmittal_warehouse")
})

describe("what a P0 line has left", () => {
    it("is the P0 quantity less what live slips carry, in both pickers", async () => {
        const ipas = await raiseIpas((base) => [line(base + 1, "Cutter", 5)])
        const lineId = ipas.lineIds[0]
        expect(await leftOf(ipas, lineId)).toBe(5)

        const first = await slip("warehouse", ipas, lineId, 5)
        expect(first.error).toBeNull()
        expect(first.data.warnings).toEqual([])
        expect(await leftOf(ipas, lineId)).toBe(0)

        const picked = await rpc("warehouse", "transmittal_pickable_po_lines", { p_search: ipas.po_number })
        expect(picked.error).toBeNull()
        expect(Number(picked.data[0].left)).toBe(0)
    })

    it("gives a cancelled slip's quantity back, and counts a line rated NA as not delivered", async () => {
        const ipas = await raiseIpas((base) => [line(base + 1, "Cutter", 5)])
        const lineId = ipas.lineIds[0]

        const cancelled = await slip("warehouse", ipas, lineId, 2)
        const cancel = await rpc("warehouse", "transmittal_cancel", { p_transmittal_id: cancelled.data.id, p_reason: "test" })
        expect(cancel.error).toBeNull()
        expect(await leftOf(ipas, lineId)).toBe(5)

        const first = await slip("warehouse", ipas, lineId, 5)
        expect(await leftOf(ipas, lineId)).toBe(0)
        const rated = await svc()
            .from("transmittal_lines")
            .update({ wh_rating: "na", wh_remark: "Damaged on arrival" })
            .eq("transmittal_id", first.data.id)
        expect(rated.error).toBeNull()
        expect(await leftOf(ipas, lineId)).toBe(5)
    })
})

describe("a slip that carries more than is left", () => {
    it("is warned, not refused, on create, update and submit; a remark is kept on the line", async () => {
        const ipas = await raiseIpas((base) => [line(base + 1, "Cutter", 5)])
        const lineId = ipas.lineIds[0]
        expect((await slip("warehouse", ipas, lineId, 5)).error).toBeNull()

        const second = await slip("warehouse", ipas, lineId, 3)
        expect(second.error).toBeNull()
        expect(second.data.warnings).toEqual([
            expect.objectContaining({ kind: "over_claim", position: 1, left: 0, carrying: 3, more: 3, has_remark: false }),
        ])

        const updated = await rpc("warehouse", "transmittal_update_draft", {
            p_transmittal_id: second.data.id,
            p_fields: HEADER,
            p_product_ids: [],
            p_reference_ids: [],
            p_lines: [{ kind: "po_line", ipas_id: ipas.id, odoo_po_line_id: lineId, quantity: 3, over_claim_remark: "Replaces the NA unit" }],
        })
        expect(updated.error).toBeNull()
        expect(updated.data.warnings).toEqual([expect.objectContaining({ kind: "over_claim", more: 3, has_remark: true })])
        const stored = await svc().from("transmittal_lines").select("over_claim_remark").eq("transmittal_id", second.data.id)
        expect(stored.data[0].over_claim_remark).toBe("Replaces the NA unit")

        const submitted = await rpc("warehouse", "transmittal_submit", { p_transmittal_id: second.data.id })
        expect(submitted.error).toBeNull()
        expect(submitted.data.state).toBe("warehouse_checking")
        expect(submitted.data.warnings).toEqual([expect.objectContaining({ kind: "over_claim", has_remark: true })])
    })

    it("does not warn about a slip that fits, or count the slip being written against itself", async () => {
        const ipas = await raiseIpas((base) => [line(base + 1, "Cutter", 5)])
        const lineId = ipas.lineIds[0]
        const part = await slip("warehouse", ipas, lineId, 2)
        expect(part.data.warnings).toEqual([])
        const rest = await slip("warehouse", ipas, lineId, 3)
        expect(rest.data.warnings).toEqual([])
        const resaved = await rpc("warehouse", "transmittal_update_draft", {
            p_transmittal_id: rest.data.id,
            p_fields: HEADER,
            p_product_ids: [],
            p_reference_ids: [],
            p_lines: [{ kind: "po_line", ipas_id: ipas.id, odoo_po_line_id: lineId, quantity: 3 }],
        })
        expect(resaved.data.warnings).toEqual([])
    })
})

describe("quantity units", () => {
    it("refuses a decimal on pc, Unit, Set, Pair and Kit, and takes one on m, kg and L", async () => {
        const ipas = await raiseIpas((base) => [
            line(base + 1, "Cutter", 10, "pc"),
            line(base + 2, "Cable", 10, "m"),
            line(base + 3, "Resin", 10, "kg"),
        ])
        const [pc, metre, kilo] = ipas.lineIds
        expect((await slip("warehouse", ipas, pc, 2.5)).error).toBeTruthy()
        expect((await slip("warehouse", ipas, pc, 2)).error).toBeNull()
        expect((await slip("warehouse", ipas, metre, 2.5)).error).toBeNull()
        expect((await slip("warehouse", ipas, kilo, 0.5)).error).toBeNull()
    })

    it("refuses zero and a negative quantity", async () => {
        const ipas = await raiseIpas((base) => [line(base + 1, "Cutter", 5)])
        const lineId = ipas.lineIds[0]
        expect((await slip("warehouse", ipas, lineId, -3)).error).toBeTruthy()
        expect((await slip("warehouse", ipas, lineId, 0)).error).toBeTruthy()
    })
})
