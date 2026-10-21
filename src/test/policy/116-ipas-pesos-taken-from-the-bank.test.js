/**
 * "Pesos taken from the bank" is optional (#604, spec #595).
 *
 * A foreign-currency payment saves with the pesos blank (php_debited stays null), so Finance can
 * record it the day it is paid. While any is blank:
 *   - Landed Cost is an estimate, each blank payment taken at the Reference Rate of its payment
 *     date (the latest rate on or before it). The estimate is worked out on the way out and never
 *     stored: the payment's column stays blank.
 *   - the Computation status can't move to LC Odoo Done, and the refusal names the payments;
 *   - nothing can be added or edited to blank once the IPAS is at LC Odoo Done.
 * A payment given pesos behaves as it always did: the rate actually paid.
 *
 * `outsider` holds Purchasing access. Reference Rates are written for a currency of this test's
 * own ("ZZZ") and removed again, so the USD and EUR rows stay as they were.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

const CURRENCY = "ZZZ"
let poSeq = 0
let methodId = null

const copyFor = (po, currency) => ({
    po: { id: 910000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency, origin: null, partner_ref: null },
    supplier: { id: 9_910_000 + poSeq, name: "Pesos Supplier", contact: null },
    lines: [
        { line_id: 920000 + poSeq * 10, product_id: 7700, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise(currency = CURRENCY) {
    const po = `P9${String(96000 + (poSeq += 1)).padStart(6, "0")}`
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po, currency),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const addPayment = (ipasId, over = {}) =>
    rpc("outsider", "ipas_add_payment", {
        p_ipas_id: ipasId,
        p_kind: "down_payment",
        p_paid_on: "2026-10-01",
        p_amount: 1000,
        p_php_debited: null,
        p_charge_fee_php: 0,
        p_method_id: methodId,
        p_check_no: null,
        p_proof_url: null,
        ...over,
    })
const updatePayment = (paymentId, over = {}) =>
    rpc("outsider", "ipas_update_payment", {
        p_payment_id: paymentId,
        p_kind: "down_payment",
        p_paid_on: "2026-10-01",
        p_amount: 1000,
        p_php_debited: null,
        p_charge_fee_php: 0,
        p_method_id: methodId,
        p_check_no: null,
        p_proof_url: null,
        ...over,
    })
const setStatus = (ipasId, status) => rpc("outsider", "ipas_set_header", { p_ipas_id: ipasId, p_fields: { computation_status: status } })
const landedCost = async (ipasId) => (await rpc("outsider", "ipas_landed_cost", { p_ipas_id: ipasId })).data
const stored = async (paymentId) => (await svc().from("ipas_payments").select("php_debited").eq("id", paymentId).single()).data.php_debited

const CAST_IDS = () => CAST_KEYS.map((k) => ids[k])

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    methodId = (await svc().from("ipas_options").select("id").eq("list", "payment_method").eq("label", "Dated Check").single()).data.id

    await svc().from("currency_rates").delete().eq("currency", CURRENCY)
    await svc().from("currency_rate_currencies").delete().eq("currency", CURRENCY)
    const currency = await svc().from("currency_rate_currencies").insert({ currency: CURRENCY })
    if (currency.error) throw currency.error
    // 2026-09-28 is the latest on or before 2026-10-01 (the 2nd is after it); 2026-10-05 is its own day.
    const rates = await svc().from("currency_rates").insert([
        { currency: CURRENCY, rate_date: "2026-09-28", php_per_unit: 50, source: "test" },
        { currency: CURRENCY, rate_date: "2026-10-02", php_per_unit: 99, source: "test" },
        { currency: CURRENCY, rate_date: "2026-10-05", php_per_unit: 60, source: "test" },
    ])
    if (rates.error) throw rates.error
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", CAST_IDS())
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    await svc().from("currency_rates").delete().eq("currency", CURRENCY)
    await svc().from("currency_rate_currencies").delete().eq("currency", CURRENCY)
})

describe("a foreign-currency payment saves with the pesos blank", () => {
    it("is stored blank, not guessed", async () => {
        const ipas = await raise()
        const { data, error } = await addPayment(ipas.id)
        expect(error).toBeNull()
        expect(data.php_debited).toBeNull()
        expect(await stored(data.id)).toBeNull()
    })

    it("still refuses a figure that isn't more than zero", async () => {
        const ipas = await raise()
        for (const bad of [0, -5]) {
            const { error } = await addPayment(ipas.id, { p_php_debited: bad })
            expect(error?.message).toMatch(/pesos taken from the bank must be more than zero/)
            expect(error.code).toBe("22023")
        }
    })

    it("can be filled in later, and blanked again before LC Odoo Done", async () => {
        const ipas = await raise()
        const { data } = await addPayment(ipas.id)
        const filled = await updatePayment(data.id, { p_php_debited: 51000 })
        expect(filled.error).toBeNull()
        expect(await stored(data.id)).toBe(51000)
        const blank = await updatePayment(data.id, { p_php_debited: null })
        expect(blank.error).toBeNull()
        expect(await stored(data.id)).toBeNull()
    })

    it("a peso PO still stores no second figure", async () => {
        const ipas = await raise("Php")
        const { data, error } = await addPayment(ipas.id, { p_php_debited: 999 })
        expect(error).toBeNull()
        expect(data.php_debited).toBeNull()
    })
})

describe("LC Odoo Done waits for the pesos", () => {
    it("is refused while a foreign-currency payment is blank, and says which", async () => {
        const ipas = await raise()
        await addPayment(ipas.id, { p_kind: "down_payment", p_paid_on: "2026-10-01", p_amount: 1000 })
        const filled = (await addPayment(ipas.id, { p_kind: "full_payment", p_paid_on: "2026-10-05", p_amount: 2500, p_php_debited: 150000 })).data
        expect(filled.php_debited).toBe(150000)
        await addPayment(ipas.id, { p_kind: "shipping_fee", p_paid_on: "2026-10-05", p_amount: 25.5 })

        const { error } = await setStatus(ipas.id, "lc_odoo_done")
        expect(error.code).toBe("22023")
        expect(error.message).toMatch(/LC Odoo Done needs the pesos taken from the bank/)
        expect(error.message).toContain("Down payment of ZZZ 1,000.00 on Oct 1, 2026")
        expect(error.message).toContain("Shipping fee of ZZZ 25.50 on Oct 5, 2026")
        expect(error.message).not.toContain("Full payment")

        const row = (await svc().from("ipas").select("computation_status").eq("id", ipas.id).single()).data
        expect(row.computation_status).not.toBe("lc_odoo_done")
    })

    it("lets the earlier steps through while the pesos are blank", async () => {
        const ipas = await raise()
        await addPayment(ipas.id)
        for (const status of ["encoded", "lc_gs_done"]) {
            expect((await setStatus(ipas.id, status)).error).toBeNull()
        }
    })

    it("is accepted once every payment has its pesos", async () => {
        const ipas = await raise()
        const { data } = await addPayment(ipas.id)
        expect((await setStatus(ipas.id, "lc_odoo_done")).error).not.toBeNull()
        expect((await updatePayment(data.id, { p_php_debited: 51000 })).error).toBeNull()
        expect((await setStatus(ipas.id, "lc_odoo_done")).error).toBeNull()
    })

    it("a peso PO and an IPAS with no payments are not held back", async () => {
        const peso = await raise("Php")
        await addPayment(peso.id)
        expect((await setStatus(peso.id, "lc_odoo_done")).error).toBeNull()
        const none = await raise()
        expect((await setStatus(none.id, "lc_odoo_done")).error).toBeNull()
    })

    it("a payment can't be added or blanked once the IPAS is at LC Odoo Done", async () => {
        const ipas = await raise()
        const { data } = await addPayment(ipas.id, { p_php_debited: 51000 })
        expect((await setStatus(ipas.id, "lc_odoo_done")).error).toBeNull()

        const add = await addPayment(ipas.id, { p_kind: "payment" })
        expect(add.error?.message).toMatch(/LC Odoo Done, so Landed Cost is final/)
        const blank = await updatePayment(data.id, { p_php_debited: null })
        expect(blank.error?.message).toMatch(/LC Odoo Done, so Landed Cost is final/)
        expect((await updatePayment(data.id, { p_php_debited: 52000 })).error).toBeNull()
        expect((await addPayment(ipas.id, { p_kind: "payment", p_php_debited: 100 })).error).toBeNull()
    })
})

describe("Landed Cost while the pesos are blank", () => {
    // 10 x ZZZ 100 = ZZZ 1,000 of goods; no charges, so Landed Cost is the goods in pesos.
    it("is an estimate at the payment date's Reference Rate, and is never stored", async () => {
        const ipas = await raise()
        // 2026-10-01 has no rate of its own: the latest before it, 2026-09-28 at 50, is used (not the 2nd's 99).
        const { data } = await addPayment(ipas.id, { p_paid_on: "2026-10-01", p_amount: 1000 })

        const lc = await landedCost(ipas.id)
        expect(lc.estimate).toBe(true)
        expect(lc.status).toBe("provisional")
        expect(Number(lc.rate.rate)).toBe(50)
        expect(lc.rate.estimatedPayments).toBe(1)
        expect(Number(lc.totals.landedPhp)).toBe(50000)
        expect(lc.estimates).toHaveLength(1)
        expect(lc.estimates[0]).toMatchObject({ paymentId: data.id, paidOn: "2026-10-01", rateDate: "2026-09-28", referenceRate: 50, php: 50000 })

        expect(await stored(data.id)).toBeNull()
    })

    it("mixes the rate actually paid with the Reference Rate for the blank one", async () => {
        const ipas = await raise()
        await addPayment(ipas.id, { p_kind: "down_payment", p_paid_on: "2026-10-01", p_amount: 500, p_php_debited: 30000 })
        await addPayment(ipas.id, { p_kind: "full_payment", p_paid_on: "2026-10-05", p_amount: 500 })

        // 30,000 actually paid for 500, plus 500 x 60 = 30,000 estimated: 60,000 over 1,000 is 60 a unit.
        const lc = await landedCost(ipas.id)
        expect(lc.estimate).toBe(true)
        expect(lc.rate.estimatedPayments).toBe(1)
        expect(Number(lc.rate.phpDebited)).toBe(60000)
        expect(Number(lc.rate.rate)).toBe(60)
        expect(Number(lc.totals.landedPhp)).toBe(60000)
    })

    it("a blank shipping fee is spread at its Reference Rate too", async () => {
        const ipas = await raise()
        await addPayment(ipas.id, { p_kind: "down_payment", p_paid_on: "2026-10-05", p_amount: 1000, p_php_debited: 60000 })
        await addPayment(ipas.id, { p_kind: "shipping_fee", p_paid_on: "2026-10-05", p_amount: 10 })
        const lc = await landedCost(ipas.id)
        expect(lc.estimate).toBe(true)
        expect(Number(lc.totals.shippingFeesPhp)).toBe(600)
    })

    it("becomes the final figure at the rate actually paid once the pesos are in", async () => {
        const ipas = await raise()
        const { data } = await addPayment(ipas.id, { p_paid_on: "2026-10-01", p_amount: 1000 })
        expect((await landedCost(ipas.id)).estimate).toBe(true)

        expect((await updatePayment(data.id, { p_php_debited: 56000 })).error).toBeNull()
        const provisional = await landedCost(ipas.id)
        expect(provisional.estimate).toBe(false)
        expect(provisional.estimates).toEqual([])
        expect(provisional.status).toBe("provisional")
        expect(Number(provisional.rate.rate)).toBe(56)
        expect(Number(provisional.totals.landedPhp)).toBe(56000)

        expect((await setStatus(ipas.id, "lc_odoo_done")).error).toBeNull()
        const final = await landedCost(ipas.id)
        expect(final.status).toBe("final")
        expect(final.estimate).toBe(false)
    })

    it("is not available when there is no Reference Rate to estimate with", async () => {
        const ipas = await raise()
        // Before the first rate on record.
        await addPayment(ipas.id, { p_paid_on: "2026-01-01" })
        const lc = await landedCost(ipas.id)
        expect(lc.status).toBe("unavailable")
        expect(lc.reason).toBe("no_reference_rate")
    })
})
