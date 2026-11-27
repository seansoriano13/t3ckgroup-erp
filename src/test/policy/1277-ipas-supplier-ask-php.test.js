/**
 * A supplier ask in pesos (#1277, spec #1276): a Down payment or Balance ask on a foreign-currency PO may be
 * asked in PHP. Currency null means the PO's currency. PHP is refused on a peso PO, a PHP ask has no % of order,
 * and an open ask can change its currency.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P9${String(97700 + (poSeq += 1)).padStart(6, "0")}`

async function raise(currency = "EUR") {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: {
            po: { id: 977000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency, origin: null, partner_ref: null },
            supplier: { id: 9_977_000 + poSeq, name: "Pesos Ask Supplier", contact: null },
            lines: [
                { line_id: 977500 + poSeq * 10, product_id: 7700, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null },
            ],
            receipts: { status: "pending", done: 0, total: 1 },
            bills: { count: 0, draft: 0 },
        },
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const ask = (ipasId, over = {}) =>
    rpc("outsider", "ipas_ask_for_payment", { p_ipas_id: ipasId, p_amount: 5600, p_purpose: "down_payment", p_note: null, ...over })
const edit = (askId, over = {}) =>
    rpc("outsider", "ipas_edit_payment_ask", { p_ask_id: askId, p_amount: 5600, p_priority: "high", p_note: null, p_percent: null, ...over })

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("a supplier ask in pesos", () => {
    it("stores PHP on a foreign-currency PO and null when no currency is given", async () => {
        const ipas = await raise("EUR")
        const pesos = await ask(ipas.id, { p_currency: " php " })
        expect(pesos.error).toBeNull()
        expect(pesos.data).toMatchObject({ purpose: "down_payment", currency: "PHP", percent_of_order: null })
        const plain = await ask(ipas.id, { p_purpose: "balance", p_percent: 40 })
        expect(plain.data).toMatchObject({ currency: null, percent_of_order: 40 })
    })

    it("refuses PHP on a peso PO", async () => {
        const ipas = await raise("PHP")
        expect((await ask(ipas.id, { p_currency: "PHP" })).error?.code).toBe("22023")
    })

    it("refuses any currency other than PHP on a supplier ask", async () => {
        const ipas = await raise("EUR")
        expect((await ask(ipas.id, { p_currency: "USD" })).error?.code).toBe("22023")
    })

    it("refuses a % of order on a PHP ask, asking or editing", async () => {
        const ipas = await raise("EUR")
        expect((await ask(ipas.id, { p_currency: "PHP", p_percent: 30 })).error?.code).toBe("22023")
        const open = (await ask(ipas.id, { p_percent: 30 })).data
        expect((await edit(open.id, { p_currency: "PHP", p_percent: 30 })).error?.code).toBe("22023")
    })

    it("lets an open ask change its currency, and back", async () => {
        const ipas = await raise("EUR")
        const open = (await ask(ipas.id)).data
        const toPesos = await edit(open.id, { p_currency: "PHP" })
        expect(toPesos.error).toBeNull()
        expect(toPesos.data.currency).toBe("PHP")
        const back = await edit(open.id, { p_currency: null })
        expect(back.error).toBeNull()
        expect(back.data.currency).toBeNull()
    })

    it("refuses a direct write of a PHP ask with a % of order", async () => {
        const ipas = await raise("EUR")
        const { error } = await sql()
            .query("insert into public.ipas_payment_asks (ipas_id, amount, purpose, currency, percent_of_order) values ($1, 10, 'balance', 'PHP', 30)", [ipas.id])
            .then(() => ({ error: null }), (e) => ({ error: e }))
        expect(error).not.toBeNull()
    })
})
