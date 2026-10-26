/**
 * Requested Items that name a Costing Matrix Component (#273, spec #266): one Component may
 * have several items; an item keeps its own copy of the Component; the matrix grid reads each
 * Component's items' statuses without the table's own read policy being widened.
 *
 * The cast, on one SOR (dealOwner and support are its Deal Team):
 *   outsider          Purchasing access, a purchasing member of the request -> adds
 *   dealOwner         Deal Team, a sales-side member of the request          -> refused
 *   stageParticipant  the request's Buyer, no Purchasing access              -> refused
 *   technical         open Stage Participant window, not a member            -> participant tier
 *   ipasSigner        on the final_acquire list                              -> closed_book tier
 *   ordinary          nobody                                                 -> no tier
 *
 * Matrices and Components are made with the service role (costing_open_matrix is not granted to
 * anyone else yet); every other assertion runs as a real cast member.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()
const CHECK_VIOLATION = "23514"

let saleTypeId, flowId, stageId
let sorId, otherSorId, requestId
let hose, bundle
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

/** A Requested Item naming a Component, made with the service role (the add-from-matrix RPC is gone; S0 lines make items by trigger). */
const seedFor = async (componentIds) => {
    const made = []
    for (const componentId of componentIds) {
        const c = await asSvc(svc().from("costing_components").select("name, unit, quantity, odoo_product_id").eq("id", componentId).single(), "component")
        const row = await asSvc(
            svc()
                .from("purchase_request_items")
                .insert({
                    request_id: requestId,
                    source: "component",
                    component_id: componentId,
                    name: c.name.trim(),
                    unit: c.unit,
                    quantity: c.quantity,
                    odoo_product_id: c.odoo_product_id,
                    requested_by: ids.outsider,
                })
                .select("id")
                .single(),
            "item",
        )
        made.push(row.id)
    }
    return made
}

const clearItems = async () => {
    await svc().from("purchase_request_messages").delete().eq("request_id", requestId)
    await svc().from("purchase_request_items").delete().eq("request_id", requestId)
}

async function makeComponent(lineId, position, fields) {
    return (
        await asSvc(
            svc().from("costing_components").insert({ tender_line_id: lineId, position, quantity: 1, ...fields }).select("id").single(),
            `Component ${fields.name}`,
        )
    ).id
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Request items` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (
        await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Request items Stage`, sort_order: 10 }).select("id").single(), "stage")
    ).id

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, supportSales1Id: ids.support, saleTypeId, flowStageId: stageId })
    otherSorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId, otherSorId)

    const visit = await asSvc(svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).single(), "visit")
    await asSvc(
        svc().from("sor_stage_participants").insert({
            opportunity_id: sorId,
            employee_id: ids.technical,
            source: "action",
            opened_visit_id: visit.id,
            until_rule: "stage_left",
        }),
        "participant window",
    )
    await asSvc(svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.ipasSigner }), "signer list")

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    const openedOther = await svc().rpc("costing_open_matrix", { p_opportunity_id: otherSorId })
    if (openedOther.error) throw new Error(`costing_open_matrix: ${openedOther.error.message}`)

    const makeLine = async (matrixId, position, spec) =>
        (
            await asSvc(
                svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position, tender_specification: spec, quantity: 1 }).select("id").single(),
                `Tender Line ${spec}`,
            )
        ).id
    const line1 = await makeLine(opened.data, 1, "Fire hose")
    const line2 = await makeLine(opened.data, 2, "Pumps")
    const otherLine = await makeLine(openedOther.data, 1, "Other")
    hose = await makeComponent(line1, 1, { name: "  Hose reel ", unit: "pc", quantity: 4, availability: "for_order", odoo_product_id: 101 })
    await makeComponent(line1, 2, { name: "Nozzle", unit: null, quantity: 2.5 })
    bundle = await makeComponent(line2, 1, { name: "Pump set", is_bundle: true, quantity: 1, unit: "set" })
    await makeComponent(otherLine, 1, { name: "Foreign part" })

    requestId = (
        await asSvc(
            svc().from("purchase_requests").insert({ opportunity_id: sorId, created_by: ids.dealOwner, buyer_id: ids.stageParticipant }).select("id").single(),
            "request",
        )
    ).id
    for (const [employee, side] of [
        ["dealOwner", "sales"],
        ["stageParticipant", "purchasing"],
        ["outsider", "purchasing"],
    ]) {
        await asSvc(svc().from("purchase_request_members").insert({ request_id: requestId, employee_id: ids[employee], side }), `member ${employee}`)
    }
})

