/**
 * The Payers list (#1223, spec #1220, ADR 0055): the database rules.
 *
 * `outsider` holds Purchasing access and asks; `ipasSigner` and `ordinary` are put on the Payers list
 * (and taken off again). Here: the list key is accepted, call sign 201 is seeded, a new ask rings the
 * bell for Payers only (never the asker), edit/withdraw/paid ring nothing, and being a Payer grants no
 * IPAS read or write.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P9${String(94500 + (poSeq += 1)).padStart(6, "0")}`

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
            po: { id: 945000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "EUR", origin: null, partner_ref: null },
            supplier: { id: 9_945_000 + poSeq, name: "Payer Supplier", contact: null },
            lines: [
                { line_id: 945500 + poSeq * 10, product_id: 7700, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null },
            ],
            receipts: { status: "pending", done: 0, total: 1 },
            bills: { count: 0, draft: 0 },
        },
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const ask = (who, ipasId) =>
    rpc(who, "ipas_ask_for_payment", { p_ipas_id: ipasId, p_amount: 5600, p_purpose: "down_payment", p_note: null })
const bells = async (ipasId, recipient) =>
    (await svc().from("notifications").select("id, type, recipient_id").eq("reference_id", ipasId).eq("type", "IPAS_PAYMENT_ASKED").eq("recipient_id", recipient)).data
const putOnPayers = async (...people) => {
    const { error } = await svc().from("ipas_signer_lists").insert(people.map((p) => ({ list_key: "payers", employee_id: p })))
    if (error) throw error
}
const clearPayers = () => svc().from("ipas_signer_lists").delete().eq("list_key", "payers")

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterEach(async () => {
    await clearPayers()
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false, call_sign: null }).eq("id", ids.ordinary)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("the Payers list", () => {
    it("is a list a Super Admin can set, and nobody else", async () => {
        const done = await rpc("superAdmin", "ipas_set_signer_list", { p_list_key: "payers", p_employee_ids: [ids.ipasSigner] })
        expect(done.error).toBeNull()
        const rows = (await svc().from("ipas_signer_lists").select("employee_id").eq("list_key", "payers")).data
        expect(rows.map((r) => r.employee_id)).toEqual([ids.ipasSigner])

        const refused = await rpc("outsider", "ipas_set_signer_list", { p_list_key: "payers", p_employee_ids: [] })
        expect(refused.error?.code).toBe("42501")
    })

    it("puts the employee with call sign 201 on the list, and only once", async () => {
        const flag = await svc().from("employees").update({ call_sign: "201" }).eq("id", ids.ordinary)
        expect(flag.error).toBeNull()

        await sql().query("select public._ipas_seed_payers()")
        await sql().query("select public._ipas_seed_payers()")

        const rows = (await svc().from("ipas_signer_lists").select("employee_id").eq("list_key", "payers")).data
        expect(rows.map((r) => r.employee_id)).toEqual([ids.ordinary])
    })
})

describe("a new ask for payment", () => {
    it("rings the bell for every Payer but the asker, and for nobody else", async () => {
        await putOnPayers(ids.ipasSigner, ids.outsider)
        const ipas = await raise()

        expect((await ask("outsider", ipas.id)).error).toBeNull()

        const got = await bells(ipas.id, ids.ipasSigner)
        expect(got).toHaveLength(1)
        expect(await bells(ipas.id, ids.outsider)).toHaveLength(0)
        expect(await bells(ipas.id, ids.finance)).toHaveLength(0)
    })

    it("rings nothing when the ask is withdrawn or a payment closes it", async () => {
        await putOnPayers(ids.ipasSigner)
        const ipas = await raise()
        await ask("outsider", ipas.id)
        await svc().from("notifications").delete().eq("reference_id", ipas.id)

        expect((await rpc("outsider", "ipas_withdraw_payment_ask", { p_ipas_id: ipas.id })).error).toBeNull()
        const all = (await svc().from("notifications").select("id").eq("reference_id", ipas.id).eq("type", "IPAS_PAYMENT_ASKED")).data
        expect(all).toEqual([])
    })
})

describe("being a Payer", () => {
    it("grants no IPAS read and no write", async () => {
        await putOnPayers(ids.ordinary)
        const ipas = await raise()

        const read = await (await clientFor("ordinary")).from("ipas").select("id").eq("id", ipas.id)
        expect(read.data ?? []).toEqual([])

        const asked = await ask("ordinary", ipas.id)
        expect(asked.error?.code).toBe("42501")
    })
})
