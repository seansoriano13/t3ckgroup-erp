/**
 * Compliance follows the products (#932, spec #927 decision 3): the S0 Evaluation's overall verdict is derived from the
 * per-product verdicts and can't be picked by hand.
 *
 *   all products comply        -> Complies
 *   one product deviates       -> Deviates (even with others unjudged)
 *   partly judged, none deviate -> unjudged (null)
 *   technical (in-charge)      -> may judge products and write the offer-level note
 *   everyone else              -> refused a product verdict; nobody picks the overall verdict by hand
 *   Technical list             -> counts products: judged, deviates, and the derived result
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { tryUpdate } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()
const NOT_ALLOWED = "42501"
const MIGRATION = readFileSync("supabase/migrations/20261127200000_932_compliance_follows_products.sql", "utf8")

let saleTypeId, flowId, stageId, sor, matrix, lineA, lineB
let products = []
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const overall = async () => (await asSvc(svc().from("costing_matrices").select("compliance").eq("id", matrix).single(), "matrix")).compliance
const judge = async (who, productId, patch) => tryUpdate(await clientFor(who), "costing_components", productId, patch)
const reset = () => asSvc(svc().from("costing_components").update({ compliance: null, compliance_note: null }).in("id", products), "reset products")
const listRow = async (who) => ((await (await clientFor(who)).rpc("costing_technical_list")).data ?? []).find((r) => r.opportunity_id === sor)

beforeAll(async () => {
    await ensureCastLoaded()
    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Compliance Derived` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Compliance Stage`, sort_order: 10 }).select("id").single(), "stage")).id
    sor = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sor)
    matrix = (await svc().rpc("costing_open_matrix", { p_opportunity_id: sor })).data
    await asSvc(svc().from("costing_matrices").update({ technical_incharge_id: ids.technical }).eq("id", matrix), "in-charge")
    lineA = (await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrix, position: 1, tender_specification: "Line A", quantity: 1, created_by: ids.dealOwner }).select("id").single(), "line A")).id
    lineB = (await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrix, position: 2, tender_specification: "Line B", quantity: 1, created_by: ids.dealOwner }).select("id").single(), "line B")).id
    const rows = await asSvc(
        svc().from("costing_components").insert([
            { tender_line_id: lineA, position: 1, name: "Hose", quantity: 1 },
            { tender_line_id: lineA, position: 2, name: "Clamp", quantity: 1 },
            { tender_line_id: lineB, position: 1, name: "Gauge", quantity: 1 },
        ]).select("id"),
        "products",
    )
    products = rows.map((r) => r.id)
})

afterAll(async () => {
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("the overall verdict is derived from the products", () => {
    it("is unjudged before any product is judged", async () => {
        expect(await overall()).toBeNull()
    })

    it("stays unjudged while only some products are judged", async () => {
        expect(await judge("technical", products[0], { compliance: "complies" })).toEqual({ ok: true, affected: 1 })
        expect(await judge("technical", products[1], { compliance: "complies" })).toEqual({ ok: true, affected: 1 })
        expect(await overall()).toBeNull()
    })

    it("is Complies once every product complies", async () => {
        expect(await judge("technical", products[2], { compliance: "complies" })).toEqual({ ok: true, affected: 1 })
        expect(await overall()).toBe("complies")
    })

    it("is Deviates as soon as one product deviates, and back to Complies when it is re-judged", async () => {
        expect(await judge("technical", products[1], { compliance: "deviates", compliance_note: "Narrower strap" })).toEqual({ ok: true, affected: 1 })
        expect(await overall()).toBe("deviates")
        expect(await judge("technical", products[1], { compliance: "complies" })).toEqual({ ok: true, affected: 1 })
        expect(await overall()).toBe("complies")
    })

    it("is Deviates with other products still unjudged", async () => {
        await reset()
        expect(await judge("technical", products[0], { compliance: "deviates", compliance_note: "Wrong size" })).toEqual({ ok: true, affected: 1 })
        expect(await overall()).toBe("deviates")
    })

    it("follows a product being added or removed", async () => {
        await reset()
        await asSvc(svc().from("costing_components").update({ compliance: "complies" }).in("id", products), "all comply")
        expect(await overall()).toBe("complies")
        const extra = await asSvc(svc().from("costing_components").insert({ tender_line_id: lineB, position: 2, name: "Extra", quantity: 1 }).select("id").single(), "extra product")
        expect(await overall()).toBeNull()
        await asSvc(svc().from("costing_components").delete().eq("id", extra.id), "remove extra")
        expect(await overall()).toBe("complies")
    })

    it("follows a tender line being deleted with its products, and stamps the in-charge as the verdict's owner", async () => {
        await reset()
        await asSvc(svc().from("costing_components").update({ compliance: "complies" }).in("id", products), "all comply")
        const lineC = (await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrix, position: 3, tender_specification: "Line C", quantity: 1, created_by: ids.dealOwner }).select("id").single(), "line C")).id
        await asSvc(svc().from("costing_components").insert({ tender_line_id: lineC, position: 1, name: "Bad part", quantity: 1, compliance: "deviates", compliance_note: "Wrong" }), "deviating product")
        const stamped = await asSvc(svc().from("costing_matrices").select("compliance, compliance_by").eq("id", matrix).single(), "matrix")
        expect(stamped).toMatchObject({ compliance: "deviates", compliance_by: ids.technical })
        await asSvc(svc().from("costing_tender_lines").delete().eq("id", lineC), "remove line C")
        expect(await overall()).toBe("complies")
    })
})

describe("nobody picks the overall verdict by hand", () => {
    it("refuses the in-charge writing the overall verdict directly", async () => {
        await reset()
        const refused = await tryUpdate(await clientFor("technical"), "costing_matrices", matrix, { compliance: "complies" })
        expect(refused).toMatchObject({ ok: false, code: NOT_ALLOWED })
        expect(refused.message).toBe("costing_technical: the overall verdict follows from the products and cannot be set by hand")
        expect(await overall()).toBeNull()
    })

    it("still lets the in-charge, and only them, write the offer-level note", async () => {
        expect(await tryUpdate(await clientFor("technical"), "costing_matrices", matrix, { compliance_note: "Lines 1 and 2 deviate" })).toEqual({ ok: true, affected: 1 })
        const other = await tryUpdate(await clientFor("dealOwner"), "costing_matrices", matrix, { compliance_note: "Mine now" })
        expect(other).toMatchObject({ ok: false, code: NOT_ALLOWED })
        expect(other.message).toBe("costing_technical: only the Technical in-charge can give the Compliance verdict")
    })
})

describe("only the Technical in-charge writes product verdicts", () => {
    it.each(["dealOwner", "outsider", "superAdmin", "stageParticipant"])("refuses %s", async (who) => {
        const refused = await judge(who, products[0], { compliance: "complies" })
        expect(refused.ok === false || refused.affected === 0, who).toBe(true)
        expect(await overall()).toBeNull()
    })

    it("sets many products at once for the in-charge, and refuses it to everyone else", async () => {
        const client = await clientFor("technical")
        const bulk = await client.from("costing_components").update({ compliance: "complies" }).in("id", products).select("id")
        expect(bulk.error).toBeNull()
        expect(bulk.data).toHaveLength(products.length)
        expect(await overall()).toBe("complies")
        const refused = await (await clientFor("dealOwner")).from("costing_components").update({ compliance: "deviates", compliance_note: "x" }).in("id", products).select("id")
        expect(refused.error !== null || refused.data.length === 0).toBe(true)
    })
})

describe("the Technical list counts products", () => {
    it("counts judged and deviating products and carries the derived result", async () => {
        await reset()
        expect(await listRow("technical")).toMatchObject({ rows_total: 3, rows_judged: 0, rows_deviates: 0, compliance: null })
        await judge("technical", products[0], { compliance: "deviates", compliance_note: "Wrong size" })
        await judge("technical", products[1], { compliance: "complies" })
        expect(await listRow("technical")).toMatchObject({ rows_total: 3, rows_judged: 2, rows_deviates: 1, compliance: "deviates" })
        await judge("technical", products[2], { compliance: "complies" })
        expect(await listRow("technical")).toMatchObject({ rows_total: 3, rows_judged: 3, rows_deviates: 1, compliance: "deviates" })
    })
})

describe("the migration", () => {
    it("runs again without harm and keeps the derived verdict", async () => {
        const before = await overall()
        await sql().query(MIGRATION)
        expect(await overall()).toBe(before)
    })
})
