/**
 * IPAS and TG03 numbers without gaps from refused saves (#1129, spec #1123, tracker D3).
 *   - transmittal_create checks the lines before it inserts the header, so a refused create
 *     takes no TG03 number: the next good create follows the last good one.
 *   - ipas_raise_from_odoo locks the PO number, so of four parallel raises of one PO one wins,
 *     and the next IPAS number follows the winner's with no gap.
 * Both read the series from the numbers handed back, never from a count.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded, castEmail } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P7${String(29000 + (poSeq += 1)).padStart(6, "0")}`

const copyFor = (po) => ({
    po: { id: 729000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_729_000 + poSeq, name: "Gap Supplier", contact: null },
    lines: [
        { line_id: 729100 + poSeq * 10, product_id: 7700, name: "Item 1", quantity: 1, unit: "Unit", price_unit: 100, price_subtotal: 100, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const raisePo = (po) =>
    raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po),
    })

const ipasValue = (number) => Number(number.slice("TGIPAS_".length))
const slipValue = (number) => Number(number.slice("TG03-".length))

const HEADER = { origin: "purchasing", check_warehouse: true, check_technical: false, priority: "high", entity: "T3ck Trading" }
const typedLine = (description) => ({ kind: "typed", description, quantity: 1, unit: "Unit" })

const slip = (lines) =>
    rpc("warehouse", "transmittal_create", { p_fields: HEADER, p_product_ids: [], p_reference_ids: [], p_lines: lines })

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

describe("TG03 numbers", () => {
    it("a refused create takes no number: the next good create follows the last good one", async () => {
        const first = await slip([typedLine("Gap check one")])
        expect(first.error).toBeNull()

        const blank = await slip([typedLine("   ")])
        expect(blank.error).toBeTruthy()
        const zero = await slip([{ ...typedLine("Gap check zero"), quantity: 0 }])
        expect(zero.error).toBeTruthy()
        const noKind = await slip([{ description: "No kind", quantity: 1, unit: "Unit" }])
        expect(noKind.error).toBeTruthy()

        const next = await slip([typedLine("Gap check two")])
        expect(next.error).toBeNull()
        expect(slipValue(next.data.number)).toBe(slipValue(first.data.number) + 1)
    })
})

describe("IPAS numbers", () => {
    it("four parallel raises of one PO give one IPAS, and the next number follows it", async () => {
        const po = nextPo()
        const results = await Promise.all([raisePo(po), raisePo(po), raisePo(po), raisePo(po)])
        const won = results.filter((r) => !r.error)
        const refused = results.filter((r) => r.error)
        expect(won).toHaveLength(1)
        expect(refused).toHaveLength(3)
        for (const r of refused) expect(r.error.code).toBe("23505")

        const next = await raisePo(nextPo())
        expect(next.error).toBeNull()
        expect(ipasValue(next.data.number)).toBe(ipasValue(won[0].data.number) + 1)
    })
})
