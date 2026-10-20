/**
 * Order Monitoring (#263, spec #261): who reads the cross-SOR list. The list
 * reads `ipas` through the IPAS read policy (`ipas_can_read()`), so the rule is
 * proven on that same read: a plain employee sees none of the open IPAS, and
 * Purchasing access, Finance access and a Super Admin see every one. Built on
 * 56 (the same raise path and helpers).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

const RUN = Date.now() % 100000
const odooCopy = (po) => ({
    po: { id: 990000 + RUN, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 553, name: "Scorpe Technologies", contact: null },
    lines: [
        { line_id: 940000 + RUN, product_id: 5350, name: "Cutter", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [], brand: "SCORPE" },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const createdIds = []

async function raiseOpenIpas(index) {
    const po = `P76${RUN}${index}`
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: odooCopy(po),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    createdIds.push(data.id)
    return data.id
}

/** The IPAS ids a caller can see among the fixtures, read the way the list reads them. */
async function visibleTo(who) {
    const { data, error } = await (await clientFor(who))
        .from("ipas")
        .select("id, state")
        .neq("state", "cancelled")
        .in("id", createdIds)
    if (error) throw error
    return data.map((row) => row.id).sort()
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    await raiseOpenIpas(1)
    await raiseOpenIpas(2)
})

afterAll(async () => {
    await purgeIpas(createdIds)
    const flag = await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

describe("Order Monitoring: who reads the cross-SOR list", () => {
    it("shows a plain employee none of the open IPAS", async () => {
        expect(createdIds).toHaveLength(2)
        expect(await visibleTo("ordinary")).toEqual([])
    })

    it("shows Purchasing access every open IPAS", async () => {
        expect(await visibleTo("outsider")).toEqual([...createdIds].sort())
    })

    it("shows Finance access every open IPAS", async () => {
        expect(await visibleTo("finance")).toEqual([...createdIds].sort())
    })

    it("shows a Super Admin every open IPAS", async () => {
        expect(await visibleTo("superAdmin")).toEqual([...createdIds].sort())
    })
})
