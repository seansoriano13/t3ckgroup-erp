/**
 * Ask for payment: priority and percent (#1208, spec #1205, ADR 0055): the database rules.
 *
 * `outsider` holds Purchasing access; `finance` and `ordinary` do not.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P9${String(98000 + (poSeq += 1)).padStart(6, "0")}`

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
            po: { id: 981000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "EUR", origin: null, partner_ref: null },
            supplier: { id: 9_981_000 + poSeq, name: "Priority Supplier", contact: null },
            lines: [
                { line_id: 981500 + poSeq * 10, product_id: 7800, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null },
            ],
            receipts: { status: "pending", done: 0, total: 1 },
            bills: { count: 0, draft: 0 },
        },
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const ask = (who, ipasId, over = {}) =>
    rpc(who, "ipas_ask_for_payment", { p_ipas_id: ipasId, p_amount: 400, p_purpose: "down_payment", p_note: null, ...over })

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("an ask's priority and percent", () => {
    it("starts on High when no priority is sent", async () => {
        const ipas = await raise()
        const asked = await ask("outsider", ipas.id)
        expect(asked.error).toBeNull()
        expect(asked.data.priority).toBe("high")
        expect(asked.data.percent_of_order).toBeNull()
    })

    it("keeps the priority and percent that were set, and names them in the Chat", async () => {
        const ipas = await raise()
        const asked = await ask("outsider", ipas.id, { p_priority: "very_high", p_percent: 40 })
        expect(asked.error).toBeNull()
        expect(asked.data.priority).toBe("very_high")
        expect(Number(asked.data.percent_of_order)).toBe(40)
        const lines = (await svc().from("ipas_messages").select("content, metadata").eq("ipas_id", ipas.id)).data
        const opened = lines.find((m) => m.metadata?.event === "payment_ask_opened")
        expect(opened.content).toContain("40% of the order")
        expect(opened.content).toContain("Very High priority")
    })

    it("refuses a missing or unknown priority and a bad percent", async () => {
        const ipas = await raise()
        expect((await ask("outsider", ipas.id, { p_priority: null })).error).not.toBeNull()
        expect((await ask("outsider", ipas.id, { p_priority: "urgent" })).error).not.toBeNull()
        expect((await ask("outsider", ipas.id, { p_percent: 0 })).error).not.toBeNull()
        expect((await ask("outsider", ipas.id, { p_percent: -5 })).error).not.toBeNull()
    })

    it("is refused to anyone without Purchasing access", async () => {
        const ipas = await raise()
        for (const who of ["finance", "ordinary"]) {
            const refused = await ask(who, ipas.id, { p_priority: "very_high", p_percent: 40 })
            expect(refused.error?.code, `${who} was allowed`).toBe("42501")
        }
    })
})
