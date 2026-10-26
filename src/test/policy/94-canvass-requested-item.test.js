/**
 * Canvass on a Requested Item (#280, spec #275): a Canvass may hang off a Requested Item only
 * while the item names no Component, a non-member of the request reads nothing, and a member
 * reads the Canvass and its Offers but sees prices only with Purchasing access, Finance access
 * or Super Admin.
 *
 * The cast, on one request (made with the service role):
 *   dealOwner  sales member, no purchasing or finance flow   -> reads Offers, refused prices
 *   outsider   purchasing member with Purchasing access      -> reads prices
 *   finance    member with Finance access                    -> reads prices
 *   superAdmin                                               -> reads prices
 *   ordinary   not a member                                  -> reads nothing
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { canRead } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()
const CHECK_VIOLATION = "23514"
const MIGRATION = readFileSync("supabase/migrations/20261019140000_canvass_requested_item_subject.sql", "utf8")

let saleTypeId, flowId, stageId, sorId, componentId
let requestId, plainItemId, componentItemId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Canvass item` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (
        await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Canvass item Stage`, sort_order: 10 }).select("id").single(), "stage")
    ).id
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    const lineId = (
        await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: opened.data, position: 1, tender_specification: "Stretcher", quantity: 1 }).select("id").single(), "Tender Line")
    ).id
    componentId = (
        await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 1, name: "Component 1", quantity: 1 }).select("id").single(), "Component")
    ).id

    requestId = (await asSvc(svc().from("purchase_requests").insert({ opportunity_id: sorId, created_by: ids.dealOwner }).select("id").single(), "request")).id
    const members = [
        [ids.dealOwner, "sales"],
        [ids.outsider, "purchasing"],
        [ids.finance, "other"],
    ]
    for (const [employee_id, side] of members) {
        await asSvc(svc().from("purchase_request_members").upsert({ request_id: requestId, employee_id, side }, { onConflict: "request_id,employee_id" }), "member")
    }
    plainItemId = (
        await asSvc(svc().from("purchase_request_items").insert({ request_id: requestId, name: "Printer paper", quantity: 5, source: "new", requested_by: ids.dealOwner }).select("id").single(), "plain item")
    ).id
    componentItemId = (
        await asSvc(
            svc().from("purchase_request_items").insert({ request_id: requestId, name: "Component 1", quantity: 1, source: "component", component_id: componentId, requested_by: ids.dealOwner }).select("id").single(),
            "component item",
        )
    ).id
})

afterAll(async () => {
    await svc().from("sor_canvasses").delete().in("requested_item_id", [plainItemId, componentItemId].filter(Boolean))
    await svc().from("sor_canvasses").delete().eq("component_id", componentId ?? "00000000-0000-0000-0000-000000000000")
    await svc().from("purchase_request_items").delete().eq("request_id", requestId)
    await svc().from("purchase_request_members").delete().eq("request_id", requestId)
    await svc().from("purchase_requests").delete().eq("id", requestId)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("the subject", () => {
    it("takes a Canvass on an item that names no Component", async () => {
        const { data, error } = await svc().from("sor_canvasses").insert({ requested_item_id: plainItemId }).select("id").single()
        expect(error).toBeNull()
        expect(data.id).toBeTruthy()
    })

    it("refuses a Canvass on an item that names a Component", async () => {
        const { error } = await svc().from("sor_canvasses").insert({ requested_item_id: componentItemId })
        expect(error?.code).toBe(CHECK_VIOLATION)
        expect(error?.message).toMatch(/names a Component/)
    })

    it("refuses re-pointing a Canvass at an item that names a Component", async () => {
        const made = await asSvc(svc().from("sor_canvasses").insert({ component_id: componentId }).select("id").single(), "Component Canvass")
        const { error } = await svc().from("sor_canvasses").update({ component_id: null, requested_item_id: componentItemId }).eq("id", made.id)
        expect(error?.code).toBe(CHECK_VIOLATION)
        await svc().from("sor_canvasses").delete().eq("id", made.id)
    })

    it("is installed as a trigger on the Canvass table", () => {
        expect(MIGRATION).toMatch(/create trigger trg_sor_canvasses_refuse_component_item/)
    })
})

describe("the Canvassing status", () => {
    const statusOf = async (id) => (await asSvc(svc().from("purchase_request_items").select("status").eq("id", id).single(), "item")).status
    const makeItem = async (extra) =>
        (
            await asSvc(
                svc().from("purchase_request_items").insert({ request_id: requestId, name: "Status item", quantity: 1, source: "new", requested_by: ids.dealOwner, ...extra }).select("id").single(),
                "status item",
            )
        ).id

    it("moves a To order item to Canvassing when a Canvass opens on it", async () => {
        const item = await makeItem({ status: "to_purchase" })
        await asSvc(svc().from("sor_canvasses").insert({ requested_item_id: item, created_by: ids.outsider }), "Canvass")
        expect(await statusOf(item)).toBe("still_canvassing")
        const events = await asSvc(svc().from("purchase_request_messages").select("metadata").eq("request_id", requestId), "events")
        expect(events.some((e) => e.metadata?.event === "item_status_changed" && e.metadata?.item_id === item && e.metadata?.to === "still_canvassing")).toBe(true)
    })

    it("moves each To order item that names the Component when a Component Canvass opens", async () => {
        const [first, second, closed] = [
            await makeItem({ status: "to_purchase", source: "component", component_id: componentId }),
            await makeItem({ status: "to_purchase", source: "component", component_id: componentId }),
            await makeItem({ status: "purchased", source: "component", component_id: componentId }),
        ]
        await asSvc(svc().from("sor_canvasses").insert({ component_id: componentId, created_by: ids.outsider }), "Component Canvass")
        expect(await statusOf(first)).toBe("still_canvassing")
        expect(await statusOf(second)).toBe("still_canvassing")
        expect(await statusOf(closed)).toBe("purchased")
    })

    it("leaves an item at any other status alone", async () => {
        for (const status of ["purchased", "received", "cancelled"]) {
            const item = await makeItem({ status })
            await asSvc(svc().from("sor_canvasses").insert({ requested_item_id: item, created_by: ids.outsider }), "Canvass")
            expect(await statusOf(item), status).toBe(status)
        }
    })
})

describe("who reads a Canvass on a Requested Item", () => {
    let canvassId, offerId

    beforeAll(async () => {
        const canvass = await asSvc(svc().from("sor_canvasses").select("id").eq("requested_item_id", plainItemId).single(), "Canvass")
        canvassId = canvass.id
        offerId = (await asSvc(svc().from("sor_canvass_offers").insert({ canvass_id: canvassId, supplier_name: "Paper Co" }).select("id").single(), "Offer")).id
        await asSvc(svc().from("sor_canvass_offer_prices").insert({ offer_id: offerId, unit_price: 250 }), "Offer price")
    })

    it("shows every member the Canvass and its Offers", async () => {
        for (const who of ["dealOwner", "outsider", "finance", "superAdmin"]) {
            const client = await clientFor(who)
            expect(await canRead(client, "sor_canvasses", canvassId), `${who} Canvass`).toBe(true)
            expect(await canRead(client, "sor_canvass_offers", offerId), `${who} Offer`).toBe(true)
        }
    })

    it("shows prices to Purchasing access, Finance access and a Super Admin", async () => {
        for (const who of ["outsider", "finance", "superAdmin"]) {
            const client = await clientFor(who)
            const { data } = await client.from("sor_canvass_offer_prices").select("unit_price").eq("offer_id", offerId)
            expect(data, `${who} price`).toEqual([{ unit_price: 250 }])
            const money = await client.rpc("canvass_subject_can_read_money", { p_component_id: null, p_requested_item_id: plainItemId })
            expect(money.data, `${who} money`).toBe(true)
        }
    })

    it("refuses prices to a member without Purchasing or Finance access", async () => {
        const client = await clientFor("dealOwner")
        const { data, error } = await client.from("sor_canvass_offer_prices").select("*").eq("offer_id", offerId)
        expect(error).toBeNull()
        expect(data).toEqual([])
        const money = await client.rpc("canvass_subject_can_read_money", { p_component_id: null, p_requested_item_id: plainItemId })
        expect(money.data).toBe(false)
    })

    it("shows a non-member nothing", async () => {
        const client = await clientFor("ordinary")
        expect(await canRead(client, "sor_canvasses", canvassId)).toBe(false)
        expect(await canRead(client, "sor_canvass_offers", offerId)).toBe(false)
        const { data } = await client.from("sor_canvass_offer_prices").select("*").eq("offer_id", offerId)
        expect(data).toEqual([])
        const money = await client.rpc("canvass_subject_can_read_money", { p_component_id: null, p_requested_item_id: plainItemId })
        expect(money.data).toBe(false)
    })
})
