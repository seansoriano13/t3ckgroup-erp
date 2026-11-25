/**
 * The IPAS Chat keeps the money history (#1226, spec #1220): every ask, payment and charge change leaves
 * exactly one event line, with its amounts. An edit names only the fields that changed, each with its
 * before and after. Event lines notify nobody.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P9${String(95000 + (poSeq += 1)).padStart(6, "0")}`

async function raise() {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: {
            po: { id: 951000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "EUR", origin: null, partner_ref: null },
            supplier: { id: 9_951_000 + poSeq, name: "Money Lines Supplier", contact: null },
            lines: [
                { line_id: 951500 + poSeq * 10, product_id: 7700, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null },
            ],
            receipts: { status: "pending", done: 0, total: 1 },
            bills: { count: 0, draft: 0 },
        },
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const optionId = async (list, label) =>
    (await svc().from("ipas_options").select("id").eq("list", list).eq("label", label).single()).data.id
const methodId = async () => (await svc().from("ipas_options").select("id").eq("list", "payment_method").limit(1).single()).data.id
const lines = async (ipasId) =>
    (await svc().from("ipas_messages").select("content, metadata, author_id").eq("ipas_id", ipasId).order("created_at")).data.filter((m) => m.metadata?.event)
const events = async (ipasId) => (await lines(ipasId)).map((m) => m.metadata.event)

const ask = (ipasId, over = {}) =>
    rpc("outsider", "ipas_ask_for_payment", { p_ipas_id: ipasId, p_amount: 5600, p_purpose: "down_payment", p_note: null, ...over })
const save = async (ipasId, paymentId, over = {}) =>
    rpc("outsider", "ipas_save_payment", {
        p_ipas_id: ipasId, p_payment_id: paymentId, p_kind: "down_payment", p_paid_on: "2026-11-20", p_amount: 5000, p_forex_rate: 60,
        p_doc_stamp_php: 0, p_misc_fee_php: 0, p_charge_fee_php: 0, p_method_id: await methodId(), p_check_no: null, p_proof_url: null,
        ...over,
    })

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("ask lines", () => {
    it("writes one line each for opened, edited, withdrawn and paid, with amounts", async () => {
        const ipas = await raise()
        const first = (await ask(ipas.id)).data
        expect((await rpc("outsider", "ipas_edit_payment_ask", { p_ask_id: first.id, p_amount: 6000, p_priority: "very_high", p_note: null })).error).toBeNull()
        const second = (await ask(ipas.id, { p_purpose: "balance", p_amount: 2000 })).data
        expect((await rpc("outsider", "ipas_withdraw_payment_ask", { p_ask_id: second.id })).error).toBeNull()
        expect((await save(ipas.id, null, { p_ask_id: first.id, p_amount: 5000 })).error).toBeNull()

        const all = await lines(ipas.id)
        expect(all.map((m) => m.metadata.event)).toEqual([
            "payment_ask_opened", "payment_ask_edited", "payment_ask_opened", "payment_ask_withdrawn", "payment_added", "payment_ask_closed",
        ])
        expect(all[0].metadata).toMatchObject({ ask_id: first.id, purpose: "down_payment", amount: 5600, currency: "EUR" })
        expect(all[1].metadata.changes).toEqual({
            amount: { from: 5600, to: 6000 },
            priority: { from: "High", to: "Very High" },
        })
        expect(all[3].metadata).toMatchObject({ ask_id: second.id, amount: 2000, currency: "EUR" })
        expect(all[3].content).toContain("2,000.00")
        expect(all[5].metadata).toMatchObject({ ask_id: first.id, reason: "paid", amount: 6000, paid_amount: 5000 })
    })
})

describe("payment lines", () => {
    it("writes exactly one line for an add and one for an edit that touches several tables", async () => {
        const ipas = await raise()
        const added = await save(ipas.id, null)
        expect(added.error).toBeNull()
        expect(await events(ipas.id)).toEqual(["payment_added"])
        expect((await lines(ipas.id))[0].metadata).toMatchObject({ payment_id: added.data.id, kind: "Down payment", amount: 5000, currency: "EUR" })

        // Amount, check number, forex rate and doc stamp are four different writes inside one save.
        const edited = await save(ipas.id, added.data.id, { p_amount: 5200, p_check_no: "C-1", p_forex_rate: 61, p_doc_stamp_php: 30 })
        expect(edited.error).toBeNull()
        const all = await lines(ipas.id)
        expect(all.map((m) => m.metadata.event)).toEqual(["payment_added", "payment_changed"])
        const changes = all[1].metadata.changes
        expect(Object.keys(changes).sort()).toEqual(["amount", "check_no", "doc_stamp_php", "forex_rate", "php_debited"].sort())
        expect(changes.amount).toEqual({ from: 5000, to: 5200 })
        expect(changes.check_no).toEqual({ from: null, to: "C-1" })
    })

    it("writes no line when a save changes nothing", async () => {
        const ipas = await raise()
        const added = await save(ipas.id, null)
        await save(ipas.id, added.data.id)
        expect(await events(ipas.id)).toEqual(["payment_added"])
    })

    it("writes one line on removal, and every line notifies nobody", async () => {
        const ipas = await raise()
        const added = await save(ipas.id, null)
        expect((await rpc("outsider", "ipas_remove_payment", { p_payment_id: added.data.id })).error).toBeNull()
        const all = await lines(ipas.id)
        expect(all.map((m) => m.metadata.event)).toEqual(["payment_added", "payment_removed"])
        expect(all[1].metadata).toMatchObject({ amount: 5000, currency: "EUR", kind: "Down payment" })

        const notified = await svc().from("notifications").select("id").eq("reference_id", ipas.id).in("type", ["IPAS_MESSAGE", "IPAS_MENTION"])
        expect(notified.data).toEqual([])
    })
})

describe("charge lines", () => {
    it("writes one line for add, edit and remove", async () => {
        const ipas = await raise()
        const kind = await optionId("charge_kind", "Brokerage Fee")
        const added = await rpc("outsider", "ipas_add_charge", { p_ipas_id: ipas.id, p_kind_id: kind, p_charged_on: "2026-11-20", p_amount_php: 1500 })
        expect(added.error).toBeNull()
        const edited = await rpc("outsider", "ipas_update_charge", {
            p_charge_id: added.data.id, p_kind_id: kind, p_charged_on: "2026-11-20", p_amount_php: 1800,
        })
        expect(edited.error).toBeNull()
        expect((await rpc("outsider", "ipas_remove_charge", { p_charge_id: added.data.id })).error).toBeNull()

        const all = await lines(ipas.id)
        expect(all.map((m) => m.metadata.event)).toEqual(["charge_added", "charge_changed", "charge_removed"])
        expect(all[0].metadata).toMatchObject({ charge_id: added.data.id, kind: "Brokerage Fee", amount: 1500, currency: "PHP" })
        expect(all[1].metadata.changes).toEqual({ amount: { from: 1500, to: 1800 } })
        expect(all[2].metadata).toMatchObject({ amount: 1800 })
    })
})
