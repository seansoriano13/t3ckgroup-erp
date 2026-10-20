/**
 * The winning Offer fills the Costing Matrix (#278, spec #275): canvass_apply_winner and
 * costing_accept_brand, the "from Canvass" marks and the trigger that nulls them, and the new
 * registry rows.
 *
 * The cast, on one SOR (dealOwner and support are its Deal Team):
 *   outsider          Purchasing access                  -> cost tier, Purchasing band
 *   dealOwner         Deal Team                          -> price tier, Sales band
 *   stageParticipant  open Stage Participant window      -> participant tier, no band
 *   ordinary          nobody
 *
 * The matrix, Components, Canvasses and Offers are made with the service role; every call under
 * test runs as a real cast member, so the real band triggers judge the fill.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"
import { COMPONENT_BANDS, COMPONENT_CANVASS_COST_BANDS, COMPONENT_CANVASS_COST_TIERS } from "../../constants/costing.js"

const svc = () => serviceClient()
const RLS_DENIED = "42501"
const UNIQUE_VIOLATION = "23505"
const BAD_INPUT = "22023"
// #556: refusals from the database functions carry 22023 (invalid value / wrong state), never 55000.
const WRONG_STATE = "22023"

let saleTypeId, flowId, stageId
let sorId, matrixId, lineId
let compFill, compRepick, compRefuse, compBrand, compItem, compStale
let requestId, itemId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const makeComponent = async (position, extra = {}) =>
    (
        await asSvc(
            svc().from("costing_components").insert({ tender_line_id: lineId, position, name: `Component ${position}`, quantity: 1, ...extra }).select("id").single(),
            "Component",
        )
    ).id

const makeCanvass = async (componentId) =>
    (await asSvc(svc().from("sor_canvasses").insert({ component_id: componentId, created_by: ids.outsider }).select("*").single(), "Canvass"))

async function makeOffer(canvassId, extra = {}, price = { unit_price: 78000 }) {
    const offer = await asSvc(
        svc().from("sor_canvass_offers").insert({ canvass_id: canvassId, supplier_name: "Redleaf Inc.", ...extra }).select("*").single(),
        "Offer",
    )
    await asSvc(svc().from("sor_canvass_offer_prices").insert({ offer_id: offer.id, ...price }), "Offer price")
    return offer
}

const winner = async (who, canvassId, offerId) =>
    (await clientFor(who)).rpc("canvass_apply_winner", { p_canvass_id: canvassId, p_offer_id: offerId })

const component = async (id) => asSvc(svc().from("costing_components").select("*").eq("id", id).single(), "Component row")
const costs = async (id) => (await svc().from("costing_component_costs").select("*").eq("component_id", id).maybeSingle()).data

const brochure = (name) => [{ url: `https://files.test/${name}.pdf`, name: `${name}.pdf`, type: "application/pdf", bytes: 1200 }]

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Winner` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (
        await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Winner Stage`, sort_order: 10 }).select("id").single(), "stage")
    ).id

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, supportSales1Id: ids.support, saleTypeId, flowStageId: stageId })
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
    lineId = (
        await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Stretcher", quantity: 1 }).select("id").single(), "Tender Line")
    ).id
    compFill = await makeComponent(1, { brand: "Generic" })
    compRepick = await makeComponent(2)
    compRefuse = await makeComponent(3)
    compBrand = await makeComponent(4, { brand: "Generic" })
    compItem = await makeComponent(5)
    compStale = await makeComponent(6)

    requestId = (
        await asSvc(svc().from("purchase_requests").insert({ opportunity_id: sorId, created_by: ids.dealOwner }).select("id").single(), "request")
    ).id
    itemId = (
        await asSvc(
            svc().from("purchase_request_items").insert({ request_id: requestId, name: "Spine board", quantity: 1, source: "new", requested_by: ids.dealOwner }).select("id").single(),
            "Requested Item",
        )
    ).id
})

afterAll(async () => {
    await svc().from("sor_canvasses").delete().in("component_id", [compFill, compRepick, compRefuse, compBrand, compItem, compStale].filter(Boolean))
    await svc().from("sor_canvasses").delete().eq("requested_item_id", itemId ?? "00000000-0000-0000-0000-000000000000")
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

describe("marking a winner", () => {
    let canvass, usd, php

    beforeAll(async () => {
        canvass = await makeCanvass(compFill)
        php = await makeOffer(canvass.id, { brand: "Redleaf", description: "Folding stretcher, 227 kg", brochure: brochure("redleaf") })
        usd = await makeOffer(
            canvass.id,
            { supplier_name: "Hong Kong", brand: "Redleaf", description: "Folding stretcher, straps separate", currency: "USD", brochure: brochure("hk") },
            { unit_price: 1280, comparison_rate: 56.5625 },
        )
        // A live "Evaluation approved" that a changed Offer Specification must clear.
        await asSvc(svc().from("costing_signoffs").insert({ matrix_id: matrixId, role: "evaluation_approved", signed_by: ids.superAdmin }), "sign-off")
    })

    it("fills Acquire at price x rate, the Offer Specification and the brochure citation, as a purchaser", async () => {
        const { data, error } = await winner("outsider", canvass.id, usd.id)
        expect(error).toBeNull()
        expect(data.filled).toEqual({ acquire: true, offer_specification: true, documents: true })

        expect(await costs(compFill)).toMatchObject({ acquire_unit: 72400, acquire_from_offer_id: usd.id })
        expect(await component(compFill)).toMatchObject({
            offer_specification: "Folding stretcher, straps separate",
            offer_specification_from_offer_id: usd.id,
            documents: [{ ...brochure("hk")[0], offer_id: usd.id }],
        })
    })

    it("clears 'Evaluation approved' through the existing trigger", async () => {
        const rows = await asSvc(svc().from("costing_signoffs").select("cleared_at, cleared_reason").eq("matrix_id", matrixId).eq("role", "evaluation_approved"), "sign-offs")
        expect(rows).toHaveLength(1)
        expect(rows[0].cleared_at).not.toBeNull()
        expect(rows[0].cleared_reason).toBe("An Offer Specification changed")
    })

    it("leaves one winner when a second is picked, and refills what is still marked", async () => {
        const { error } = await winner("outsider", canvass.id, php.id)
        expect(error).toBeNull()
        const offers = await asSvc(svc().from("sor_canvass_offers").select("id, is_winner").eq("canvass_id", canvass.id), "Offers")
        expect(offers.filter((o) => o.is_winner).map((o) => o.id)).toEqual([php.id])
        expect(await costs(compFill)).toMatchObject({ acquire_unit: 78000, acquire_from_offer_id: php.id })
        expect((await component(compFill)).documents).toEqual([{ ...brochure("redleaf")[0], offer_id: php.id }])
    })

    it("refuses a second winner written directly", async () => {
        const { error } = await svc().from("sor_canvass_offers").update({ is_winner: true }).eq("id", usd.id)
        expect(error.code).toBe(UNIQUE_VIOLATION)
    })

    it("works for a Super Admin too", async () => {
        const { error } = await winner("superAdmin", canvass.id, usd.id)
        expect(error).toBeNull()
    })
})

describe("a hand edit takes the mark off", () => {
    let canvass, first, second

    beforeAll(async () => {
        canvass = await makeCanvass(compRepick)
        first = await makeOffer(canvass.id, { description: "First spec" }, { unit_price: 1000 })
        second = await makeOffer(canvass.id, { supplier_name: "Ferno", description: "Second spec" }, { unit_price: 1200 })
    })

    it("nulls the Acquire mark when Acquire is typed, and the Offer Specification mark when that is", async () => {
        expect((await winner("outsider", canvass.id, first.id)).error).toBeNull()
        expect(await costs(compRepick)).toMatchObject({ acquire_from_offer_id: first.id })

        const typed = await (await clientFor("outsider")).rpc("costing_set_money", {
            p_table: "costing_component_costs",
            p_row: compRepick,
            p_patch: { acquire_unit: 950 },
        })
        expect(typed.error).toBeNull()
        expect(await costs(compRepick)).toMatchObject({ acquire_unit: 950, acquire_from_offer_id: null })
        expect(await component(compRepick)).toMatchObject({ offer_specification_from_offer_id: first.id })
    })

    it("on a re-pick leaves the typed Acquire alone and refills the Offer Specification", async () => {
        const { data, error } = await winner("outsider", canvass.id, second.id)
        expect(error).toBeNull()
        expect(data.filled).toMatchObject({ acquire: false, offer_specification: true })
        expect(await costs(compRepick)).toMatchObject({ acquire_unit: 950, acquire_from_offer_id: null })
        expect(await component(compRepick)).toMatchObject({ offer_specification: "Second spec", offer_specification_from_offer_id: second.id })
    })

    it("nulls the Offer Specification mark when the specification is typed", async () => {
        const { error } = await (await clientFor("outsider")).from("costing_components").update({ offer_specification: "Typed by Purchasing" }).eq("id", compRepick)
        expect(error).toBeNull()
        expect(await component(compRepick)).toMatchObject({ offer_specification: "Typed by Purchasing", offer_specification_from_offer_id: null })
    })
})

describe("a re-pick drops a mark the new winner cannot back", () => {
    let canvass, priced, bare

    beforeAll(async () => {
        canvass = await makeCanvass(compStale)
        priced = await makeOffer(canvass.id, { description: "Priced spec" }, { unit_price: 2000 })
        bare = await makeOffer(canvass.id, { supplier_name: "Quote pending", description: "  " }, { unit_price: null })
    })

    it("keeps the Acquire and Offer Specification values but clears their marks", async () => {
        expect((await winner("outsider", canvass.id, priced.id)).error).toBeNull()
        expect(await costs(compStale)).toMatchObject({ acquire_unit: 2000, acquire_from_offer_id: priced.id })
        expect(await component(compStale)).toMatchObject({ offer_specification: "Priced spec", offer_specification_from_offer_id: priced.id })

        const { data, error } = await winner("outsider", canvass.id, bare.id)
        expect(error).toBeNull()
        expect(data.filled).toMatchObject({ acquire: false, offer_specification: false })
        expect(await costs(compStale)).toMatchObject({ acquire_unit: 2000, acquire_from_offer_id: null })
        expect(await component(compStale)).toMatchObject({ offer_specification: "Priced spec", offer_specification_from_offer_id: null })
    })
})

describe("refusals", () => {
    let canvass, noRate, ok

    beforeAll(async () => {
        canvass = await makeCanvass(compRefuse)
        noRate = await makeOffer(canvass.id, { supplier_name: "Tokyo", currency: "JPY" }, { unit_price: 9000 })
        ok = await makeOffer(canvass.id, { description: "A spec" }, { unit_price: 500 })
    })

    it("refuses a foreign Offer with no comparison rate, and fills nothing", async () => {
        const { error } = await winner("outsider", canvass.id, noRate.id)
        expect(error.code).toBe(BAD_INPUT)
        expect(await costs(compRefuse)).toBeNull()
        const offers = await asSvc(svc().from("sor_canvass_offers").select("is_winner").eq("canvass_id", canvass.id), "Offers")
        expect(offers.some((o) => o.is_winner)).toBe(false)
    })

    it("refuses anyone who is not Purchasing or a Super Admin", async () => {
        for (const who of ["dealOwner", "stageParticipant", "ordinary", "head"]) {
            const { error } = await winner(who, canvass.id, ok.id)
            expect(error?.code, who).toBe(RLS_DENIED)
        }
        expect(await costs(compRefuse)).toBeNull()
    })

    it("refuses an Offer that is on another Canvass", async () => {
        const other = await makeCanvass(compItem)
        const { error } = await winner("outsider", other.id, ok.id)
        expect(error.code).toBe("P0002")
        await svc().from("sor_canvasses").delete().eq("id", other.id)
    })

    it("fills nothing from a Canvass on a Requested Item", async () => {
        const itemCanvass = await asSvc(svc().from("sor_canvasses").insert({ requested_item_id: itemId, created_by: ids.outsider }).select("id").single(), "item Canvass")
        const offer = await makeOffer(itemCanvass.id, { description: "Spine board, adult" }, { unit_price: 3000 })
        const { data, error } = await winner("outsider", itemCanvass.id, offer.id)
        expect(error).toBeNull()
        expect(data.filled).toEqual({ acquire: false, offer_specification: false, documents: false })
        const [{ is_winner }] = await asSvc(svc().from("sor_canvass_offers").select("is_winner").eq("id", offer.id), "Offer")
        expect(is_winner).toBe(true)
        await svc().from("sor_canvasses").delete().eq("id", itemCanvass.id)
    })
})

describe("accepting a brand", () => {
    let canvass

    beforeAll(async () => {
        canvass = await makeCanvass(compBrand)
        await makeOffer(canvass.id, { brand: null }, { unit_price: 1 })
    })

    const accept = async (who) => (await clientFor(who)).rpc("costing_accept_brand", { p_component_id: compBrand })

    it("is refused when the Canvass has no winning brand", async () => {
        const { error } = await accept("dealOwner")
        expect(error.code).toBe(WRONG_STATE)
    })

    it("is refused to Purchasing and allowed to the Deal Team", async () => {
        const toxic = await makeOffer(canvass.id, { supplier_name: "Toyota Dealer", brand: "Toyota" }, { unit_price: 2 })
        expect((await winner("outsider", canvass.id, toxic.id)).error).toBeNull()
        // The fill never touches Brand.
        expect((await component(compBrand)).brand).toBe("Generic")

        const refused = await accept("outsider")
        expect(refused.error.code).toBe(RLS_DENIED)
        expect((await component(compBrand)).brand).toBe("Generic")

        const allowed = await accept("dealOwner")
        expect(allowed.error).toBeNull()
        expect(allowed.data).toEqual({ brand: "Toyota" })
        expect((await component(compBrand)).brand).toBe("Toyota")
    })

    it("is refused to a Stage Participant and to someone with no part in the SOR", async () => {
        for (const who of ["stageParticipant", "ordinary"]) {
            expect((await accept(who)).error?.code, who).toBe(RLS_DENIED)
        }
    })
})

describe("the registry", () => {
    it("holds the new columns as the screen's constants mirror them", async () => {
        const tiers = await asSvc(
            svc().from("costing_column_tiers").select("table_name, column_name, tiers").in("table_name", ["costing_components", "costing_component_costs"]).in("column_name", ["offer_specification_from_offer_id", "documents", "acquire_from_offer_id"]),
            "tiers",
        )
        const bands = await asSvc(
            svc().from("costing_column_bands").select("table_name, column_name, bands").in("table_name", ["costing_components", "costing_component_costs"]).in("column_name", ["offer_specification_from_offer_id", "documents", "acquire_from_offer_id"]),
            "bands",
        )
        const tiersOf = (table, column) => [...(tiers.find((t) => t.table_name === table && t.column_name === column)?.tiers ?? [])].sort()
        const bandsOf = (table, column) => [...(bands.find((b) => b.table_name === table && b.column_name === column)?.bands ?? [])].sort()

        for (const column of ["offer_specification_from_offer_id", "documents"]) {
            expect(tiersOf("costing_components", column), column).toEqual(["closed_book", "cost", "participant", "price"])
            expect(bandsOf("costing_components", column), column).toEqual([...COMPONENT_BANDS[column]].sort())
        }
        for (const [column, expected] of Object.entries(COMPONENT_CANVASS_COST_TIERS)) {
            expect(tiersOf("costing_component_costs", column), column).toEqual([...expected].sort())
        }
        for (const [column, expected] of Object.entries(COMPONENT_CANVASS_COST_BANDS)) {
            expect(bandsOf("costing_component_costs", column), column).toEqual([...expected].sort())
        }
    })
})