afterAll(async () => {
    await clearItems()
    await svc().from("purchase_request_members").delete().eq("request_id", requestId)
    await svc().from("purchase_requests").delete().eq("id", requestId)
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("the item keeps its own copy", () => {
    it("is not rewritten when the Component is edited later, and survives the Component's removal", async () => {
        const [itemId] = await seedFor([hose])

        await asSvc(
            svc().from("costing_components").update({ name: "Hose reel, 30 m", quantity: 6, unit: "set", odoo_product_id: 999 }).eq("id", hose),
            "edit the Component",
        )
        const edited = await asSvc(svc().from("purchase_request_items").select("*").eq("id", itemId).single(), "item")
        expect(edited).toMatchObject({ name: "Hose reel", quantity: 4, unit: "pc", odoo_product_id: 101, component_id: hose })

        // #283: a Component an item names can't be removed until the item is unlinked; after that,
        // removing it leaves the item standing, no longer naming it.
        const lineId = (await asSvc(svc().from("costing_components").select("tender_line_id").eq("id", hose).single(), "line")).tender_line_id
        const extra = await makeComponent(lineId, 9, { name: "Spare" })
        const spare = await seedFor([extra])
        expect((await svc().from("costing_components").delete().eq("id", extra)).error?.code).toBe("22023")
        const unlinked = await (await clientFor("outsider")).rpc("purchase_request_item_detach_component", { p_item_id: spare[0] })
        expect(unlinked.error).toBeNull()
        await asSvc(svc().from("costing_components").delete().eq("id", extra), "remove the Component")
        const left = await asSvc(svc().from("purchase_request_items").select("*").eq("id", spare[0]).single(), "item")
        expect(left).toMatchObject({ name: "Spare", component_id: null, source: "component" })

        await asSvc(svc().from("costing_components").update({ name: "  Hose reel ", quantity: 4, unit: "pc", odoo_product_id: 101 }).eq("id", hose), "restore")
        await clearItems()
    })

    it("allows the new source and no other", async () => {
        const insert = (source) =>
            svc().from("purchase_request_items").insert({ request_id: requestId, source, name: "x", quantity: 1, requested_by: ids.outsider }).select("id")
        const bad = await insert("elsewhere")
        expect(bad.error.code).toBe(CHECK_VIOLATION)
        const ok = await insert("component")
        expect(ok.error).toBeNull()
        await clearItems()
    })
})

describe("what the Costing Matrix grid reads", () => {
    let first

    beforeAll(async () => {
        first = await seedFor([hose, hose, bundle])
        await asSvc(svc().from("purchase_request_items").update({ status: "purchased" }).eq("id", first[0]), "status")
    })

    afterAll(clearItems)

    const readRequests = async (who, opp = sorId) => {
        const { data, error } = await (await clientFor(who)).rpc("costing_component_requests", { p_opportunity_id: opp })
        if (error) throw new Error(`costing_component_requests as ${who}: ${error.message}`)
        return data
    }

    it.each([
        ["dealOwner", "price"],
        ["outsider", "cost"],
        ["technical", "participant"],
        ["ipasSigner", "closed_book"],
    ])("serves %s (the %s tier) each Component's items and their statuses, and nothing else", async (who) => {
        const rows = await readRequests(who)
        expect(rows).toHaveLength(3)
        expect(rows.map((r) => `${r.component_id} ${r.status}`).sort()).toEqual(
            [`${hose} not_checked`, `${hose} purchased`, `${bundle} not_checked`].sort(),
        )
        for (const row of rows) {
            expect(Object.keys(row).sort()).toEqual(["component_id", "id", "request_id", "status"])
            expect(row.request_id).toBe(requestId)
        }
    })

    it("serves nobody with no tier, and nothing for the other SOR's matrix", async () => {
        expect(await readRequests("ordinary")).toBeNull()
        expect(await readRequests("dealOwner", otherSorId)).toEqual([])
    })

    it("does not widen the items' own read policy: a Stage Participant who is not a member reads none of them", async () => {
        const { data, error } = await (await clientFor("technical")).from("purchase_request_items").select("id").eq("request_id", requestId)
        expect(error).toBeNull()
        expect(data).toEqual([])
    })

    it("labels each item with its Component's number for whoever can read the request", async () => {
        const read = async (who) => (await clientFor(who)).rpc("purchase_request_component_labels", { p_request_id: requestId })
        const { data, error } = await read("dealOwner")
        expect(error).toBeNull()
        expect(data.map((l) => `${l.number} ${l.name}`).sort()).toEqual(["1.1 Hose reel", "1.1 Hose reel", "2.1 Pump set"])
        expect(Object.keys(data[0]).sort()).toEqual(["component_id", "item_id", "name", "number"])
        // Not a member and no Purchasing access: nothing.
        expect((await read("technical")).data).toEqual([])
    })
})
