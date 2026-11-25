/**
 * Several asks for payment at once (#1224, spec #1220, ADR 0055 amendment of 2026-11-25): the database rules.
 *
 * Any number of asks may be open on one IPAS. A payment saved as paying one open ask (ipas_save_payment's
 * p_ask_id) closes that ask only, even when smaller than asked; a payment that names no ask closes none. The
 * link must name an open, supplier-side ask on the same IPAS. Removing the paying payment leaves the ask closed.
 * An open ask is edited and withdrawn by its own id; a closed one is refused.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P9${String(96000 + (poSeq += 1)).padStart(6, "0")}`

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
            po: { id: 961000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "EUR", origin: null, partner_ref: null },
            supplier: { id: 9_961_000 + poSeq, name: "Several Asks Supplier", contact: null },
            lines: [
                { line_id: 961500 + poSeq * 10, product_id: 7700, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null },
            ],
            receipts: { status: "pending", done: 0, total: 1 },
            bills: { count: 0, draft: 0 },
        },
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const ask = async (who, ipasId, over = {}) =>
    rpc(who, "ipas_ask_for_payment", { p_ipas_id: ipasId, p_amount: 5600, p_purpose: "down_payment", p_note: null, ...over })
const edit = (who, askId, over = {}) =>
    rpc(who, "ipas_edit_payment_ask", { p_ask_id: askId, p_amount: 6000, p_priority: "very_high", p_note: "now", ...over })
const withdraw = (who, askId) => rpc(who, "ipas_withdraw_payment_ask", { p_ask_id: askId })
const methodId = async () => (await svc().from("ipas_options").select("id").eq("list", "payment_method").limit(1).single()).data.id
const pay = async (ipasId, askId, over = {}) =>
    rpc("outsider", "ipas_save_payment", {
        p_ipas_id: ipasId, p_payment_id: null, p_kind: "payment", p_paid_on: "2026-11-20", p_amount: 100, p_forex_rate: null,
        p_doc_stamp_php: 0, p_misc_fee_php: 0, p_charge_fee_php: 0, p_method_id: await methodId(), p_check_no: null, p_proof_url: null,
        p_ask_id: askId, ...over,
    })
const asksOf = async (ipasId) => (await svc().from("ipas_payment_asks").select("*").eq("ipas_id", ipasId).order("asked_at")).data
const askRow = async (id) => (await svc().from("ipas_payment_asks").select("*").eq("id", id).single()).data

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("several open asks", () => {
    it("lets two or more asks stay open on one IPAS", async () => {
        const ipas = await raise()
        expect((await ask("outsider", ipas.id)).error).toBeNull()
        expect((await ask("outsider", ipas.id, { p_purpose: "balance", p_amount: 2000 })).error).toBeNull()
        expect((await asksOf(ipas.id)).filter((a) => a.closed_at === null)).toHaveLength(2)
    })
})

describe("a payment closing its ask", () => {
    it("closes only the ask it names, even when the payment is smaller", async () => {
        const ipas = await raise()
        const first = (await ask("outsider", ipas.id)).data
        const second = (await ask("outsider", ipas.id, { p_purpose: "balance" })).data

        const paid = await pay(ipas.id, second.id, { p_amount: 10 })
        expect(paid.error).toBeNull()
        expect(paid.data.ask_id).toBe(second.id)
        expect(await askRow(first.id)).toMatchObject({ closed_at: null, closed_reason: null })
        expect(await askRow(second.id)).toMatchObject({ closed_reason: "paid", paid_by_payment_id: paid.data.id })
    })

    it("closes nothing when the payment names no ask", async () => {
        const ipas = await raise()
        const opened = (await ask("outsider", ipas.id)).data
        expect((await pay(ipas.id, null)).error).toBeNull()
        expect(await askRow(opened.id)).toMatchObject({ closed_at: null })
    })

    it("refuses a closed ask, another IPAS's ask and a Charge ask", async () => {
        const ipas = await raise()
        const other = await raise()
        const closed = (await ask("outsider", ipas.id)).data
        await withdraw("outsider", closed.id)
        const elsewhere = (await ask("outsider", other.id)).data
        const kind = (await svc().from("ipas_options").select("id").eq("list", "charge_kind").limit(1).single()).data.id
        const freight = (await ask("outsider", ipas.id, { p_purpose: "charge", p_charge_kind_id: kind })).data

        expect((await pay(ipas.id, closed.id)).error?.code).toBe("22023")
        expect((await pay(ipas.id, elsewhere.id)).error?.code).toBe("22023")
        expect((await pay(ipas.id, freight.id)).error?.code).toBe("22023")
        // Nothing was kept by the refused saves.
        expect((await svc().from("ipas_payments").select("id").eq("ipas_id", ipas.id)).data).toEqual([])
        expect(await askRow(elsewhere.id)).toMatchObject({ closed_at: null })
    })

    it("leaves the ask closed when the paying payment is removed", async () => {
        const ipas = await raise()
        const opened = (await ask("outsider", ipas.id)).data
        const paid = await pay(ipas.id, opened.id)
        expect(paid.error).toBeNull()

        expect((await rpc("outsider", "ipas_remove_payment", { p_payment_id: paid.data.id })).error).toBeNull()
        expect(await askRow(opened.id)).toMatchObject({ closed_reason: "paid", paid_by_payment_id: null })
    })

    it("lets Finance and a Super Admin record the paying payment (#1222 still holds)", async () => {
        for (const who of ["finance", "superAdmin"]) {
            const ipas = await raise()
            const opened = (await ask("outsider", ipas.id)).data
            const paid = await rpc(who, "ipas_save_payment", {
                p_ipas_id: ipas.id, p_payment_id: null, p_kind: "payment", p_paid_on: "2026-11-20", p_amount: 50, p_forex_rate: null,
                p_doc_stamp_php: 0, p_misc_fee_php: 0, p_charge_fee_php: 0, p_method_id: await methodId(), p_check_no: null, p_proof_url: null,
                p_ask_id: opened.id,
            })
            expect(paid.error, `${who} was refused`).toBeNull()
            expect((await askRow(opened.id)).closed_reason).toBe("paid")
        }
    })
})

describe("editing and withdrawing by ask", () => {
    it("edits an open ask's amount, priority and note, and posts it in the Chat", async () => {
        const ipas = await raise()
        const opened = (await ask("outsider", ipas.id)).data
        const edited = await edit("outsider", opened.id)
        expect(edited.error).toBeNull()
        expect(Number(edited.data.amount)).toBe(6000)
        expect(edited.data).toMatchObject({ priority: "very_high", note: "now", closed_at: null })

        const lines = (await svc().from("ipas_messages").select("metadata").eq("ipas_id", ipas.id)).data.map((m) => m.metadata?.event)
        expect(lines).toContain("payment_ask_edited")
    })

    it("refuses editing a closed ask, a bad amount, and anyone without access", async () => {
        const ipas = await raise()
        const opened = (await ask("outsider", ipas.id)).data
        expect((await edit("ordinary", opened.id)).error?.code).toBe("42501")
        expect((await edit("outsider", opened.id, { p_amount: 0 })).error?.code).toBe("22023")
        await withdraw("outsider", opened.id)
        expect((await edit("outsider", opened.id)).error?.code).toBe("22023")
    })

    it("withdraws one ask and leaves the others open", async () => {
        const ipas = await raise()
        const first = (await ask("outsider", ipas.id)).data
        const second = (await ask("outsider", ipas.id, { p_purpose: "balance" })).data
        expect((await withdraw("outsider", first.id)).error).toBeNull()
        expect(await askRow(first.id)).toMatchObject({ closed_reason: "withdrawn" })
        expect(await askRow(second.id)).toMatchObject({ closed_at: null })
    })
})
