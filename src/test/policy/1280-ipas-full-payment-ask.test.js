/**
 * Full payment as a request (#1280, spec #1276). It is refused once the IPAS has any recorded payment or any open
 * or paid supplier ask; Down payment and Balance are refused while a Full payment ask is open or paid.
 * Withdrawn asks count for nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
let methodId = null
const nextPo = () => `P9${String(98000 + (poSeq += 1)).padStart(6, "0")}`

async function raise(currency = "USD") {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: {
            po: { id: 980000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency, origin: null, partner_ref: null },
            supplier: { id: 9_980_000 + poSeq, name: "Full Payment Supplier", contact: null },
            lines: [
                { line_id: 980500 + poSeq * 10, product_id: 7700, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null },
            ],
            receipts: { status: "pending", done: 0, total: 1 },
            bills: { count: 0, draft: 0 },
        },
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const ask = (ipasId, over = {}) =>
    rpc("outsider", "ipas_ask_for_payment", { p_ipas_id: ipasId, p_amount: 1000, p_purpose: "full_payment", p_note: null, ...over })
const withdraw = (askId) => rpc("outsider", "ipas_withdraw_payment_ask", { p_ask_id: askId })
const pay = (ipasId) =>
    rpc("outsider", "ipas_save_payment", {
        p_ipas_id: ipasId,
        p_payment_id: null,
        p_kind: "payment",
        p_paid_on: "2026-11-01",
        p_amount: 300,
        p_forex_rate: null,
        p_doc_stamp_php: 0,
        p_misc_fee_php: 0,
        p_charge_fee_php: 0,
        p_method_id: methodId,
        p_check_no: null,
        p_proof_url: null,
    })

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    methodId = (await svc().from("ipas_options").select("id").eq("list", "payment_method").eq("label", "Dated Check").single()).data.id
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("a Full payment ask", () => {
    it("is accepted on a clean IPAS, with a % of order in the PO currency and none in PHP", async () => {
        const ipas = await raise("USD")
        const full = await ask(ipas.id, { p_percent: 100 })
        expect(full.error).toBeNull()
        expect(full.data).toMatchObject({ purpose: "full_payment", percent_of_order: 100, currency: null })
        const pesos = await ask((await raise("USD")).id, { p_currency: "PHP", p_amount: 56000 })
        expect(pesos.error).toBeNull()
        expect(pesos.data).toMatchObject({ purpose: "full_payment", currency: "PHP", percent_of_order: null })
        expect((await ask((await raise("USD")).id, { p_currency: "PHP", p_percent: 100 })).error?.code).toBe("22023")
    })

    it("is refused when a Down payment or Balance ask is open", async () => {
        const ipas = await raise()
        expect((await ask(ipas.id, { p_purpose: "balance" })).error).toBeNull()
        expect((await ask(ipas.id)).error?.code).toBe("22023")
    })

    it("is refused when the IPAS has a recorded payment", async () => {
        const ipas = await raise()
        expect((await pay(ipas.id)).error).toBeNull()
        expect((await ask(ipas.id)).error?.code).toBe("22023")
    })

    it("counts a withdrawn ask for nothing", async () => {
        const ipas = await raise()
        const first = (await ask(ipas.id, { p_purpose: "down_payment" })).data
        expect((await withdraw(first.id)).error).toBeNull()
        expect((await ask(ipas.id)).error).toBeNull()
    })

    it("makes Down payment and Balance wait while it is open, and frees them once withdrawn", async () => {
        const ipas = await raise()
        const full = (await ask(ipas.id)).data
        expect((await ask(ipas.id, { p_purpose: "down_payment" })).error?.code).toBe("22023")
        expect((await ask(ipas.id, { p_purpose: "balance" })).error?.code).toBe("22023")
        expect((await withdraw(full.id)).error).toBeNull()
        expect((await ask(ipas.id, { p_purpose: "balance" })).error).toBeNull()
    })
})
