/**
 * "% of order" on an IPAS payment (#958, spec #954).
 *
 * A Down payment or Payment may carry a percent. It is stored with the payment, read back, named in
 * history, cleared when the app sends none, and refused on any other kind. A filed IPAS refuses the
 * change like any other payment edit. `outsider` holds Purchasing access.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
let methodId = null

const copyFor = (po) => ({
    po: { id: 958000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "PHP", origin: null, partner_ref: null },
    supplier: { id: 9_958_000 + poSeq, name: "Percent Supplier", contact: null },
    lines: [
        { line_id: 958500 + poSeq * 10, product_id: 7700, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise() {
    const po = `P9${String(95800 + (poSeq += 1)).padStart(6, "0")}`
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
    p_paid_on: "2026-12-01",
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
const stored = async (paymentId) => (await svc().from("ipas_payments").select("kind, amount, percent_of_order").eq("id", paymentId).single()).data
const events = async (ipasId, kind) =>
    (await svc().from("ipas_events").select("detail").eq("ipas_id", ipasId).eq("kind", kind).order("created_at")).data

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

describe("a payment's % of order", () => {
    it("is stored with the payment and read back", async () => {
        const ipas = await raise()
        const { data, error } = await save(ipas.id, { p_percent_of_order: 30 })
        expect(error).toBeNull()
        expect(Number(data.percent_of_order)).toBe(30)
        expect(await stored(data.id)).toMatchObject({ kind: "payment", amount: 300, percent_of_order: 30 })
    })

    it("is optional: a payment without one stores null", async () => {
        const ipas = await raise()
        const { data, error } = await save(ipas.id)
        expect(error).toBeNull()
        expect((await stored(data.id)).percent_of_order).toBeNull()
    })

    it("keeps four decimals", async () => {
        const ipas = await raise()
        const { data } = await save(ipas.id, { p_kind: "down_payment", p_percent_of_order: 33.33333 })
        expect(Number((await stored(data.id)).percent_of_order)).toBe(33.3333)
    })

    it("can be changed and cleared, and history names it each time", async () => {
        const ipas = await raise()
        const { data } = await save(ipas.id, { p_kind: "down_payment", p_percent_of_order: 30 })
        const changed = await edit(data.id, { p_kind: "down_payment", p_percent_of_order: 45, p_amount: 450 })
        expect(changed.error).toBeNull()
        expect(Number((await stored(data.id)).percent_of_order)).toBe(45)
        const cleared = await edit(data.id, { p_kind: "down_payment", p_percent_of_order: null, p_amount: 460 })
        expect(cleared.error).toBeNull()
        expect((await stored(data.id)).percent_of_order).toBeNull()

        const added = await events(ipas.id, "payment_added")
        expect(Number(added[0].detail.percent_of_order)).toBe(30)
        const changes = await events(ipas.id, "payment_changed")
        const percentChanges = changes.map((e) => e.detail.changes.percent_of_order).filter(Boolean)
        expect(percentChanges.map((c) => [Number(c.from), c.to === null ? null : Number(c.to)])).toEqual([
            [30, 45],
            [45, null],
        ])
    })

    it("refuses a Full payment or Shipping fee with a percent, and a percent that is not a percent", async () => {
        const ipas = await raise()
        for (const kind of ["full_payment", "shipping_fee"]) {
            const { error } = await save(ipas.id, { p_kind: kind, p_percent_of_order: 30 })
            expect(error?.message).toMatch(/only a Down payment or a Payment can be a percent/)
            expect(error.code).toBe("22023")
        }
        for (const bad of [0, -5, 1001]) {
            const { error } = await save(ipas.id, { p_percent_of_order: bad })
            expect(error?.message).toMatch(/percent of the order must be more than 0/)
            expect(error.code).toBe("22023")
        }
        const { data: row } = await save(ipas.id, { p_percent_of_order: 30 })
        const moved = await edit(row.id, { p_kind: "full_payment", p_percent_of_order: 30 })
        expect(moved.error?.code).toBe("22023")
        expect((await stored(row.id)).kind).toBe("payment")
    })

    it("lets the percents pass 100% (a warning on screen, never a refusal)", async () => {
        const ipas = await raise()
        expect((await save(ipas.id, { p_percent_of_order: 70 })).error).toBeNull()
        expect((await save(ipas.id, { p_percent_of_order: 60 })).error).toBeNull()
    })

    it("is refused on a filed IPAS like any other payment edit", async () => {
        const ipas = await raise()
        const { data: row } = await save(ipas.id, { p_percent_of_order: 30 })
        await sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [ipas.id])
        const added = await save(ipas.id, { p_percent_of_order: 30 })
        expect(added.error?.code).toBe("22023")
        const changed = await edit(row.id, { p_percent_of_order: 50, p_amount: 500 })
        expect(changed.error?.code).toBe("22023")
        expect(Number((await stored(row.id)).percent_of_order)).toBe(30)
    })
})
