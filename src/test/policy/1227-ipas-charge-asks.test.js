/**
 * Charge asks (#1227, spec #1220, ADR 0055 amendment of 2026-11-25): the database rules.
 *
 * An ask may be for a Charge of any kind from the charge-kind list, billed in a currency (PHP to start). A
 * Charge ask without a kind is refused. A charge saved with ask_id closes that Charge ask; a payment cannot pay
 * a Charge ask and a charge cannot pay a supplier ask. The Chat lines and the Payers' bell name the kind and the
 * currency. Freight is a charge kind now, kept out of the blank charges an Import IPAS starts with.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P9${String(97200 + (poSeq += 1)).padStart(6, "0")}`

async function raise(source = "local") {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: source,
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: {
            po: { id: 972000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "EUR", origin: null, partner_ref: null },
            supplier: { id: 9_972_000 + poSeq, name: "Charge Ask Supplier", contact: null },
            lines: [
                { line_id: 972500 + poSeq * 10, product_id: 7700, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null },
            ],
            receipts: { status: "pending", done: 0, total: 1 },
            bills: { count: 0, draft: 0 },
        },
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const kindId = async (label) => (await svc().from("ipas_options").select("id").eq("list", "charge_kind").eq("label", label).single()).data.id
const methodId = async () => (await svc().from("ipas_options").select("id").eq("list", "payment_method").limit(1).single()).data.id
const ask = (who, ipasId, over = {}) =>
    rpc(who, "ipas_ask_for_payment", { p_ipas_id: ipasId, p_amount: 5600, p_purpose: "down_payment", p_note: null, ...over })
const askCharge = async (ipasId, over = {}) =>
    ask("outsider", ipasId, { p_purpose: "charge", p_amount: 4000, p_charge_kind_id: await kindId("Brokerage Fee"), ...over })
const addCharge = async (ipasId, askId, over = {}) =>
    rpc("outsider", "ipas_add_charge", { p_ipas_id: ipasId, p_kind_id: await kindId("Brokerage Fee"), p_charged_on: "2026-11-20", p_amount_php: 4000, p_ask_id: askId, ...over })
const pay = async (ipasId, askId) =>
    rpc("outsider", "ipas_save_payment", {
        p_ipas_id: ipasId, p_payment_id: null, p_kind: "payment", p_paid_on: "2026-11-20", p_amount: 100, p_forex_rate: null,
        p_doc_stamp_php: 0, p_misc_fee_php: 0, p_charge_fee_php: 0, p_method_id: await methodId(), p_check_no: null, p_proof_url: null,
        p_ask_id: askId,
    })
const askRow = async (id) => (await svc().from("ipas_payment_asks").select("*").eq("id", id).single()).data
const chat = async (ipasId) =>
    (await svc().from("ipas_messages").select("content, metadata").eq("ipas_id", ipasId).order("created_at")).data.filter((m) => m.metadata?.event)

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterEach(async () => {
    await svc().from("ipas_signer_lists").delete().eq("list_key", "payers")
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("asking for a Charge", () => {
    it("stores the kind and the currency, which starts on PHP", async () => {
        const ipas = await raise()
        const first = await askCharge(ipas.id)
        expect(first.error).toBeNull()
        expect(first.data).toMatchObject({ purpose: "charge", currency: "PHP", charge_kind_id: await kindId("Brokerage Fee") })
        const foreign = await askCharge(ipas.id, { p_currency: " usd " })
        expect(foreign.data).toMatchObject({ currency: "USD" })
    })

    it("refuses a Charge ask with no kind, a bad kind or a bad currency", async () => {
        const ipas = await raise()
        expect((await ask("outsider", ipas.id, { p_purpose: "charge" })).error?.code).toBe("22023")
        expect((await askCharge(ipas.id, { p_charge_kind_id: ids.outsider })).error?.code).toBe("22023")
        expect((await askCharge(ipas.id, { p_currency: "PESOS" })).error?.code).toBe("22023")
        expect((await ask("outsider", ipas.id, { p_purpose: "freight" })).error?.code).toBe("22023")
        expect((await svc().from("ipas_payment_asks").select("id").eq("ipas_id", ipas.id)).data).toEqual([])
    })

    it("keeps no kind and no currency on a Down payment or Balance ask", async () => {
        const ipas = await raise()
        const supplier = await ask("outsider", ipas.id, { p_charge_kind_id: await kindId("Brokerage Fee"), p_currency: "USD" })
        expect(supplier.data).toMatchObject({ purpose: "down_payment", charge_kind_id: null, currency: null })
    })

    it("refuses a direct write that makes a Charge ask without a kind", async () => {
        const ipas = await raise()
        const { error } = await sql().query(
            "insert into public.ipas_payment_asks (ipas_id, amount, purpose) values ($1, 10, 'charge')",
            [ipas.id],
        ).then(() => ({ error: null }), (e) => ({ error: e }))
        expect(error).not.toBeNull()
    })
})

describe("Freight as a charge kind", () => {
    it("is an active kind, and a new Import IPAS gets no blank Freight charge", async () => {
        const freight = (await svc().from("ipas_options").select("id, active").eq("list", "charge_kind").eq("label", "Freight").single()).data
        expect(freight.active).toBe(true)
        const ipas = await raise("import")
        const charges = (await svc().from("ipas_charges").select("kind_id").eq("ipas_id", ipas.id)).data
        expect(charges.length).toBeGreaterThan(0)
        expect(charges.map((c) => c.kind_id)).not.toContain(freight.id)
    })

    it("has no Freight purpose left to move", async () => {
        const moved = await sql().query("select public._ipas_migrate_freight_asks() as moved")
        expect(moved.rows[0].moved).toBe(0)
        expect((await svc().from("ipas_payment_asks").select("id").eq("purpose", "freight")).data).toEqual([])
    })
})

describe("a charge paying a Charge ask", () => {
    it("closes only the ask it names, with one charge line and one ask-paid line in the Chat", async () => {
        const ipas = await raise()
        const first = (await askCharge(ipas.id, { p_currency: "USD", p_amount: 700 })).data
        const second = (await askCharge(ipas.id)).data

        const paid = await addCharge(ipas.id, first.id)
        expect(paid.error).toBeNull()
        expect(paid.data.ask_id).toBe(first.id)
        expect(await askRow(first.id)).toMatchObject({ closed_reason: "paid", paid_by_charge_id: paid.data.id })
        expect(await askRow(second.id)).toMatchObject({ closed_at: null })

        const events = (await chat(ipas.id)).map((m) => m.metadata.event)
        expect(events.filter((e) => e === "charge_added")).toHaveLength(1)
        expect(events.filter((e) => e === "payment_ask_closed")).toHaveLength(1)
        const closed = (await chat(ipas.id)).find((m) => m.metadata.event === "payment_ask_closed")
        expect(closed.content).toContain("Brokerage Fee")
        expect(closed.content).toContain("USD 700.00")
        expect(closed.metadata).toMatchObject({ kind: "Brokerage Fee", currency: "USD", charge_id: paid.data.id })
    })

    it("closes nothing when the charge names no ask", async () => {
        const ipas = await raise()
        const open = (await askCharge(ipas.id)).data
        expect((await addCharge(ipas.id, null)).error).toBeNull()
        expect(await askRow(open.id)).toMatchObject({ closed_at: null })
    })

    it("leaves the ask closed when the paying charge is removed", async () => {
        const ipas = await raise()
        const open = (await askCharge(ipas.id)).data
        const paid = await addCharge(ipas.id, open.id)
        expect((await rpc("outsider", "ipas_remove_charge", { p_charge_id: paid.data.id })).error).toBeNull()
        expect(await askRow(open.id)).toMatchObject({ closed_reason: "paid", paid_by_charge_id: null })
    })

    it("refuses a closed ask, another IPAS's ask and a supplier ask, keeping nothing", async () => {
        const ipas = await raise()
        const other = await raise()
        const closed = (await askCharge(ipas.id)).data
        await rpc("outsider", "ipas_withdraw_payment_ask", { p_ask_id: closed.id })
        const elsewhere = (await askCharge(other.id)).data
        const supplier = (await ask("outsider", ipas.id)).data

        expect((await addCharge(ipas.id, closed.id)).error?.code).toBe("22023")
        expect((await addCharge(ipas.id, elsewhere.id)).error?.code).toBe("22023")
        expect((await addCharge(ipas.id, supplier.id)).error?.code).toBe("22023")
        expect((await svc().from("ipas_charges").select("id").eq("ipas_id", ipas.id)).data).toEqual([])
        expect(await askRow(supplier.id)).toMatchObject({ closed_at: null })
    })

    it("refuses a payment that tries to pay a Charge ask", async () => {
        const ipas = await raise()
        const open = (await askCharge(ipas.id)).data
        expect((await pay(ipas.id, open.id)).error?.code).toBe("22023")
        expect((await svc().from("ipas_payments").select("id").eq("ipas_id", ipas.id)).data).toEqual([])
        expect(await askRow(open.id)).toMatchObject({ closed_at: null })
    })

    it("lets Finance and a Super Admin record the paying charge", async () => {
        for (const who of ["finance", "superAdmin"]) {
            const ipas = await raise()
            const open = (await askCharge(ipas.id)).data
            const paid = await rpc(who, "ipas_add_charge", {
                p_ipas_id: ipas.id, p_kind_id: await kindId("Brokerage Fee"), p_charged_on: "2026-11-20", p_amount_php: 10, p_ask_id: open.id,
            })
            expect(paid.error).toBeNull()
            expect(await askRow(open.id)).toMatchObject({ closed_reason: "paid" })
        }
    })
})

describe("the Chat line and the bell name the kind and the currency", () => {
    it("opens, edits and withdraws with the kind and currency in the line", async () => {
        const ipas = await raise()
        const open = (await askCharge(ipas.id, { p_currency: "USD", p_amount: 700 })).data
        await rpc("outsider", "ipas_edit_payment_ask", { p_ask_id: open.id, p_amount: 800, p_priority: "very_high", p_note: null })
        await rpc("outsider", "ipas_withdraw_payment_ask", { p_ask_id: open.id })

        const lines = await chat(ipas.id)
        expect(lines.map((m) => m.metadata.event)).toEqual(["payment_ask_opened", "payment_ask_edited", "payment_ask_withdrawn"])
        expect(lines[0].content).toContain("Asked for payment: Brokerage Fee USD 700.00")
        expect(lines[0].metadata).toMatchObject({ purpose: "charge", kind: "Brokerage Fee", currency: "USD" })
        expect(lines[1].content).toContain("Brokerage Fee USD 800.00")
        expect(lines[2].content).toContain("Brokerage Fee USD 800.00")
    })

    it("rings the Payers' bell with the kind and the currency", async () => {
        const { error } = await svc().from("ipas_signer_lists").insert({ list_key: "payers", employee_id: ids.ipasSigner })
        expect(error).toBeNull()
        const ipas = await raise()
        await askCharge(ipas.id, { p_currency: "USD", p_amount: 700 })
        const bell = (await svc().from("notifications").select("message").eq("reference_id", ipas.id).eq("type", "IPAS_PAYMENT_ASKED").eq("recipient_id", ids.ipasSigner)).data
        expect(bell).toHaveLength(1)
        expect(bell[0].message).toContain("Brokerage Fee USD 700.00")
    })
})
