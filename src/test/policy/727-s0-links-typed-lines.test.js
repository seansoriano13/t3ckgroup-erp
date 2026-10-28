/**
 * S0 Evaluation, the S0 links to typed lines (#727, spec #718 "Tender-first lines"; migration
 * 20261113090000_727_s0_links_typed_lines.sql).
 *
 * "Refresh from the SOR" (costing_fill_from_sor) matches each S0 line, in order: the line already
 * holding its Odoo line id, else an unlinked typed line with the same Odoo product, else a new row.
 * A similar name is only ever a suggestion (costing_s0_link_suggestions) that Sales confirms
 * (costing_link_to_s0_line). Linking keeps the line's work and is allowed while a Go locks the sheet.
 *
 * The cast, on one SOR (dealOwner is its Deal Team):
 *   dealOwner  Deal Team         -> Sales band: refreshes, confirms
 *   outsider   Purchasing access -> Purchasing band: refreshes, cannot confirm
 *   ordinary   nobody            -> refused
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { RLS_VIOLATION } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()
const BAD_INPUT = "22023"

let saleTypeId, flowId, stageId
const sorIds = []
let position = 0

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

/** A fresh SOR with an open matrix. */
async function newSor() {
    const sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)
    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    return { sorId, matrixId: opened.data }
}

const s0Line = async (sorId, fields) =>
    (
        await asSvc(
            svc()
                .from("sales_opportunity_items")
                .insert({ opportunity_id: sorId, unit: "pc", quantity: 1, unit_price: 100, sort_order: ++position, ...fields })
                .select("*")
                .single(),
            "S0 line",
        )
    ).id

const typedLine = async (matrixId, fields = {}) =>
    asSvc(
        svc()
            .from("costing_tender_lines")
            .insert({ matrix_id: matrixId, position: ++position, source: "typed", tender_specification: "Rescue tripod", unit: "set", quantity: 2, ...fields })
            .select("*")
            .single(),
        "typed line",
    )

const line = async (id) => asSvc(svc().from("costing_tender_lines").select("*").eq("id", id).single(), "line")
const lines = (matrixId) => asSvc(svc().from("costing_tender_lines").select("*").eq("matrix_id", matrixId).order("position"), "lines")
const refresh = async (who, sorId) => (await clientFor(who)).rpc("costing_fill_from_sor", { p_opportunity_id: sorId })
const suggestions = async (who, sorId) => (await clientFor(who)).rpc("costing_s0_link_suggestions", { p_opportunity_id: sorId })
const link = async (who, lineId, itemId) => (await clientFor(who)).rpc("costing_link_to_s0_line", { p_tender_line_id: lineId, p_sor_item_id: itemId })

/** A Component with a cost, a compliance note and a multiplier: the work a link must not lose. */
async function addWork(lineId) {
    const comp = await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 1, name: "Tripod", quantity: 1, compliance_note: "Meets spec" }).select("id").single(), "Component")
    await asSvc(svc().from("costing_component_costs").insert({ component_id: comp.id, odoo_unit: 50, acquire_unit: 50 }).select("component_id").single(), "cost")
    return comp.id
}

async function goLock(matrixId) {
    await asSvc(svc().from("costing_bid_decisions").insert({ matrix_id: matrixId, verdict: "go", reason: "Go", final_offer_total: 1 }).select("id").single(), "Go")
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} S0 link` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} S0 link Stage`, sort_order: 10 }).select("id").single(), "stage")).id
})

