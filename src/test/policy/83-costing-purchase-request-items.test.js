/**
 * Requested Items from the Costing Matrix (#273, spec #266): Purchasing access, and only that,
 * adds an item per Component; a Component of another SOR's matrix is refused; one Component may
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
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()
const CHECK_VIOLATION = "23514"

let saleTypeId, flowId, stageId
let sorId, otherSorId, requestId
let hose, nozzle, bundle, foreign
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const addFrom = async (who, componentIds, request = requestId) =>
    (await clientFor(who)).rpc("purchase_request_add_items_from_components", { p_request_id: request, p_component_ids: componentIds })

const itemsOf = async (request = requestId) =>
    asSvc(svc().from("purchase_request_items").select("*").eq("request_id", request).order("created_at"), "items")

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
    nozzle = await makeComponent(line1, 2, { name: "Nozzle", unit: null, quantity: 2.5 })
    bundle = await makeComponent(line2, 1, { name: "Pump set", is_bundle: true, quantity: 1, unit: "set" })
    foreign = await makeComponent(otherLine, 1, { name: "Foreign part" })

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

describe("adding from the Costing Matrix: who", () => {
    it("lets Purchasing access add, copying the Component and naming it", async () => {
        const { data, error } = await addFrom("outsider", [hose, nozzle])
        expect(error).toBeNull()
        expect(data).toHaveLength(2)

        const items = await itemsOf()
        expect(items).toHaveLength(2)
        const byComponent = Object.fromEntries(items.map((i) => [i.component_id, i]))
        expect(byComponent[hose]).toMatchObject({
            request_id: requestId,
            source: "component",
            odoo_product_id: 101,
            name: "Hose reel",
            unit: "pc",
            quantity: 4,
            status: "requested",
            requested_by: ids.outsider,
            sor_line_snapshot: null,
        })
        expect(byComponent[nozzle]).toMatchObject({ name: "Nozzle", unit: null, quantity: 2.5, odoo_product_id: null })

        // Each is posted in the request, in words that say where it came from.
        const messages = await asSvc(
            svc().from("purchase_request_messages").select("content, metadata").eq("request_id", requestId).eq("metadata->>event", "item_added"),
            "messages",
        )
        expect(messages.map((m) => m.content).sort()).toEqual([
            "Requested Hose reel × 4 pc, from the Costing Matrix.",
            "Requested Nozzle × 2.5, from the Costing Matrix.",
        ])
        expect(messages[0].metadata.source).toBe("component")
        await clearItems()
    })

    it("refuses a sales-side member", async () => {
        const { data, error } = await addFrom("dealOwner", [hose])
        expect(data).toBeNull()
        expect(error.code).toBe("42501")
        expect(error.message).toMatch(/Purchasing access/)
        expect(await itemsOf()).toEqual([])
    })

    it("refuses the request's Buyer when they have no Purchasing access", async () => {
        const { error } = await addFrom("stageParticipant", [hose])
        expect(error.code).toBe("42501")
        expect(await itemsOf()).toEqual([])
    })

    it("refuses someone with no part in it, and an anonymous caller", async () => {
        expect((await addFrom("ordinary", [hose])).error.code).toBe("42501")
        const anon = await anonymousClient()
        const { error } = await anon.rpc("purchase_request_add_items_from_components", { p_request_id: requestId, p_component_ids: [hose] })
        expect(error).not.toBeNull()
        expect(await itemsOf()).toEqual([])
    })
})

describe("adding from the Costing Matrix: which Components", () => {
    it("refuses a Component on another SOR's matrix, and adds none of the others with it", async () => {
        const { data, error } = await addFrom("outsider", [hose, foreign])
        expect(data).toBeNull()
        expect(error.code).toBe("P0002")
        expect(error.message).toMatch(/not on this SOR's Costing Matrix/)
        expect(await itemsOf()).toEqual([])
    })

    it("refuses a Component that does not exist, a request that does not exist, and an empty pick", async () => {
        const none = "00000000-0000-0000-0000-000000000000"
        expect((await addFrom("outsider", [none])).error.code).toBe("P0002")
        expect((await addFrom("outsider", [hose], none)).error.code).toBe("P0002")
        expect((await addFrom("outsider", [])).error.code).toBe("22023")
        expect(await itemsOf()).toEqual([])
    })

    it("allows a second Requested Item on the same Component, and several in one call", async () => {
        expect((await addFrom("outsider", [hose])).error).toBeNull()
        expect((await addFrom("outsider", [hose, hose])).error).toBeNull()
        const items = await itemsOf()
        expect(items.filter((i) => i.component_id === hose)).toHaveLength(3)
        await clearItems()
    })

    it("requests a bundle as one item, and refuses a Component with no name", async () => {
        expect((await addFrom("outsider", [bundle])).error).toBeNull()
        const [item] = await itemsOf()
        expect(item).toMatchObject({ component_id: bundle, name: "Pump set", unit: "set" })
        await clearItems()

        await asSvc(svc().from("costing_components").update({ name: "" }).eq("id", nozzle), "blank the name")
        const { error } = await addFrom("outsider", [nozzle])
        expect(error.code).toBe("22023")
        await asSvc(svc().from("costing_components").update({ name: "Nozzle" }).eq("id", nozzle), "restore the name")
    })
})

describe("the item keeps its own copy", () => {
    it("is not rewritten when the Component is edited later, and survives the Component's removal", async () => {
        const { data } = await addFrom("outsider", [hose])
        const [itemId] = data

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
        const { data: spare } = await addFrom("outsider", [extra])
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
        first = (await addFrom("outsider", [hose, hose, bundle])).data
        await asSvc(svc().from("purchase_request_items").update({ status: "ordered" }).eq("id", first[0]), "status")
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
            [`${hose} ordered`, `${hose} requested`, `${bundle} requested`].sort(),
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
