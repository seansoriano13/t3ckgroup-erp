/**
 * Direct delivery to the client (#1158, spec #1151): the database rules.
 *
 * `outsider` holds Purchasing access and raises; `finance` holds Finance access alone; `ipasSigner` is
 * given Logistics access for the run. Logistics asks only for the Delivered status while it is on.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)
let poSeq = 0

async function raise() {
    const po = `P9${String(115800 + (poSeq += 1)).padStart(6, "0")}`
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po, p_priority: "high", p_source: "local", p_purpose: "inventory", p_sor_ids: [], p_remarks: null,
        p_odoo_copy: {
            po: { id: 1158000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
            supplier: { id: 9_158_000 + poSeq, name: "Direct Supplier", contact: null },
            lines: [{ line_id: 1158500 + poSeq * 10, product_id: 7710, name: "Item 1", quantity: 1, unit: "Unit", price_unit: 100, price_subtotal: 100, taxes: [], analytic: [], brand: null }],
            receipts: { status: "pending", done: 0, total: 1 },
            bills: { count: 0, draft: 0 },
        },
    })
    if (error) throw new Error(`ipas_create: ${error.message}`)
    return data
}

const missing = async (ipasId) => (await svc().rpc("_ipas_logistics_missing", { p_ipas_id: ipasId })).data

beforeAll(async () => {
    await ensureCastLoaded()
    await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    await svc().from("employees").update({ has_logistics_flow: true }).eq("id", ids.ipasSigner)
})

afterAll(async () => {
    await svc().from("employees").update({ has_logistics_flow: false }).eq("id", ids.ipasSigner)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("who switches Direct delivery", () => {
    it("lets Purchasing and Logistics access, writes an event, and refuses Finance alone", async () => {
        const ipas = await raise()
        expect((await rpc("outsider", "ipas_set_direct_delivery", { p_ipas_id: ipas.id, p_on: true })).error).toBeNull()
        expect((await rpc("ipasSigner", "ipas_set_direct_delivery", { p_ipas_id: ipas.id, p_on: false })).error).toBeNull()
        const events = (await svc().from("ipas_events").select("kind").eq("ipas_id", ipas.id).eq("kind", "direct_delivery_changed")).data
        expect(events).toHaveLength(2)
        const refused = await rpc("finance", "ipas_set_direct_delivery", { p_ipas_id: ipas.id, p_on: true })
        expect(refused.error?.message).toMatch(/only Purchasing, Logistics or a Super Admin/)
    })

    it("refuses a filed IPAS", async () => {
        const ipas = await raise()
        await svc().from("ipas").update({ state: "filed" }).eq("id", ipas.id)
        const refused = await rpc("outsider", "ipas_set_direct_delivery", { p_ipas_id: ipas.id, p_on: true })
        expect(refused.error).not.toBeNull()
    })
})

describe("what Logistics asks for", () => {
    it("asks only for Delivered while on, and everything again once off", async () => {
        const ipas = await raise()
        expect(await missing(ipas.id)).toEqual(expect.arrayContaining(["the Item Location", "a Transmittal", "the Delivered status"]))
        await rpc("outsider", "ipas_set_direct_delivery", { p_ipas_id: ipas.id, p_on: true })
        expect(await missing(ipas.id)).toEqual(["the Delivered status"])
        await rpc("outsider", "ipas_set_direct_delivery", { p_ipas_id: ipas.id, p_on: false })
        expect(await missing(ipas.id)).toHaveLength(3)
    })
})
