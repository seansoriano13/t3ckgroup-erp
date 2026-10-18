/**
 * Who a Component's PO is with (#281, spec #275): canvass_po_suppliers reads the supplier off the
 * IPAS's stored Odoo copy for anyone who can read the matrix, though `ipas` itself is closed to the
 * Deal Team, ignores a cancelled IPAS, and gives nothing to a caller with no tier.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()
const sorIds = []
const ipasIds = []
let saleTypeId, flowId, stageId, sorId, lineId
let compLive, compCancelled, compNone

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const makeComponent = async (position, po) =>
    (await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position, name: `Component ${position}`, quantity: 1, po_rfq_no: po }).select("id").single(), "Component")).id

const makeIpas = async (po, supplier, extra = {}) => {
    const row = await asSvc(
        svc()
            .from("ipas")
            .insert({ po_number: po, priority: "high", source: "local", purpose: "inventory", odoo_copy: { po: { id: 1, name: po }, supplier }, created_by: ids.outsider, ...extra })
            .select("id")
            .single(),
        "IPAS",
    )
    ipasIds.push(row.id)
}

const read = async (who) => (await (await clientFor(who)).rpc("canvass_po_suppliers", { p_opportunity_id: sorId })).data ?? []

beforeAll(async () => {
    await ensureCastLoaded()
    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} PoSupplier` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} PoSupplier Stage`, sort_order: 10 }).select("id").single(), "stage")).id
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, supportSales1Id: ids.support, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    lineId = (await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: opened.data, position: 1, tender_specification: "Stretcher", quantity: 1 }).select("id").single(), "Tender Line")).id

    compLive = await makeComponent(1, "p98001")
    compCancelled = await makeComponent(2, "P98002")
    compNone = await makeComponent(3, "P98003")
    await makeIpas("P98001", { id: 700, name: "Flywheel Corp." })
    await makeIpas("P98002", { id: 553, name: "Redleaf Inc." }, { state: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "Wrong PO", cancelled_by: ids.outsider })
})

afterAll(async () => {
    await svc().from("ipas").delete().in("id", ipasIds)
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("canvass_po_suppliers", () => {
    it("gives the Deal Team the supplier on the IPAS copy, matching the PO case-insensitively", async () => {
        const rows = await read("dealOwner")
        expect(rows).toEqual([{ component_id: compLive, po_number: "P98001", supplier_id: "700", supplier_name: "Flywheel Corp." }])
    })

    it("ignores a cancelled IPAS and a PO with no IPAS", async () => {
        const rows = await read("dealOwner")
        expect(rows.map((r) => r.component_id)).not.toContain(compCancelled)
        expect(rows.map((r) => r.component_id)).not.toContain(compNone)
    })

    it("gives nothing to someone with no read tier on the SOR", async () => {
        expect(await read("ordinary")).toEqual([])
    })
})
