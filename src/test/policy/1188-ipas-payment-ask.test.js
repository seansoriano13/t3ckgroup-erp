/**
 * The ask for payment (#1188, spec #1187, ADR 0055): the database rules.
 *
 * `outsider` holds Purchasing access and raises the IPAS; `finance` holds Finance access alone;
 * `ordinary` and `superAdmin` (no flag) hold neither. The Payment status itself is worked out in the
 * unit tier (utils/ipasFigures.test.js); here: who may ask or withdraw, a payment saved as paying
 * the ask closing it (#1224: several asks may be open, see also 1224-...), and the event lines in the IPAS Chat.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P9${String(97000 + (poSeq += 1)).padStart(6, "0")}`

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
            po: { id: 971000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "EUR", origin: null, partner_ref: null },
            supplier: { id: 9_971_000 + poSeq, name: "Ask Supplier", contact: null },
            lines: [
                { line_id: 971500 + poSeq * 10, product_id: 7700, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null },
            ],
            receipts: { status: "pending", done: 0, total: 1 },
            bills: { count: 0, draft: 0 },
        },
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const ask = (who, ipasId, over = {}) =>
    rpc(who, "ipas_ask_for_payment", { p_ipas_id: ipasId, p_amount: 5600, p_purpose: "down_payment", p_note: "30% down", ...over })
const withdraw = (who, askId) => rpc(who, "ipas_withdraw_payment_ask", { p_ask_id: askId })
const methodId = async () => (await svc().from("ipas_options").select("id").eq("list", "payment_method").limit(1).single()).data.id
// A payment saved as paying one ask (#1224).
const payAsk = async (ipasId, askId, over = {}) =>
    rpc("outsider", "ipas_save_payment", {
        p_ipas_id: ipasId, p_payment_id: null, p_kind: "payment", p_paid_on: "2026-11-20", p_amount: 100, p_forex_rate: null,
        p_doc_stamp_php: 0, p_misc_fee_php: 0, p_charge_fee_php: 0, p_method_id: await methodId(), p_check_no: null, p_proof_url: null,
        p_ask_id: askId, ...over,
    })

const asksOf = async (ipasId) =>
    (await svc().from("ipas_payment_asks").select("*").eq("ipas_id", ipasId).order("asked_at")).data
const eventLines = async (ipasId) =>
    (await svc().from("ipas_messages").select("content, metadata, author_id").eq("ipas_id", ipasId).order("created_at")).data.filter(
        (m) => m.metadata?.event?.startsWith("payment_ask_"),
    )

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("asking for a payment", () => {
    it("is open to Purchasing, Finance and a Super Admin and refused to everyone else", async () => {
        const ipas = await raise()
        for (const who of ["ordinary"]) {
            const refused = await ask(who, ipas.id)
            expect(refused.error, `${who} was allowed to ask`).not.toBeNull()
            expect(refused.error.code).toBe("42501")
        }
        // #1222: Finance and a Super Admin ask too.
        for (const who of ["finance", "superAdmin"]) {
            const other = await raise()
            const allowed = await ask(who, other.id)
            expect(allowed.error, `${who} was refused an ask`).toBeNull()
            expect(allowed.data).toMatchObject({ ipas_id: other.id, asked_by: ids[who] })
        }
        const asked = await ask("outsider", ipas.id)
        expect(asked.error).toBeNull()
        expect(asked.data).toMatchObject({ ipas_id: ipas.id, purpose: "down_payment", note: "30% down", asked_by: ids.outsider, closed_at: null })
        expect(Number(asked.data.amount)).toBe(5600)
    })

    it("refuses a bad amount or purpose", async () => {
        const ipas = await raise()
        expect((await ask("outsider", ipas.id)).error).toBeNull()

        const other = await raise()
        expect((await ask("outsider", other.id, { p_amount: 0 })).error).not.toBeNull()
        expect((await ask("outsider", other.id, { p_purpose: "shipping_fee" })).error).not.toBeNull()
    })

    it("cannot be written to the table directly", async () => {
        const ipas = await raise()
        const { error } = await (await clientFor("outsider"))
            .from("ipas_payment_asks")
            .insert({ ipas_id: ipas.id, amount: 1, purpose: "balance", asked_by: ids.outsider })
        expect(error).not.toBeNull()
    })
})

describe("withdrawing and closing the ask", () => {
    it("lets Purchasing, Finance and a Super Admin withdraw it and nobody else, and then a new ask can be made", async () => {
        const ipas = await raise()
        const first = (await ask("outsider", ipas.id)).data

        const refused = await withdraw("ordinary", first.id)
        expect(refused.error?.code).toBe("42501")

        // #1222: Finance and a Super Admin withdraw an ask too.
        for (const who of ["finance", "superAdmin"]) {
            const other = await raise()
            const theirs = (await ask("outsider", other.id)).data
            const withdrawn = await withdraw(who, theirs.id)
            expect(withdrawn.error, `${who} was refused a withdrawal`).toBeNull()
            expect(withdrawn.data).toMatchObject({ closed_reason: "withdrawn", closed_by: ids[who] })
        }

        const done = await withdraw("outsider", first.id)
        expect(done.error).toBeNull()
        expect(done.data).toMatchObject({ closed_reason: "withdrawn", closed_by: ids.outsider })

        expect((await withdraw("outsider", first.id)).error).not.toBeNull()
        expect((await ask("outsider", ipas.id, { p_purpose: "balance" })).error).toBeNull()
    })

    it("closes when a payment saved as paying it is recorded, and not for a payment that names no ask (#1224)", async () => {
        const ipas = await raise()
        const opened = (await ask("outsider", ipas.id)).data
        expect((await payAsk(ipas.id, null)).error).toBeNull()
        expect((await asksOf(ipas.id))[0].closed_at).toBeNull()

        const paid = await payAsk(ipas.id, opened.id, { p_kind: "down_payment", p_amount: 5600 })
        expect(paid.error).toBeNull()
        const [row] = await asksOf(ipas.id)
        expect(row.closed_reason).toBe("paid")
        expect(row.closed_at).not.toBeNull()
        expect(row.paid_by_payment_id).toBe(paid.data.id)
    })

    it("posts ask, withdraw and close in the IPAS Chat as event lines that notify nobody (the payment line is its own event, not an ask line)", async () => {
        const ipas = await raise()
        const first = (await ask("outsider", ipas.id)).data
        await withdraw("outsider", first.id)
        const second = (await ask("outsider", ipas.id, { p_purpose: "balance" })).data
        const paid = await payAsk(ipas.id, second.id)
        expect(paid.error).toBeNull()

        const lines = await eventLines(ipas.id)
        expect(lines.map((l) => l.metadata.event)).toEqual([
            "payment_ask_opened",
            "payment_ask_withdrawn",
            "payment_ask_opened",
            "payment_ask_closed",
        ])
        expect(lines[0].content).toContain("Down payment")
        const heard = await svc().from("notifications").select("id").eq("reference_id", ipas.id).in("type", ["IPAS_MESSAGE", "IPAS_MENTION"])
        expect(heard.data).toEqual([])
    })
})