afterAll(async () => {
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunity_items").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("refresh from the S0: matching in order", () => {
    it("links the line that already holds the S0 line's Odoo line id (rule 1), ahead of a same-product typed line", async () => {
        const { sorId, matrixId } = await newSor()
        const itemId = await s0Line(sorId, { product_name: "Fire hose", odoo_product_id: 8123, odoo_line_id: 5001 })
        const holder = await typedLine(matrixId, { tender_specification: "Hose, old S0 line", odoo_line_id: 5001 })
        const sameProduct = await typedLine(matrixId, { tender_specification: "Hose by product", odoo_product_id: 8123 })

        const { data, error } = await refresh("dealOwner", sorId)
        expect(error).toBeNull()
        expect(data).toBe(0)
        expect(await line(holder.id)).toMatchObject({ sor_item_id: itemId, odoo_line_id: 5001, source: "sor_line" })
        expect(await line(sameProduct.id)).toMatchObject({ sor_item_id: null, source: "typed" })
    })

    it("links an unlinked typed line with the same Odoo product (rule 2) and stores the SOR line and Odoo line id", async () => {
        const { sorId, matrixId } = await newSor()
        const itemId = await s0Line(sorId, { product_name: "Fire hose, 65 mm", odoo_product_id: 8124, odoo_line_id: 5002 })
        const typed = await typedLine(matrixId, { tender_specification: "Hose as the client wrote it", odoo_product_id: 8124 })

        const { data, error } = await refresh("dealOwner", sorId)
        expect(error).toBeNull()
        expect(data).toBe(0)
        const after = await line(typed.id)
        expect(after).toMatchObject({ sor_item_id: itemId, odoo_line_id: 5002, source: "sor_line", odoo_product_id: 8124 })
        expect(after.sor_line_snapshot).toMatchObject({ name: "Fire hose, 65 mm" })
        expect(await lines(matrixId)).toHaveLength(1)
    })

    it("adds a new row when nothing matches (rule 3), and a second refresh changes nothing", async () => {
        const { sorId, matrixId } = await newSor()
        const itemId = await s0Line(sorId, { product_name: "Gas detector", odoo_product_id: 9001, odoo_line_id: 5003 })
        await typedLine(matrixId, { tender_specification: "Something else", odoo_product_id: 9999 })

        expect((await refresh("dealOwner", sorId)).data).toBe(1)
        expect((await refresh("dealOwner", sorId)).data).toBe(0)
        const rows = await lines(matrixId)
        expect(rows).toHaveLength(2)
        expect(rows.find((r) => r.sor_item_id === itemId)).toMatchObject({ source: "sor_line", odoo_line_id: 5003 })
        expect(rows.find((r) => r.sor_item_id === null)).toMatchObject({ source: "typed" })
    })

    it("uses each typed line once: two S0 lines of one product take two typed lines, in order", async () => {
        const { sorId, matrixId } = await newSor()
        const first = await s0Line(sorId, { product_name: "Harness", odoo_product_id: 7001, odoo_line_id: 5004 })
        const second = await s0Line(sorId, { product_name: "Harness", odoo_product_id: 7001, odoo_line_id: 5005 })
        const a = await typedLine(matrixId, { odoo_product_id: 7001 })
        const b = await typedLine(matrixId, { odoo_product_id: 7001 })

        expect((await refresh("dealOwner", sorId)).data).toBe(0)
        expect((await line(a.id)).sor_item_id).toBe(first)
        expect((await line(b.id)).sor_item_id).toBe(second)
    })

    it("never links by name alone", async () => {
        const { sorId, matrixId } = await newSor()
        await s0Line(sorId, { product_name: "Rescue tripod", odoo_product_id: 7002, odoo_line_id: 5006 })
        const typed = await typedLine(matrixId, { tender_specification: "Rescue tripod" })

        expect((await refresh("dealOwner", sorId)).data).toBe(1)
        expect(await line(typed.id)).toMatchObject({ sor_item_id: null, odoo_line_id: null, source: "typed" })
    })

    it("keeps the linked line's Components, costs, compliance note and position", async () => {
        const { sorId, matrixId } = await newSor()
        await s0Line(sorId, { product_name: "Tripod", odoo_product_id: 7003, odoo_line_id: 5007 })
        const typed = await typedLine(matrixId, { odoo_product_id: 7003 })
        const compId = await addWork(typed.id)

        await refresh("dealOwner", sorId)
        const comps = await asSvc(svc().from("costing_components").select("*").eq("tender_line_id", typed.id), "Components")
        expect(comps.map((c) => c.id)).toEqual([compId])
        expect(comps[0].compliance_note).toBe("Meets spec")
        const cost = await asSvc(svc().from("costing_component_costs").select("*").eq("component_id", compId).single(), "cost")
        expect(Number(cost.acquire_unit)).toBe(50)
        expect((await line(typed.id)).position).toBe(typed.position)
        expect(Number((await line(typed.id)).quantity)).toBe(2)
    })

    it("is refused to someone with no part in the SOR", async () => {
        const { sorId } = await newSor()
        expect((await refresh("ordinary", sorId)).error?.code).toBe(RLS_VIOLATION)
    })
})

describe("suggestions for a similar name", () => {
    it("offers similar typed lines to Sales and Purchasing, and links nothing", async () => {
        const held = await newSor()
        const heldItem = await s0Line(held.sorId, { product_name: "Fire hose 65 mm", odoo_product_id: 7011, odoo_line_id: 5011 })
        const heldTyped = await typedLine(held.matrixId, { tender_specification: "Fire hose" })
        await typedLine(held.matrixId, { tender_specification: "Gas detector" })
        await goLock(held.matrixId)
        await refresh("dealOwner", held.sorId) // under a Go, no new row is added

        for (const who of ["dealOwner", "outsider"]) {
            const { data, error } = await suggestions(who, held.sorId)
            expect(error, who).toBeNull()
            expect(data.map((r) => [r.sor_item_id, r.tender_line_id]), who).toEqual([[heldItem, heldTyped.id]])
        }
        expect(await line(heldTyped.id)).toMatchObject({ sor_item_id: null, source: "typed" })
        expect((await suggestions("ordinary", held.sorId)).error?.code).toBe(RLS_VIOLATION)
    })
})

