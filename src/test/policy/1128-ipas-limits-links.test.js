/**
 * Limits, plain messages and own-file links (#1128, spec #1123 T5; tracker D1, D2, C1, A4), against the real database.
 *
 * The IPAS header, the Packing List boxes and contents refuse what is too long or too big with a sentence (never
 * "numeric field overflow" or "Failing row contains"), a second live IPAS on one PO says which one, and a document,
 * proof of payment or charge file must be a link into the app's own file store. `outsider` holds Purchasing access.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"
import { makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

const OWN = "https://res.cloudinary.com/demo/raw/upload/1128.pdf"
const OTHER = "https://example.com/x.pdf"

let poSeq = 0
let methodId = null
let kindId = null

const copyFor = (po) => ({
    po: { id: 1128000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "PHP", origin: null, partner_ref: null },
    supplier: { id: 9_128_000 + poSeq, name: "Limits Supplier", contact: null },
    lines: [{ line_id: 1128500 + poSeq * 10, product_id: 7700, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null }],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const raiseWith = (po, over = {}) =>
    raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po),
        ...over,
    })

async function raise() {
    const po = `P9${String(112800 + (poSeq += 1)).padStart(6, "0")}`
    const { data, error } = await raiseWith(po)
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const setHeader = (ipasId, fields) => rpc("outsider", "ipas_set_header", { p_ipas_id: ipasId, p_fields: fields })
const savePayment = (ipasId, over = {}) =>
    rpc("outsider", "ipas_save_payment", {
        p_ipas_id: ipasId,
        p_payment_id: null,
        p_kind: "payment",
        p_paid_on: "2026-01-05",
        p_amount: 300,
        p_forex_rate: null,
        p_doc_stamp_php: 0,
        p_misc_fee_php: 0,
        p_charge_fee_php: 0,
        p_method_id: methodId,
        p_check_no: null,
        p_proof_url: null,
        p_percent_of_order: null,
        ...over,
    })

const CAST_IDS = () => CAST_KEYS.map((k) => ids[k])

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    methodId = (await svc().from("ipas_options").select("id").eq("list", "payment_method").eq("label", "Dated Check").single()).data.id
    kindId = (await svc().from("ipas_options").select("id").eq("list", "charge_kind").eq("label", "Brokerage Fee").single()).data.id
    const { error } = await svc()
        .from("ipas_signer_lists")
        .upsert({ list_key: "transmittal_warehouse", employee_id: ids.warehouse }, { onConflict: "list_key,employee_id" })
    if (error) throw new Error(`Seeding the Warehouse list: ${error.message}`)
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", CAST_IDS())
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("IPAS header limits", () => {
    it("refuses a 61-character P.I # and a 2,001-character Remarks with a sentence", async () => {
        const ipas = await raise()
        const pi = await setHeader(ipas.id, { pi_number: "x".repeat(61) })
        expect(pi.error?.message).toContain("P.I # can be at most 60 characters")
        const remarks = await setHeader(ipas.id, { remarks: "x".repeat(2001) })
        expect(remarks.error?.message).toContain("Remarks can be at most 2,000 characters")
        expect((await setHeader(ipas.id, { pi_number: "x".repeat(60), remarks: "x".repeat(2000) })).error).toBeNull()
    })

    it("refuses a raise with Remarks over 2,000 characters", async () => {
        const po = `P9${String(112800 + (poSeq += 1)).padStart(6, "0")}`
        const { error } = await raiseWith(po, { p_remarks: "x".repeat(2001) })
        expect(error?.message).toContain("Remarks can be at most 2,000 characters")
    })

    it("saves three spaces in Supplier contact as empty, and refuses over 200", async () => {
        const ipas = await raise()
        const blank = await setHeader(ipas.id, { supplier_contact: "   " })
        expect(blank.error).toBeNull()
        expect(blank.data.supplier_contact).toBeNull()
        const long = await setHeader(ipas.id, { supplier_contact: "x".repeat(201) })
        expect(long.error?.message).toContain("at most 200 characters")
    })

    it("refuses a P.I/QT Amount of 10^15 in words, never numeric field overflow", async () => {
        const ipas = await raise()
        const { error } = await setHeader(ipas.id, { pi_qt_amount: "1000000000000000" })
        expect(error?.message).toContain("P.I/QT Amount is at most 9,999,999,999.99")
        expect(error?.message).not.toMatch(/overflow/i)
        expect((await setHeader(ipas.id, { pi_qt_amount: "9999999999.99" })).error).toBeNull()
    })

    it("says which IPAS is live when a PO is raised twice", async () => {
        const ipas = await raise()
        const { error } = await raiseWith(ipas.po_number)
        expect(error?.message).toContain(`${ipas.po_number} already has a live IPAS (${ipas.number})`)
        expect(error?.message).not.toContain("ipas_live_po_number_key")
    })
})

describe("own-file links", () => {
    it("refuses another site's link as a document, accepts an uploaded file", async () => {
        const ipas = await raise()
        const doc = (await svc().from("ipas_documents").select("id").eq("ipas_id", ipas.id).limit(1).single()).data
        const refused = await rpc("outsider", "ipas_add_document_file", { p_document_id: doc.id, p_url: OTHER, p_file_name: "x.pdf" })
        expect(refused.error?.message).toContain("not a link to another site")
        const accepted = await rpc("outsider", "ipas_add_document_file", { p_document_id: doc.id, p_url: OWN, p_file_name: "1128.pdf" })
        expect(accepted.error).toBeNull()
        expect(accepted.data.url).toBe(OWN)
    })

    it("refuses another site's link on a hand-added document and on a payment's proof", async () => {
        const ipas = await raise()
        const added = await rpc("outsider", "ipas_add_document", { p_ipas_id: ipas.id, p_kind_id: null, p_label: "Memo", p_attachment_url: OTHER })
        expect(added.error?.message).toContain("not a link to another site")
        const paid = await savePayment(ipas.id, { p_proof_url: OTHER })
        expect(paid.error?.message).toContain("not a link to another site")
        expect((await savePayment(ipas.id, { p_proof_url: OWN })).error).toBeNull()
    })

    it("refuses another site's link on a charge file", async () => {
        const ipas = await raise()
        const charge = await rpc("outsider", "ipas_add_charge", { p_ipas_id: ipas.id, p_kind_id: kindId, p_charged_on: "2026-01-05", p_amount_php: 100 })
        const fill = (url) =>
            rpc("outsider", "ipas_fill_charge", { p_charge_id: charge.data.id, p_charged_on: "2026-01-05", p_amount_php: 120, p_attachment_url: url })
        expect((await fill(OTHER)).error?.message).toContain("not a link to another site")
        expect((await fill(OWN)).error).toBeNull()
    })
})

describe("Packing List box limits", () => {
    const box = async (listId, over = {}) =>
        rpc("warehouse", "packing_list_add_box", { p_packing_list_id: listId, p_marks: "A", p_seal_no: null, p_gross_weight_kg: null, ...over })

    async function list() {
        const sor = await makeSor({ registeredBy: ids.outsider, dealOwnerId: ids.dealOwner })
        const made = await rpc("warehouse", "packing_list_create", { p_opportunity_id: sor, p_odoo_delivery_ref: null })
        if (made.error) throw new Error(made.error.message)
        return made.data
    }

    it("refuses 5,001 kg, a negative weight and over-long marks in words", async () => {
        const made = await list()
        const heavy = await box(made.id, { p_gross_weight_kg: 5001 })
        expect(heavy.error?.message).toContain("A box can weigh at most 5,000 kg")
        const negative = await box(made.id, { p_gross_weight_kg: -1 })
        expect(negative.error?.message).toContain("A box can't weigh less than 0 kg")
        const marks = await box(made.id, { p_marks: "m".repeat(201) })
        expect(marks.error?.message).toContain("Marks can be at most 200 characters")
        for (const result of [heavy, negative, marks]) expect(result.error?.message).not.toMatch(/Failing row|violates/)
        expect((await box(made.id, { p_gross_weight_kg: 5000 })).error).toBeNull()
    })

    it("refuses a contents quantity of 0 or over 100,000, and a blank line, in words", async () => {
        const made = await list()
        const added = await box(made.id)
        const set = (contents) => rpc("warehouse", "packing_list_set_contents", { p_box_id: added.data.id, p_contents: contents })
        expect((await set([{ description: "Cable", quantity: 0, unit: "m" }])).error?.message).toContain("quantity above zero")
        expect((await set([{ description: "Cable", quantity: 100001, unit: "m" }])).error?.message).toContain("at most 100,000")
        expect((await set([{ description: " ", quantity: 1, unit: "m" }])).error?.message).toContain("needs a description")
        expect((await set([{ description: "Cable", quantity: 100000, unit: "m" }])).error).toBeNull()
    })
})
