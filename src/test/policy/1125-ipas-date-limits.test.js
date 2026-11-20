/**
 * Date limits on IPAS money and typed dates (#1125, spec #1123, tracker A3).
 *
 * A payment's paid-on date, a charge's date and the IPAS Status dates must run from
 * 2015-01-01 to today (Asia/Manila). Today is accepted; tomorrow and 2014-12-31 are refused with a sentence,
 * by ipas_save_payment, ipas_add_charge, ipas_update_charge and ipas_fill_charge, and the status dates (#1154) by ipas_set_status.
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
let kindId = null

const manilaDay = (offsetDays = 0) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86_400_000))
const TODAY = () => manilaDay(0)
const TOMORROW = () => manilaDay(1)

const copyFor = (po) => ({
    po: { id: 1125000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "PHP", origin: null, partner_ref: null },
    supplier: { id: 9_125_000 + poSeq, name: "Date Limits Supplier", contact: null },
    lines: [
        { line_id: 1125500 + poSeq * 10, product_id: 7700, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise(source = "local") {
    const po = `P9${String(112500 + (poSeq += 1)).padStart(6, "0")}`
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: source,
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const savePayment = (ipasId, paidOn, over = {}) =>
    rpc("outsider", "ipas_save_payment", {
        p_ipas_id: ipasId,
        p_payment_id: null,
        p_kind: "payment",
        p_paid_on: paidOn,
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
const addCharge = (ipasId, on) => rpc("outsider", "ipas_add_charge", { p_ipas_id: ipasId, p_kind_id: kindId, p_charged_on: on, p_amount_php: 100 })
const setStep = (ipasId, step, date) => rpc("outsider", "ipas_set_status", { p_ipas_id: ipasId, p_step: step, p_reached_on: date })

const CAST_IDS = () => CAST_KEYS.map((k) => ids[k])

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    methodId = (await svc().from("ipas_options").select("id").eq("list", "payment_method").eq("label", "Dated Check").single()).data.id
    kindId = (await svc().from("ipas_options").select("id").eq("list", "charge_kind").eq("label", "Brokerage Fee").single()).data.id
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", CAST_IDS())
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("a payment's date (ipas_save_payment)", () => {
    it("accepts today and 2015-01-01", async () => {
        const ipas = await raise()
        expect((await savePayment(ipas.id, TODAY())).error).toBeNull()
        expect((await savePayment(ipas.id, "2015-01-01")).error).toBeNull()
    })

    it("refuses tomorrow with a sentence", async () => {
        const ipas = await raise()
        const { error } = await savePayment(ipas.id, TOMORROW())
        expect(error?.message).toContain("the payment date cannot be after today")
        expect(error?.code).toBe("22023")
    })

    it("refuses 2014-12-31 with a sentence", async () => {
        const ipas = await raise()
        const { error } = await savePayment(ipas.id, "2014-12-31")
        expect(error?.message).toContain("the payment date cannot be before January 1, 2015")
    })

    it("refuses a change of a saved payment to tomorrow, and keeps the old date", async () => {
        const ipas = await raise()
        const { data } = await savePayment(ipas.id, TODAY())
        const { error } = await savePayment(null, TOMORROW(), { p_payment_id: data.id })
        expect(error?.message).toContain("cannot be after today")
        const stored = await svc().from("ipas_payments").select("paid_on").eq("id", data.id).single()
        expect(stored.data.paid_on).toBe(TODAY())
    })
})

describe("a charge's date", () => {
    it("ipas_add_charge accepts today and refuses tomorrow and 2014-12-31", async () => {
        const ipas = await raise()
        expect((await addCharge(ipas.id, TODAY())).error).toBeNull()
        expect((await addCharge(ipas.id, TOMORROW())).error?.message).toContain("the charge date cannot be after today")
        expect((await addCharge(ipas.id, "2014-12-31")).error?.message).toContain("the charge date cannot be before January 1, 2015")
    })

    it("ipas_update_charge refuses the same", async () => {
        const ipas = await raise()
        const { data } = await addCharge(ipas.id, TODAY())
        const update = (on) => rpc("outsider", "ipas_update_charge", { p_charge_id: data.id, p_kind_id: kindId, p_charged_on: on, p_amount_php: 100 })
        expect((await update(TOMORROW())).error?.message).toContain("cannot be after today")
        expect((await update("2014-12-31")).error?.message).toContain("cannot be before January 1, 2015")
        expect((await update("2020-05-05")).error).toBeNull()
    })

    it("ipas_fill_charge refuses the same", async () => {
        const ipas = await raise()
        const { data } = await addCharge(ipas.id, TODAY())
        const fill = (on) => rpc("outsider", "ipas_fill_charge", { p_charge_id: data.id, p_charged_on: on, p_amount_php: 120, p_attachment_url: null })
        expect((await fill(TOMORROW())).error?.message).toContain("cannot be after today")
        expect((await fill("2014-12-31")).error?.message).toContain("cannot be before January 1, 2015")
        expect((await fill(TODAY())).error).toBeNull()
    })
})


describe("the IPAS Status dates (ipas_set_status)", () => {
    it("accepts today and refuses tomorrow and 2014-12-31 for Delivered", async () => {
        const ipas = await raise()
        expect((await setStep(ipas.id, "delivered", TOMORROW())).error?.message).toContain("the Delivered date cannot be after today")
        expect((await setStep(ipas.id, "delivered", "2014-12-31")).error?.message).toContain("cannot be before January 1, 2015")
        expect((await setStep(ipas.id, "delivered", TODAY())).error).toBeNull()
    })

    it("holds Customs / Port Hold to the same limits on an Import IPAS", async () => {
        const ipas = await raise("import")
        expect((await setStep(ipas.id, "customs", TOMORROW())).error?.message).toContain("the Customs / Port Hold date cannot be after today")
        expect((await setStep(ipas.id, "customs", TODAY())).error).toBeNull()
    })
})
