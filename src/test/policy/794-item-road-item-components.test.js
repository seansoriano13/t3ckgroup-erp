/**
 * Item road: a Requested Item opened from the SOR's own line (source 'sor_line', naming no
 * Component) counts for the Component of the Tender Line on the same SOR line, when that line
 * has exactly one Component. With two it counts for neither; an item on another SOR's request
 * never counts. An item that names a Component still counts for it.
 *
 * Read as ipasSigner (on the final_acquire list, so the Closed Book tier).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId, sorId, otherSorId, requestId, otherRequestId
let hoseLine, tripodLine, otherHose
let hose, tripodA, tripodB, named
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}
const one = async (table, row, what) => (await asSvc(svc().from(table).insert(row).select("id").single(), what)).id

const item = (request, fields) =>
    one("purchase_request_items", { request_id: request, quantity: 1, requested_by: ids.outsider, ...fields }, `item ${fields.name}`)

beforeAll(async () => {
    await ensureCastLoaded()
    saleTypeId = await one("sale_types", { name: `${MARKER} Item road` }, "sale type")
    flowId = await one("sales_flows", { sale_type_id: saleTypeId }, "flow")
    stageId = await one("flow_stages", { flow_id: flowId, name: `${MARKER} Item road Stage`, sort_order: 10 }, "stage")
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    otherSorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId, otherSorId)
    await asSvc(svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.ipasSigner }), "signer list")

    hoseLine = await one("sales_opportunity_items", { opportunity_id: sorId, product_name: "Fire hose", unit: "pc", quantity: 4, unit_price: 0, sort_order: 1 }, "hose S0 line")
    tripodLine = await one("sales_opportunity_items", { opportunity_id: sorId, product_name: "Tripod", unit: "pc", quantity: 1, unit_price: 0, sort_order: 2 }, "tripod S0 line")
    otherHose = await one("sales_opportunity_items", { opportunity_id: otherSorId, product_name: "Fire hose", unit: "pc", quantity: 4, unit_price: 0, sort_order: 1 }, "other S0 line")

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    // Opening fills nothing by itself here; make the lines by hand, pointing at the S0 lines.
    await svc().from("costing_tender_lines").delete().eq("matrix_id", opened.data)
    const l1 = await one("costing_tender_lines", { matrix_id: opened.data, position: 1, tender_specification: "Fire hose", quantity: 4, source: "sor_line", sor_item_id: hoseLine }, "hose line")
    const l2 = await one("costing_tender_lines", { matrix_id: opened.data, position: 2, tender_specification: "Tripod", quantity: 1, source: "sor_line", sor_item_id: tripodLine }, "tripod line")
    const l3 = await one("costing_tender_lines", { matrix_id: opened.data, position: 3, tender_specification: "Typed", quantity: 1 }, "typed line")
    hose = await one("costing_components", { tender_line_id: l1, position: 1, name: "Fire hose", quantity: 4 }, "hose part")
    tripodA = await one("costing_components", { tender_line_id: l2, position: 1, name: "Tripod legs", quantity: 1 }, "tripod part A")
    tripodB = await one("costing_components", { tender_line_id: l2, position: 2, name: "Tripod head", quantity: 1 }, "tripod part B")
    named = await one("costing_components", { tender_line_id: l3, position: 1, name: "Typed part", quantity: 1 }, "typed part")

    requestId = await one("purchase_requests", { opportunity_id: sorId, created_by: ids.dealOwner }, "request")
    otherRequestId = await one("purchase_requests", { opportunity_id: otherSorId, created_by: ids.dealOwner }, "other request")
    // The S0-line trigger may already have opened items for the S0 lines; start from none.
    await svc().from("purchase_request_items").delete().in("request_id", [requestId, otherRequestId])

    await item(requestId, { name: "Fire hose", source: "sor_line", sor_item_id: hoseLine, status: "purchased", po_number: "P01999" })
    await item(requestId, { name: "Tripod", source: "sor_line", sor_item_id: tripodLine })
    await item(otherRequestId, { name: "Fire hose", source: "sor_line", sor_item_id: otherHose })
    await item(requestId, { name: "Typed part", source: "component", component_id: named })
})

afterAll(async () => {
    await svc().from("purchase_request_items").delete().in("request_id", [requestId, otherRequestId])
    await svc().from("purchase_requests").delete().in("id", [requestId, otherRequestId])
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunity_items").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("which items buy for which part", () => {
    it("counts an item from the S0 line for the line's only part, and a named item for its part", async () => {
        const { data, error } = await (await clientFor("ipasSigner")).rpc("costing_component_requests", { p_opportunity_id: sorId })
        expect(error).toBeNull()
        const parts = data.map((r) => r.component_id).sort()
        expect(parts).toEqual([hose, named].sort())
    })

    it("leaves an item out when its line has two parts, and never takes another SOR's item", async () => {
        const { data } = await (await clientFor("ipasSigner")).rpc("costing_component_requests", { p_opportunity_id: sorId })
        expect(data.some((r) => r.component_id === tripodA || r.component_id === tripodB)).toBe(false)
        expect(data).toHaveLength(2)
    })

    it("shows the S0-line item's status and P0 on the part's purchases", async () => {
        const { data, error } = await (await clientFor("ipasSigner")).rpc("costing_component_purchases", { p_opportunity_id: sorId })
        expect(error).toBeNull()
        const row = data.find((r) => r.component_id === hose)
        expect(row.requests).toHaveLength(1)
        expect(row.requests[0]).toMatchObject({ status: "purchased", po_number: "P01999" })
        expect(Number(row.ordered_quantity)).toBe(1)
        expect(row.ipas.map((i) => i.po_number)).toEqual(["P01999"])
    })
})
