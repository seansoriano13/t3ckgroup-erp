/**
 * The pesos taken from the bank, typed on a paid foreign payment (#1278, spec #1276).
 *
 * Typed pesos are stored as php_debited with a null forex_rate, and Landed Cost reads them as pesos / amount.
 * With no pesos typed, a stored rate is kept (an old payment is not changed). Zero pesos are refused.
 * `outsider` holds Purchasing access.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
let methodId = null

const copyFor = (po) => ({
    po: { id: 1278000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "USD", origin: null, partner_ref: null },
    supplier: { id: 9_127_800 + poSeq, name: "Pesos Box Supplier", contact: null },
    lines: [
        { line_id: 1278500 + poSeq * 10, product_id: 7700, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise() {
    const po = `P9${String(127800 + (poSeq += 1)).padStart(6, "0")}`
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const saveArgs = (over = {}) => ({
    p_ipas_id: null,
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
    ...over,
})
const save = (ipasId, over = {}) => rpc("outsider", "ipas_save_payment", saveArgs({ p_ipas_id: ipasId, ...over }))
const edit = (paymentId, over = {}) => rpc("outsider", "ipas_save_payment", saveArgs({ p_ipas_id: null, p_payment_id: paymentId, ...over }))

const CAST_IDS = () => CAST_KEYS.map((k) => ids[k])

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    methodId = (await svc().from("ipas_options").select("id").eq("list", "payment_method").eq("label", "Dated Check").single()).data.id
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", CAST_IDS())
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

const row = async (id) => (await svc().from("ipas_payments").select("amount, php_debited, forex_rate").eq("id", id).single()).data

describe("pesos taken from the bank on a USD payment", () => {
    it("stores typed pesos as php_debited with no rate, and Landed Cost reads pesos / amount", async () => {
        const ipas = await raise()
        const { data, error } = await save(ipas.id, { p_amount: 21679.75, p_php_debited: 468642.36 })
        expect(error).toBeNull()
        expect(await row(data.id)).toMatchObject({ amount: 21679.75, php_debited: 468642.36, forex_rate: null })
        const lc = (await rpc("outsider", "ipas_landed_cost", { p_ipas_id: ipas.id })).data
        expect(lc.rate).toMatchObject({ phpDebited: 468642.36, foreignPaid: 21679.75 })
    })

    it("keeps a stored rate when no pesos are typed, and typing pesos clears it", async () => {
        const ipas = await raise()
        const { data } = await save(ipas.id, { p_amount: 640, p_forex_rate: 56.5 })
        expect(await row(data.id)).toMatchObject({ php_debited: 36160, forex_rate: 56.5 })
        expect((await edit(data.id, { p_amount: 640, p_forex_rate: 56.5 })).error).toBeNull()
        expect(await row(data.id)).toMatchObject({ php_debited: 36160, forex_rate: 56.5 })
        expect((await edit(data.id, { p_amount: 640, p_forex_rate: 56.5, p_php_debited: 36200.5 })).error).toBeNull()
        expect(await row(data.id)).toMatchObject({ php_debited: 36200.5, forex_rate: null })
    })

    it("refuses zero pesos", async () => {
        const ipas = await raise()
        const { error } = await save(ipas.id, { p_amount: 640, p_php_debited: 0 })
        expect(error?.message).toMatch(/pesos taken from the bank must be more than zero/)
    })

    it("saves with no pesos at all, as before", async () => {
        const ipas = await raise()
        const { data, error } = await save(ipas.id, { p_amount: 640 })
        expect(error).toBeNull()
        expect(await row(data.id)).toMatchObject({ php_debited: null, forex_rate: null })
    })
})
