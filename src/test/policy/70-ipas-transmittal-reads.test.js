/**
 * IPAS reads Transmittals (#256, spec #251): the hand stamp of Actual Checking
 * is refused once a submitted, uncancelled Transmittal carries a P0 line of the
 * IPAS, and allowed before. Builds on 68 and 69 (the same seeds and helpers).
 *
 * The freeze is proven against the service role, which bypasses row level
 * security but not a trigger.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P8${String(30000 + (poSeq += 1)).padStart(6, "0")}`

const odooCopy = (po) => ({
    po: { id: 992000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 553, name: "Scorpe Technologies", contact: null },
    lines: [
        { line_id: 942000 + poSeq * 10, product_id: 5350, name: "Cutter", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [], brand: "SCORPE" },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raiseIpas() {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: odooCopy(po),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const HEADER = { origin: "purchasing", check_warehouse: true, check_technical: false, priority: "high", entity: "T3ck Trading" }

/** A draft slip with one P0 line of the IPAS, as the warehouse member. Returns its id. */
async function draftSlip(ipas) {
    const { data: made, error } = await rpc("warehouse", "transmittal_create", {
        p_fields: HEADER,
        p_product_ids: [],
        p_reference_ids: [],
        p_lines: [{ kind: "po_line", ipas_id: ipas.id, odoo_po_line_id: ipas.odoo_copy.lines[0].line_id, quantity: 6 }],
    })
    if (error) throw new Error(`transmittal_create: ${error.message}`)
    return made.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    const { error } = await svc()
        .from("ipas_signer_lists")
        .upsert({ list_key: "transmittal_warehouse", employee_id: ids.warehouse }, { onConflict: "list_key,employee_id" })
    if (error) throw new Error(`Seeding transmittal_warehouse: ${error.message}`)
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
})

describe("the hand stamp of Actual Checking", () => {
    it("is allowed on an IPAS no submitted Transmittal carries", async () => {
        const ipas = await raiseIpas()
        const { error } = await svc()
            .from("ipas")
            .update({ actual_checking_by: ids.outsider, actual_checking_at: new Date().toISOString() })
            .eq("id", ipas.id)
        expect(error).toBeNull()
    })

    it("is allowed while the Transmittal is still a draft", async () => {
        const ipas = await raiseIpas()
        await draftSlip(ipas)
        const { error } = await svc()
            .from("ipas")
            .update({ actual_checking_by: ids.outsider, actual_checking_at: new Date().toISOString() })
            .eq("id", ipas.id)
        expect(error).toBeNull()
    })

    it("is refused once a submitted Transmittal carries the IPAS's line", async () => {
        const ipas = await raiseIpas()
        const slip = await draftSlip(ipas)
        const { error: submitError } = await rpc("warehouse", "transmittal_submit", { p_transmittal_id: slip })
        expect(submitError).toBeNull()

        const { error } = await svc()
            .from("ipas")
            .update({ actual_checking_by: ids.outsider, actual_checking_at: new Date().toISOString() })
            .eq("id", ipas.id)
        expect(error, "a hand stamp went through a governed IPAS").toBeTruthy()
        expect(error.message).toMatch(/stamped by the Transmittals/)
    })
})
