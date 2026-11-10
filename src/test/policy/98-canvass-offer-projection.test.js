/**
 * Offer Projection (#321): canvass_offer_projection. Per Offer, the Acquire in PHP and the Markup
 * Price per unit if it won, served only to the Closed Book and Purchasing tiers, and never writing.
 * Since 20261102170000 the Deal Team and Purchasing read the Closed Book.
 *
 * The cast, on one SOR (dealOwner is its Deal Team):
 *   outsider          Purchasing access                  -> closed_book tier
 *   superAdmin        Super Admin                        -> closed_book tier
 *   dealOwner         Deal Team                          -> closed_book tier
 *   stageParticipant  open Stage Participant window      -> participant tier
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { coverSlots } from "./support/canvassSlots.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId
let sorId, matrixId, lineId
let compId, canvassId, phpOffer, usdOffer, noRateOffer, noPriceOffer
let itemCanvassId, requestId, itemId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

async function makeOffer(canvass, extra, price) {
    const offer = await asSvc(
        svc().from("sor_canvass_offers").insert({ canvass_id: canvass, supplier_name: "Redleaf Inc.", ...extra }).select("*").single(),
        "Offer",
    )
    await asSvc(svc().from("sor_canvass_offer_prices").insert({ offer_id: offer.id, ...price }), "Offer price")
    return offer
}

const project = async (who, canvass = canvassId) => (await clientFor(who)).rpc("canvass_offer_projection", { p_canvass_id: canvass })
const byOffer = (rows, offer) => rows.find((r) => r.offer_id === offer.id)

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Projection` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (
        await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Projection Stage`, sort_order: 10 }).select("id").single(), "stage")
    ).id

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)

    const visit = await asSvc(svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).single(), "visit")
    await asSvc(
        svc().from("sor_stage_participants").insert({
            opportunity_id: sorId,
            employee_id: ids.stageParticipant,
            source: "action",
            opened_visit_id: visit.id,
            until_rule: "stage_left",
        }),
        "participant window",
    )

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data
    await asSvc(svc().from("costing_matrix_money").update({ default_factor: 1.25 }).eq("matrix_id", matrixId), "default factor")
    lineId = (
        await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Stretcher", quantity: 2 }).select("id").single(), "Tender Line")
    ).id
    compId = (
        await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 1, name: "Stretcher", quantity: 2 }).select("id").single(), "Component")
    ).id

    canvassId = (await asSvc(svc().from("sor_canvasses").insert({ component_id: compId, created_by: ids.outsider }).select("id").single(), "Canvass")).id
    phpOffer = await makeOffer(canvassId, {}, { unit_price: 78000 })
    usdOffer = await makeOffer(canvassId, { currency: "USD" }, { unit_price: 1280, comparison_rate: 56.5625 })
    noRateOffer = await makeOffer(canvassId, { currency: "EUR" }, { unit_price: 900 })
    noPriceOffer = await makeOffer(canvassId, {}, {})

    requestId = (
        await asSvc(svc().from("purchase_requests").insert({ opportunity_id: sorId, created_by: ids.dealOwner }).select("id").single(), "request")
    ).id
    itemId = (
        await asSvc(
            svc().from("purchase_request_items").insert({ request_id: requestId, name: "Spine board", quantity: 1, source: "new", requested_by: ids.dealOwner }).select("id").single(),
            "Requested Item",
        )
    ).id
    itemCanvassId = (await asSvc(svc().from("sor_canvasses").insert({ requested_item_id: itemId, created_by: ids.outsider }).select("id").single(), "Item Canvass")).id
    await makeOffer(itemCanvassId, {}, { unit_price: 500 })
})

afterAll(async () => {
    await svc().from("sor_canvasses").delete().in("id", [canvassId, itemCanvassId].filter(Boolean))
    await svc().from("purchase_request_items").delete().eq("request_id", requestId)
    await svc().from("purchase_requests").delete().eq("id", requestId)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("what each tier is served", () => {
    it("gives Purchasing the Acquire and the Markup Price, at the matrix default factor", async () => {
        const { data, error } = await project("outsider")
        expect(error).toBeNull()
        expect(data).toHaveLength(4)
        expect(Number(byOffer(data, phpOffer).acquire_unit)).toBe(78000)
        expect(Number(byOffer(data, phpOffer).markup_price_unit)).toBe(97500)
    })

    it("never carries the factor itself to Purchasing", async () => {
        const { data } = await project("outsider")
        expect(JSON.stringify(data)).not.toMatch(/factor/)
    })

    it("gives the Closed Book the same figures", async () => {
        const { data, error } = await project("superAdmin")
        expect(error).toBeNull()
        expect(Number(byOffer(data, phpOffer).markup_price_unit)).toBe(97500)
    })

    it("converts a foreign Offer at its comparison rate, to the centavo", async () => {
        const { data } = await project("outsider")
        // 1280 x 56.5625 = 72400.00; x 1.25 = 90500.00
        expect(Number(byOffer(data, usdOffer).acquire_unit)).toBe(72400)
        expect(Number(byOffer(data, usdOffer).markup_price_unit)).toBe(90500)
    })

    it("shows no figure, rather than a wrong one, for a foreign Offer with no rate", async () => {
        const { data } = await project("outsider")
        expect(byOffer(data, noRateOffer).acquire_unit).toBeNull()
        expect(byOffer(data, noRateOffer).markup_price_unit).toBeNull()
    })

    it("shows no figure for an Offer with no price", async () => {
        const { data } = await project("outsider")
        expect(byOffer(data, noPriceOffer).acquire_unit).toBeNull()
    })

    it("uses the Component's own factor when it has one", async () => {
        await asSvc(svc().from("costing_component_costs").upsert({ component_id: compId, markup_factor: 1.5 }), "own factor")
        const { data } = await project("outsider")
        expect(Number(byOffer(data, phpOffer).markup_price_unit)).toBe(117000)
        await asSvc(svc().from("costing_component_costs").update({ markup_factor: null }).eq("component_id", compId), "clear factor")
    })

    it("gives the Deal Team the projection, as it reads the Closed Book", async () => {
        const { data, error } = await project("dealOwner")
        expect(error).toBeNull()
        expect(Number(byOffer(data, usdOffer).acquire_unit)).toBe(72400)
    })

    it.each([
        ["a Stage Participant", "stageParticipant"],
        ["an ordinary employee", "ordinary"],
    ])("gives %s nothing", async (_label, who) => {
        const { data, error } = await project(who)
        expect(error).toBeNull()
        expect(data).toBeNull()
    })
})

describe("where there is nothing to project", () => {
    it("gives null for a Canvass on a bare Requested Item, even to the Closed Book", async () => {
        const { data, error } = await project("superAdmin", itemCanvassId)
        expect(error).toBeNull()
        expect(data).toBeNull()
    })

    it("gives null for a Canvass that does not exist", async () => {
        const { data, error } = await project("superAdmin", "00000000-0000-0000-0000-000000000000")
        expect(error).toBeNull()
        expect(data).toBeNull()
    })
})

describe("agreeing with the winner", () => {
    // canvass_apply_winner writes the Acquire a winning Offer fills; the projection must show that same figure.
    it.each([
        ["a PHP offer", {}, { unit_price: 78000.5 }],
        ["a foreign offer, rounded to the centavo", { currency: "USD" }, { unit_price: 1280.33, comparison_rate: 56.5625 }],
    ])("shows the Acquire %s then fills when it wins", async (_label, extra, price) => {
        const comp = (
            await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 9, name: "Parity", quantity: 1 }).select("id").single(), "Component")
        ).id
        const canvass = (await asSvc(svc().from("sor_canvasses").insert({ component_id: comp, created_by: ids.outsider }).select("id").single(), "Canvass")).id
        const offer = await makeOffer(canvass, extra, price)

        const projected = byOffer((await project("outsider", canvass)).data, offer).acquire_unit
        await coverSlots(canvass)
        const won = await (await clientFor("outsider")).rpc("canvass_apply_winner", { p_canvass_id: canvass, p_offer_id: offer.id })
        expect(won.error).toBeNull()
        const filled = (await svc().from("costing_component_costs").select("acquire_unit").eq("component_id", comp).single()).data.acquire_unit

        expect(Number(projected)).toBe(Number(filled))
        await svc().from("sor_canvasses").delete().eq("id", canvass)
    })
})

describe("writing nothing", () => {
    it("leaves the Component's cost row untouched", async () => {
        const before = await svc().from("costing_component_costs").select("*").eq("component_id", compId).maybeSingle()
        await project("outsider")
        await project("superAdmin")
        const after = await svc().from("costing_component_costs").select("*").eq("component_id", compId).maybeSingle()
        expect(after.data).toEqual(before.data)
    })
})
