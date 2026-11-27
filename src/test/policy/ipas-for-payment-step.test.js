/**
 * For Payment back as an IPAS Status step (2026-11-27, ADR 0054 / 0055 amendments). It is a side step: picking it
 * keeps every goods step and its day, remembers the goods step, and goes back there by itself once no payment
 * request is open (paid or withdrawn). A Status moved by hand in the meantime is left alone. These tests need the
 * local stack (Docker); CI runs them.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
let methodId = null
const nextPo = () => `P9${String(127000 + (poSeq += 1)).padStart(6, "0")}`

async function raise(source = "import") {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: source,
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: {
            po: { id: 1270000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "USD", origin: null, partner_ref: null },
            supplier: { id: 9_127_000 + poSeq, name: "For Payment Supplier", contact: null },
            lines: [
                { line_id: 1270500 + poSeq * 10, product_id: 7720, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null },
            ],
            receipts: { status: "pending", done: 0, total: 1 },
            bills: { count: 0, draft: 0 },
        },
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const setStatus = (ipasId, step, on = null) => rpc("outsider", "ipas_set_status", { p_ipas_id: ipasId, p_step: step, p_reached_on: on })
const ask = (ipasId, over = {}) =>
    rpc("outsider", "ipas_ask_for_payment", { p_ipas_id: ipasId, p_amount: 300, p_purpose: "down_payment", p_note: null, ...over })
const withdraw = (askId) => rpc("outsider", "ipas_withdraw_payment_ask", { p_ask_id: askId })
const pay = (ipasId, askId) =>
    rpc("outsider", "ipas_save_payment", {
        p_ipas_id: ipasId,
        p_payment_id: null,
        p_kind: "down_payment",
        p_paid_on: "2026-11-01",
        p_amount: 300,
        p_forex_rate: null,
        p_doc_stamp_php: 0,
        p_misc_fee_php: 0,
        p_charge_fee_php: 0,
        p_method_id: methodId,
        p_check_no: null,
        p_proof_url: null,
        p_ask_id: askId,
    })

const row = async (ipasId) => (await svc().from("ipas").select("status, status_before_payment").eq("id", ipasId).single()).data
const steps = async (ipasId) =>
    Object.fromEntries(
        (await svc().from("ipas_status_steps").select("step, reached_on").eq("ipas_id", ipasId)).data.map((s) => [s.step, s.reached_on]),
    )
const statusLines = async (ipasId) =>
    (await svc().from("ipas_messages").select("content, metadata").eq("ipas_id", ipasId).order("created_at")).data
        .filter((m) => m.metadata?.event === "status_changed")
        .map((m) => m.content)

/** An Import IPAS walked to Customs with a day on each step on the way. */
async function atCustoms() {
    const ipas = await raise("import")
    for (const [step, on] of [["ordered", "2026-11-02"], ["shipped", "2026-11-05"], ["in_transit", "2026-11-06"], ["customs", "2026-11-10"]]) {
        const { error } = await setStatus(ipas.id, step, on)
        if (error) throw new Error(`${step}: ${error.message}`)
    }
    return ipas
}

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

describe("picking For Payment", () => {
    it("is a step again, right after Order-Draft", async () => {
        const order = async (step) => (await svc().rpc("_ipas_status_order", { p_step: step })).data
        expect(await order("for_payment")).toBe(2)
        expect(await order("order_draft")).toBe(1)
        expect(await order("ordered")).toBe(3)
    })

    it("keeps every goods step and its day, and remembers where the goods are", async () => {
        const ipas = await atCustoms()
        const before = await steps(ipas.id)

        const { error } = await setStatus(ipas.id, "for_payment")
        expect(error).toBeNull()
        expect(await row(ipas.id)).toEqual({ status: "for_payment", status_before_payment: "customs" })

        const after = await steps(ipas.id)
        for (const [step, on] of Object.entries(before)) expect(after[step], step).toBe(on)
        expect(after.for_payment).toBeTruthy()
        expect((await statusLines(ipas.id)).at(-1)).toBe("Status set to For Payment (was Customs / Port Hold).")
    })

    it("leaving it by hand drops its row and keeps the goods days", async () => {
        const ipas = await atCustoms()
        await setStatus(ipas.id, "for_payment")
        const { error } = await setStatus(ipas.id, "local_hub")
        expect(error).toBeNull()
        expect(await row(ipas.id)).toEqual({ status: "local_hub", status_before_payment: null })
        const after = await steps(ipas.id)
        expect(after.for_payment).toBeUndefined()
        expect(after.customs).toBe("2026-11-10")
        expect(after.ordered).toBe("2026-11-02")
    })

    it("refuses a goods step under it that is For Payment itself", async () => {
        const ipas = await raise()
        const { error } = await svc().from("ipas").update({ status_before_payment: "for_payment" }).eq("id", ipas.id)
        expect(error?.code).toBe("23514")
    })
})

