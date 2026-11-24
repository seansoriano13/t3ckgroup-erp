/**
 * Payment rows (#1211, spec #1205): the typed method for "Others" and several proof files.
 * `outsider` holds Purchasing access. Needs the local database stack.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)
const OWN = "https://res.cloudinary.com/demo/image/upload/pop.png"
const OWN_2 = "https://res.cloudinary.com/demo/image/upload/slip.png"

let poSeq = 0
let othersId = null
let ttId = null

const copyFor = (po) => ({
    po: { id: 1211000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "PHP", origin: null, partner_ref: null },
    supplier: { id: 9_211_000 + poSeq, name: "Payment Rows Supplier", contact: null },
    lines: [{ line_id: 1211500 + poSeq * 10, product_id: 7700, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null }],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise() {
    const po = `P9${String(121100 + (poSeq += 1)).padStart(6, "0")}`
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po, p_priority: "high", p_source: "local", p_purpose: "inventory", p_sor_ids: [], p_remarks: null, p_odoo_copy: copyFor(po),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const save = (ipasId, over = {}) =>
    rpc("outsider", "ipas_save_payment", {
        p_ipas_id: ipasId, p_payment_id: null, p_kind: "payment", p_paid_on: "2026-11-10", p_amount: 300, p_forex_rate: null,
        p_doc_stamp_php: 0, p_misc_fee_php: 0, p_charge_fee_php: 0, p_method_id: ttId, p_check_no: null, p_proof_url: null, p_percent_of_order: null, ...over,
    })

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    othersId = (await svc().from("ipas_options").select("id").eq("list", "payment_method").eq("label", "Others").single()).data.id
    ttId = (await svc().from("ipas_options").select("id").eq("list", "payment_method").eq("label", "Bank TT").single()).data.id
})

afterAll(async () => {
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("the Others method", () => {
    it("refuses Others without the typed method, and stores the text with it", async () => {
        const ipas = await raise()
        const refused = await save(ipas.id, { p_method_id: othersId })
        expect(refused.error?.message).toMatch(/type the payment method/i)
        const saved = await save(ipas.id, { p_method_id: othersId, p_method_other: "  GCash  " })
        expect(saved.error).toBeNull()
        expect(saved.data.method_other).toBe("GCash")
    })

    it("keeps no typed text on another method", async () => {
        const ipas = await raise()
        const saved = await save(ipas.id, { p_method_id: ttId, p_method_other: "GCash" })
        expect(saved.error).toBeNull()
        expect(saved.data.method_other).toBeNull()
    })
})

describe("proof files", () => {
    it("holds two files on one payment, and drops the one that leaves the list", async () => {
        const ipas = await raise()
        const saved = await save(ipas.id, { p_proof_urls: [OWN, OWN_2] })
        expect(saved.error).toBeNull()
        const files = () => svc().from("ipas_payment_files").select("url").eq("payment_id", saved.data.id)
        expect((await files()).data.map((f) => f.url).sort()).toEqual([OWN, OWN_2].sort())
        expect(saved.data.proof_url).toBe(OWN)
        const edited = await save(ipas.id, { p_payment_id: saved.data.id, p_ipas_id: null, p_proof_urls: [OWN_2] })
        expect(edited.error).toBeNull()
        expect((await files()).data.map((f) => f.url)).toEqual([OWN_2])
    })

    it("refuses a file that is not from the own file store", async () => {
        const ipas = await raise()
        const saved = await save(ipas.id, { p_proof_urls: [OWN, "https://evil.example/x.pdf"] })
        expect(saved.error?.message).toMatch(/ipas_file_link/)
    })
})