describe("Sales confirms a suggestion", () => {
    async function held() {
        const sor = await newSor()
        const itemId = await s0Line(sor.sorId, { product_name: "Fire hose 65 mm", odoo_product_id: 7020, odoo_line_id: 5020 })
        const typed = await typedLine(sor.matrixId, { tender_specification: "Fire hose" })
        await goLock(sor.matrixId)
        await refresh("dealOwner", sor.sorId)
        return { ...sor, itemId, typed }
    }

    it("stores the SOR line and Odoo line id, keeps the work, and works while Go-locked", async () => {
        const { matrixId, itemId, typed } = await held()
        const compId = await addWork(typed.id)
        const { error } = await link("dealOwner", typed.id, itemId)
        expect(error).toBeNull()
        expect(await line(typed.id)).toMatchObject({ sor_item_id: itemId, odoo_line_id: 5020, source: "sor_line", odoo_product_id: 7020, tender_specification: "Fire hose" })
        expect((await asSvc(svc().from("costing_components").select("id").eq("tender_line_id", typed.id), "Components")).map((c) => c.id)).toEqual([compId])
        expect(await lines(matrixId)).toHaveLength(1)
    })

    it("is refused to Purchasing and to an outsider", async () => {
        const { itemId, typed } = await held()
        expect((await link("outsider", typed.id, itemId)).error?.code).toBe(RLS_VIOLATION)
        expect((await link("ordinary", typed.id, itemId)).error?.code).toBe(RLS_VIOLATION)
        expect((await line(typed.id)).sor_item_id).toBeNull()
    })

    it("refuses a line already on the S0, an S0 line already linked, and an S0 line of another SOR", async () => {
        const { sorId, matrixId, itemId, typed } = await held()
        expect((await link("dealOwner", typed.id, itemId)).error).toBeNull()
        // The line is on the S0 now.
        expect((await link("dealOwner", typed.id, itemId)).error?.code).toBe(BAD_INPUT)
        // The S0 line is linked: a second typed line can't take it.
        const other = await typedLine(matrixId, { tender_specification: "Fire hose again" })
        expect((await link("dealOwner", other.id, itemId)).error?.code).toBe(BAD_INPUT)
        // An S0 line of another SOR.
        const elsewhere = await newSor()
        const foreign = await s0Line(elsewhere.sorId, { product_name: "Foreign", odoo_line_id: 5021 })
        expect((await link("dealOwner", other.id, foreign)).error?.code).toBe(BAD_INPUT)
        expect(sorId).toBeTruthy()
    })
})

describe("under a Go lock", () => {
    it("a refresh links by Odoo line id and by product, adds no new row, and leaves money alone", async () => {
        const { sorId, matrixId } = await newSor()
        const byId = await s0Line(sorId, { product_name: "Hose", odoo_product_id: 7030, odoo_line_id: 5030 })
        const byProduct = await s0Line(sorId, { product_name: "Detector", odoo_product_id: 7031, odoo_line_id: 5031 })
        await s0Line(sorId, { product_name: "Brand new", odoo_product_id: 7032, odoo_line_id: 5032 })
        const holder = await typedLine(matrixId, { odoo_line_id: 5030 })
        const product = await typedLine(matrixId, { odoo_product_id: 7031 })
        await goLock(matrixId)

        const { data, error } = await refresh("dealOwner", sorId)
        expect(error).toBeNull()
        expect(data).toBe(0)
        expect((await line(holder.id)).sor_item_id).toBe(byId)
        expect((await line(product.id)).sor_item_id).toBe(byProduct)
        expect(await lines(matrixId)).toHaveLength(2)
    })

    it("still refuses an ordinary edit of the locked line", async () => {
        const { matrixId } = await newSor()
        const typed = await typedLine(matrixId)
        await goLock(matrixId)
        const { error } = await (await clientFor("dealOwner")).from("costing_tender_lines").update({ tender_specification: "Changed" }).eq("id", typed.id)
        expect(error?.code).toBe(RLS_VIOLATION)
        expect((await line(typed.id)).tender_specification).toBe("Rescue tripod")
    })
})
