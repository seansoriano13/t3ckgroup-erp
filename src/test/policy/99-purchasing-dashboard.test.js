/**
 * Purchasing Dashboard (#322): purchasing_dashboard_rows. Every outstanding piece of buying, one row
 * per thing that owns the work, tagged with the group it is in. The groups are derived here and never
 * stored; one SOR sits in as many groups as apply. Counts only: no money column is ever served.
 *
 * One SOR carries work in four groups at once:
 *   To source  one Requested Item at Requested, one Canvass with no winner
 *   To price   one Component with no Acquire (the matrix has a Go decision)
 *   To order   one Component priced, no PO yet
 *   On order   one Requested Item Ordered, on a Component with no Canvass
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()

let sorId, matrixId, lineId, requestId
let unpricedComp, orderedComp, canvassId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const dashboard = async (who) => (await clientFor(who)).rpc("purchasing_dashboard_rows")
const mine = (rows) => (rows ?? []).filter((row) => row.opportunity_id === sorId)

async function makeComponent(position, name, acquire) {
    const comp = await asSvc(
        svc().from("costing_components").insert({ tender_line_id: lineId, position, name, quantity: 1, purchasing_incharge_id: ids.outsider }).select("id").single(),
        "Component",
    )
    if (acquire != null) {
        await asSvc(svc().from("costing_component_costs").upsert({ component_id: comp.id, acquire_unit: acquire }), "Acquire")
    }
    return comp.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(sorId)
    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data
    lineId = (
        await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Ambulance" }).select("id").single(), "Tender Line")
    ).id

    unpricedComp = await makeComponent(1, "Stretcher", null)
    await makeComponent(2, "Beacon", 1000)
    orderedComp = await makeComponent(3, "Siren", 2000)
    await asSvc(
        svc().from("costing_bid_decisions").insert({ matrix_id: matrixId, verdict: "go", reason: "fixture", final_offer_total: 0 }),
        "Bid Decision",
    )
    canvassId = (await asSvc(svc().from("sor_canvasses").insert({ component_id: unpricedComp, created_by: ids.outsider }).select("id").single(), "Canvass")).id

    requestId = (
        await asSvc(svc().from("purchase_requests").insert({ opportunity_id: sorId, created_by: ids.dealOwner, buyer_id: ids.outsider }).select("id").single(), "request")
    ).id
    await asSvc(
        svc().from("purchase_request_items").insert({ request_id: requestId, name: "Spine board", source: "new", requested_by: ids.dealOwner }).select("id").single(),
        "Requested Item",
    )
    await asSvc(
        svc()
            .from("purchase_request_items")
            .insert({ request_id: requestId, name: "Siren", source: "new", requested_by: ids.dealOwner, component_id: orderedComp, status: "ordered", po_number: `P99${Date.now() % 100000}` })
            .select("id")
            .single(),
        "Ordered Item",
    )
})

afterAll(async () => {
    await svc().from("sor_canvasses").delete().eq("id", canvassId)
    await svc().from("purchase_request_items").delete().eq("request_id", requestId)
    await svc().from("purchase_requests").delete().eq("id", requestId)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
})

describe("who reads the dashboard", () => {
    it("serves a plain employee nothing", async () => {
        const { data, error } = await dashboard("ordinary")
        expect(error).toBeNull()
        expect(mine(data)).toEqual([])
    })

    it.each(["outsider", "finance", "superAdmin"])("serves %s every group", async (who) => {
        const { data, error } = await dashboard(who)
        expect(error).toBeNull()
        expect(mine(data).length).toBeGreaterThan(0)
    })
})

describe("one SOR in many groups", () => {
    it("puts the SOR in all four groups that apply, and not in To check", async () => {
        const { data } = await dashboard("outsider")
        const groups = [...new Set(mine(data).map((row) => row.grp))].sort()
        expect(groups).toEqual(["on_order", "to_order", "to_price", "to_source"])
    })

    it("names the record that owns each piece of work", async () => {
        const rows = mine((await dashboard("outsider")).data)
        const keyed = rows.map((row) => `${row.grp}:${row.target_kind}:${row.target_id}`).sort()
        expect(keyed).toEqual(
            [
                `on_order:purchase_request:${requestId}`,
                `to_order:costing_matrix:${sorId}`,
                `to_price:costing_matrix:${sorId}`,
                `to_source:canvass:${canvassId}`,
                `to_source:purchase_request:${requestId}`,
            ].sort(),
        )
    })

    it("counts the items each row holds", async () => {
        const rows = mine((await dashboard("outsider")).data)
        const count = (grp) => rows.filter((row) => row.grp === grp).reduce((sum, row) => sum + row.item_count, 0)
        expect(count("to_source")).toBe(2)
        expect(count("to_price")).toBe(1)
        expect(count("to_order")).toBe(1)
        expect(count("on_order")).toBe(1)
    })

    it("marks the item ordered with no canvass", async () => {
        const rows = mine((await dashboard("outsider")).data)
        expect(rows.find((row) => row.grp === "on_order").no_canvass_count).toBe(1)
    })

    it("carries the Buyer and the Canvasser for the filters", async () => {
        const rows = mine((await dashboard("outsider")).data)
        expect(rows.find((row) => row.target_kind === "purchase_request" && row.grp === "to_source").buyer_id).toBe(ids.outsider)
        expect(rows.find((row) => row.target_kind === "canvass").canvasser_id).toBe(ids.outsider)
    })

    it("sends no money", async () => {
        const { data } = await dashboard("superAdmin")
        expect(Object.keys(mine(data)[0]).sort()).toEqual(
            ["buyer_id", "canvasser_id", "grp", "item_count", "no_canvass_count", "opportunity_id", "project_title", "sales_reference", "request_id", "since", "target_id", "target_kind", "target_label"].sort(),
        )
    })
})

describe("what moves the SOR between groups", () => {
    it("drops To source for the Canvass once an Offer wins", async () => {
        const offer = await asSvc(svc().from("sor_canvass_offers").insert({ canvass_id: canvassId, supplier_name: `${MARKER} Win`, is_winner: true }).select("id").single(), "Offer")
        const rows = mine((await dashboard("outsider")).data)
        expect(rows.some((row) => row.target_kind === "canvass")).toBe(false)
        await svc().from("sor_canvass_offers").delete().eq("id", offer.id)
    })

    it("leaves out a Canvass whose Component is already ordered", async () => {
        const late = await asSvc(svc().from("sor_canvasses").insert({ component_id: orderedComp, created_by: ids.outsider }).select("id").single(), "late Canvass")
        const rows = mine((await dashboard("outsider")).data)
        expect(rows.some((row) => row.target_id === late.id)).toBe(false)
        await svc().from("sor_canvasses").delete().eq("id", late.id)
    })

    it("puts the whole matrix back in To price when its decision is cleared", async () => {
        await asSvc(svc().from("costing_bid_decisions").update({ cleared_at: new Date().toISOString(), cleared_reason: "fixture" }).eq("matrix_id", matrixId), "clear")
        const rows = mine((await dashboard("outsider")).data)
        expect(rows.some((row) => row.grp === "to_order")).toBe(false)
        expect(rows.find((row) => row.grp === "to_price").item_count).toBe(2)
        await asSvc(svc().from("costing_bid_decisions").update({ cleared_at: null, cleared_reason: null }).eq("matrix_id", matrixId), "unclear")
    })
})
