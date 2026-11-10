/**
 * Finance and the IPAS files (#937, spec #927): Finance attaches proof of payment
 * (a payment's proof_url, through ipas_update_payment) and cannot attach a document
 * (ipas_set_document_attachment is Purchasing's). Purchasing can do both.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const CAST_IDS = () => CAST_KEYS.map((k) => ids[k])
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)
const PROOF = "https://example.com/proof.pdf"

let ipasId = null
let methodId = null
let paymentId = null

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    methodId = (await svc().from("ipas_options").select("id").eq("list", "payment_method").eq("label", "Dated Check").single()).data.id
    const po = "P9937001"
    const raised = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: {
            po: { id: 937000, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
            supplier: { id: 9_370_000, name: "Finance Proof Supplier", contact: null },
            lines: [{ line_id: 937100, product_id: 7700, name: "Item 1", quantity: 2, unit: "Unit", price_unit: 100, price_subtotal: 200, taxes: [], analytic: [], brand: null }],
            receipts: { status: "pending", done: 0, total: 1 },
            bills: { count: 0, draft: 0 },
        },
    })
    if (raised.error) throw new Error(raised.error.message)
    ipasId = raised.data.id
    const added = await rpc("outsider", "ipas_add_payment", {
        p_ipas_id: ipasId, p_kind: "down_payment", p_paid_on: "2026-10-01", p_amount: 200, p_php_debited: 200,
        p_charge_fee_php: 0, p_method_id: methodId, p_check_no: null, p_proof_url: null,
    })
    if (added.error) throw new Error(added.error.message)
    paymentId = added.data.id
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", CAST_IDS())
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("Finance and IPAS files (#937)", () => {
    it("lets Finance attach proof of payment", async () => {
        const { error } = await rpc("finance", "ipas_update_payment", {
            p_payment_id: paymentId, p_kind: "down_payment", p_paid_on: "2026-10-01", p_amount: 200, p_php_debited: 200,
            p_charge_fee_php: 0, p_method_id: methodId, p_check_no: null, p_proof_url: PROOF,
        })
        expect(error).toBeNull()
        const row = (await svc().from("ipas_payments").select("proof_url").eq("id", paymentId).single()).data
        expect(row.proof_url).toBe(PROOF)
    })

    it("refuses Finance attaching any other document", async () => {
        const doc = (await svc().from("ipas_documents").select("id").eq("ipas_id", ipasId).limit(1)).data?.[0]
        expect(doc).toBeTruthy()
        const { error } = await rpc("finance", "ipas_set_document_attachment", { p_document_id: doc.id, p_attachment_url: PROOF })
        expect(error?.code).toBe("42501")
    })

    it("still lets Purchasing attach a document", async () => {
        const doc = (await svc().from("ipas_documents").select("id").eq("ipas_id", ipasId).limit(1)).data?.[0]
        const { error } = await rpc("outsider", "ipas_set_document_attachment", { p_document_id: doc.id, p_attachment_url: PROOF })
        expect(error).toBeNull()
    })
})
