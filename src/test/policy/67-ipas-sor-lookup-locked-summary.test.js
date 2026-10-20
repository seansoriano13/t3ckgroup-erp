/**
 * The IPAS SOR lookups return the locked SOR summary and nothing more (#241,
 * ADR 0021): Sales Reference, project and current Stage name. No customer name,
 * and the search no longer matches one.
 *
 * `outsider` holds Purchasing access and cannot read the SOR; `finance` reads
 * every IPAS.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor } from "./support/rows.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

const RUN = Date.now().toString(36)
const CUSTOMER = `Zorblax Holdings ${RUN}`
const odooCopy = (po) => ({
    po: { id: 880001, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 554, name: "Locked Summary Supplier", contact: null },
    lines: [
        { line_id: 880011, product_id: 5360, name: "Cutter", quantity: 2, unit: "Unit", price_unit: 100, price_subtotal: 200, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

let sorId
let ref
let stage
let ipas

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error

    const stages = await svc().from("flow_stages").select("id, name").limit(1)
    if (stages.error) throw stages.error
    stage = stages.data?.[0] ?? null

    sorId = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        flowStageId: stage?.id ?? null,
        companyName: CUSTOMER,
    })
    ref = `S6${String(Date.now()).slice(-6)}`
    const set = await svc().from("sales_opportunities").update({ sales_reference: ref }).eq("id", sorId)
    if (set.error) throw set.error

    const { data, error } = await raiseAsPurchaser({
        p_po_number: "P9880001",
        p_priority: "high",
        p_source: "local",
        p_purpose: "project",
        p_sor_ids: [sorId],
        p_remarks: null,
        p_odoo_copy: odooCopy("P9880001"),
    })
    if (error) throw new Error(`ipas_create: ${error.message}`)
    ipas = data
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    if (sorId) await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("ipas_find_sors", () => {
    it("returns reference, project and Stage only, never the customer", async () => {
        const { data, error } = await rpc("outsider", "ipas_find_sors", { p_refs: [ref], p_search: null })
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
        expect(Object.keys(data[0]).sort()).toEqual(["current_stage_name", "opportunity_id", "project_title", "sales_reference"])
        expect(data[0]).toMatchObject({
            opportunity_id: sorId,
            sales_reference: ref,
            current_stage_name: stage?.name ?? null,
        })
        expect(JSON.stringify(data)).not.toContain(CUSTOMER)
    })

    it("searches by reference or project name", async () => {
        const byRef = await rpc("outsider", "ipas_find_sors", { p_refs: null, p_search: ref.toLowerCase() })
        expect(byRef.data.map((r) => r.opportunity_id)).toContain(sorId)
        const byProject = await rpc("outsider", "ipas_find_sors", { p_refs: null, p_search: "rope rescue equipment" })
        expect(byProject.data.map((r) => r.opportunity_id)).toContain(sorId)
    })

    it("no longer matches the customer name", async () => {
        const { data, error } = await rpc("outsider", "ipas_find_sors", { p_refs: null, p_search: "zorblax" })
        expect(error).toBeNull()
        expect(data).toEqual([])
    })
})

describe("ipas_sor_headers", () => {
    it("returns the IPAS id, reference, project and Stage only, never the customer", async () => {
        const { data, error } = await rpc("finance", "ipas_sor_headers", { p_ipas_ids: [ipas.id] })
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
        expect(Object.keys(data[0]).sort()).toEqual([
            "current_stage_name",
            "ipas_id",
            "opportunity_id",
            "project_title",
            "sales_reference",
        ])
        expect(data[0]).toMatchObject({ ipas_id: ipas.id, opportunity_id: sorId, sales_reference: ref, current_stage_name: stage?.name ?? null })
        expect(JSON.stringify(data)).not.toContain(CUSTOMER)
    })

    it("still gives a non-reader, and a null or empty id list, nothing", async () => {
        expect((await rpc("ordinary", "ipas_sor_headers", { p_ipas_ids: [ipas.id] })).data).toEqual([])
        expect((await rpc("finance", "ipas_sor_headers", { p_ipas_ids: null })).data).toEqual([])
        expect((await rpc("finance", "ipas_sor_headers", { p_ipas_ids: [] })).data).toEqual([])
    })
})