describe("going back by itself", () => {
    it("goes back to the goods step once the only request is paid, and says the app moved it", async () => {
        const ipas = await atCustoms()
        await setStatus(ipas.id, "for_payment")
        const asked = await ask(ipas.id)
        expect(asked.error).toBeNull()

        const paid = await pay(ipas.id, asked.data.id)
        expect(paid.error).toBeNull()

        expect(await row(ipas.id)).toEqual({ status: "customs", status_before_payment: null })
        expect((await steps(ipas.id)).customs).toBe("2026-11-10")
        expect((await statusLines(ipas.id)).at(-1)).toBe(
            "Status set to Customs / Port Hold (was For Payment). Moved back by the app: no payment request is open.",
        )
    })

    it("goes back when the request is withdrawn", async () => {
        const ipas = await atCustoms()
        await setStatus(ipas.id, "for_payment")
        const asked = await ask(ipas.id)
        expect((await withdraw(asked.data.id)).error).toBeNull()
        expect((await row(ipas.id)).status).toBe("customs")
    })

    it("waits while another request is still open", async () => {
        const ipas = await atCustoms()
        await setStatus(ipas.id, "for_payment")
        const first = await ask(ipas.id)
        const second = await ask(ipas.id, { p_purpose: "balance", p_amount: 200 })
        expect(second.error).toBeNull()

        await withdraw(first.data.id)
        expect((await row(ipas.id)).status).toBe("for_payment")

        await withdraw(second.data.id)
        expect((await row(ipas.id)).status).toBe("customs")
    })

    it("goes back to Order-Draft when For Payment was picked there", async () => {
        const ipas = await raise()
        await setStatus(ipas.id, "for_payment")
        const asked = await ask(ipas.id)
        await withdraw(asked.data.id)
        expect(await row(ipas.id)).toEqual({ status: "order_draft", status_before_payment: null })
    })

    it("leaves a Status moved by hand alone", async () => {
        const ipas = await atCustoms()
        await setStatus(ipas.id, "for_payment")
        const asked = await ask(ipas.id)
        await setStatus(ipas.id, "local_hub")

        await withdraw(asked.data.id)
        expect((await row(ipas.id)).status).toBe("local_hub")
    })

    it("does nothing when a request closes on an IPAS that isn't on For Payment", async () => {
        const ipas = await atCustoms()
        const asked = await ask(ipas.id)
        const linesBefore = (await statusLines(ipas.id)).length
        await withdraw(asked.data.id)
        expect((await row(ipas.id)).status).toBe("customs")
        expect((await statusLines(ipas.id)).length).toBe(linesBefore)
    })
})

describe("filing and the Local switch", () => {
    it("a reopen never lands on For Payment", async () => {
        const ipas = await atCustoms()
        await setStatus(ipas.id, "for_payment")
        await svc().from("ipas").update({ state: "filed", filed_at: new Date().toISOString() }).eq("id", ipas.id)
        expect(await row(ipas.id)).toEqual({ status: "done", status_before_payment: null })

        const reopened = await rpc("superAdmin", "ipas_reopen", { p_ipas_id: ipas.id, p_reason: "Wrong bill" })
        expect(reopened.error).toBeNull()
        expect((await row(ipas.id)).status).toBe("customs")
    })

    it("switching to Local while on For Payment moves the goods step under it off Customs", async () => {
        const ipas = await atCustoms()
        await setStatus(ipas.id, "for_payment")
        await svc().from("ipas").update({ source: "local" }).eq("id", ipas.id)
        expect(await row(ipas.id)).toEqual({ status: "for_payment", status_before_payment: "in_transit" })
    })
})

describe("Order Monitoring", () => {
    it("has an Ageing rule on For Payment again", async () => {
        const rules = await svc().from("order_ageing_rules").select("step").eq("step", "for_payment")
        expect(rules.error).toBeNull()
        expect(rules.data).toHaveLength(1)
    })
})
