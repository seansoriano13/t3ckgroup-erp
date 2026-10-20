/**
 * #581 follow-up: the IPAS long form refuses Save all when someone else saved first.
 *
 *   - ipas_events is in the supabase_realtime publication (the edit form listens to it)
 *   - ipas_assert_unchanged passes with the newest event time, and with null
 *   - after another change it refuses with 40001 and a sentence telling them to reload
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { closeSql, isInRealtimePublication, serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

const copy = (po) => ({
    po: { id: 861000, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_710_000, name: "Stale Guard Supplier", contact: null },
    lines: [{ line_id: 862000, product_id: 7600, name: "Item 1", quantity: 1, unit: "Unit", price_unit: 100, price_subtotal: 100, taxes: [], analytic: [], brand: null }],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const newest = async (ipasId) =>
    (await svc().from("ipas_events").select("created_at").eq("ipas_id", ipasId).order("created_at", { ascending: false }).limit(1)).data[0].created_at

beforeAll(async () => {
    await ensureCastLoaded()
    await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    await closeSql()
})

describe("IPAS stale-save guard", () => {
    it("ipas_events is in the realtime publication", async () => {
        expect(await isInRealtimePublication("ipas_events")).toBe(true)
    })

    it("passes at the loaded version, refuses after another change", async () => {
        const po = "P9861001"
        const { data: ipas, error } = await raiseAsPurchaser({
            p_po_number: po, p_priority: "high", p_source: "local", p_purpose: "inventory", p_sor_ids: [], p_remarks: null, p_odoo_copy: copy(po),
        })
        expect(error).toBeNull()
        const since = await newest(ipas.id)

        expect((await rpc("outsider", "ipas_assert_unchanged", { p_ipas_id: ipas.id, p_since: since })).error).toBeNull()
        expect((await rpc("outsider", "ipas_assert_unchanged", { p_ipas_id: ipas.id, p_since: null })).error).toBeNull()

        expect((await rpc("outsider", "ipas_set_header", { p_ipas_id: ipas.id, p_fields: { remarks: "Changed by someone" } })).error).toBeNull()

        const refused = await rpc("outsider", "ipas_assert_unchanged", { p_ipas_id: ipas.id, p_since: since })
        expect(refused.error?.code).toBe("40001")
        expect(refused.error?.message).toMatch(/Reload/)
        expect((await rpc("outsider", "ipas_assert_unchanged", { p_ipas_id: ipas.id, p_since: await newest(ipas.id) })).error).toBeNull()
    })
})
