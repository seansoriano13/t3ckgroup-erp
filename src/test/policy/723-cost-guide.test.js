/**
 * S0 Evaluation, cost guide (#723, spec #718): Settings holds the sheet's cost categories with a low and
 * high %, Super Admins change the ranges, a new cost-only row must name a category (an old blank one reads
 * as Uncategorised), product rows count as Products, and each category's share of the Final Offer is served
 * only to a tier that reads both the Final Offer and Final Acquire. A share outside its range is reported as
 * a status, never refused.
 *
 * The cast, on one SOR (dealOwner and support are its Deal Team):
 *   dealOwner           Deal Team                       -> closed_book, Sales band
 *   stageParticipant    open Stage Participant window   -> participant tier, no band
 *   finance             Finance access alone            -> no tier
 *   ordinary            nobody                          -> no tier
 *   superAdmin                                          -> closed_book
 *
 * Fixtures are written with the service role; every assertion about who may do what runs as a cast member.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, rlsStatus } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId
let sorId, matrixId, lineId
let oldRowId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const guideAs = async (who) => {
    const { data, error } = await (await clientFor(who)).rpc("costing_cost_guide", { p_opportunity_id: sorId })
    if (error) throw new Error(`costing_cost_guide as ${who}: ${error.message}`)
    return data
}

const addRow = async (who, category, description = "Row") =>
    (await clientFor(who)).then((client) =>
        client.rpc("costing_add_cost_row", { p_matrix_id: matrixId, p_description: description, p_quantity: 1, ...(category === undefined ? {} : { p_category_key: category }) }),
    )

const categoryOf = (guide, key) => guide.categories.find((c) => c.key === key)

beforeAll(async () => {
    await ensureCastLoaded()

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Cost guide` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Cost guide stage`, sort_order: 10 }).select("id").single(), "stage")).id

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, supportSales1Id: ids.support, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)

    const visit = await asSvc(svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).single(), "visit")
    await asSvc(
        svc().from("sor_stage_participants").insert({ opportunity_id: sorId, employee_id: ids.stageParticipant, source: "action", opened_visit_id: visit.id, until_rule: "stage_left" }),
        "participant window",
    )

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data

    // One Tender Line offered at 1,000,000. Its one Component costs 750,000: 75% of the offer, a Product row.
    lineId = (
        await asSvc(
            svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Rescue vehicle", quantity: 1, created_by: ids.dealOwner }).select("id").single(),
            "Tender Line",
        )
    ).id
    await asSvc(svc().from("costing_tender_line_prices").insert({ tender_line_id: lineId, abc_unit: 1200000, final_offer_unit: 1000000 }), "prices")
    const component = await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 1, name: "Vehicle", quantity: 1 }).select("id").single(), "Component")
    await asSvc(svc().from("costing_component_costs").insert({ component_id: component.id, final_acquire_unit: 750000 }), "Component costs")

    // A row made before the guide: no category.
    oldRowId = (
        await asSvc(
            svc().from("costing_cost_rows").insert({ matrix_id: matrixId, position: 1, description: "Old permit", quantity: 1, final_acquire_unit: 50000 }).select("id").single(),
            "old cost row",
        )
    ).id
})

afterAll(async () => {
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("the categories and their ranges", () => {
    it("starts with the sheet's seven categories and ranges", async () => {
        const { data, error } = await (await clientFor("ordinary")).from("costing_cost_categories").select("key, low_pct, high_pct").order("sort")
        expect(error).toBeNull()
        expect(data.map((c) => [c.key, Number(c.low_pct), Number(c.high_pct)])).toEqual([
            ["products", 70, 80],
            ["labor", 8, 15],
            ["logistics", 3, 7],
            ["equipment", 1, 3],
            ["permits", 1, 2],
            ["overhead", 2, 5],
            ["profit", 5, 10],
        ])
    })

    it("lets a Super Admin change a range, and nobody else", async () => {
        for (const who of ["dealOwner", "stageParticipant", "finance", "ordinary"]) {
            const edit = await (await clientFor(who)).from("costing_cost_categories").update({ low_pct: 1 }).eq("key", "labor").select("key")
            expect(edit.data ?? [], who).toEqual([])
        }
        const untouched = await asSvc(svc().from("costing_cost_categories").select("low_pct").eq("key", "labor").single(), "labor")
        expect(Number(untouched.low_pct)).toBe(8)

        const edit = await (await clientFor("superAdmin")).from("costing_cost_categories").update({ low_pct: 9, high_pct: 14 }).eq("key", "labor").select("low_pct, high_pct").single()
        expect(edit.error).toBeNull()
        expect([Number(edit.data.low_pct), Number(edit.data.high_pct)]).toEqual([9, 14])
        await asSvc(svc().from("costing_cost_categories").update({ low_pct: 8, high_pct: 15 }).eq("key", "labor"), "restore labor")
    })

    it("refuses a range that is upside down or over 100, and a rename, even from a Super Admin", async () => {
        const client = await clientFor("superAdmin")
        const upside = await client.from("costing_cost_categories").update({ low_pct: 20, high_pct: 10 }).eq("key", "labor")
        expect(upside.error?.code).toBe("23514")
        const over = await client.from("costing_cost_categories").update({ high_pct: 101 }).eq("key", "labor")
        expect(over.error?.code).toBe("23514")
        const rename = await client.from("costing_cost_categories").update({ label: "Renamed" }).eq("key", "labor")
        expect(rename.error?.code).toBe("42501")
    })

    it("allows no insert and no delete from the app", async () => {
        const client = await clientFor("superAdmin")
        const add = await client.from("costing_cost_categories").insert({ key: "extra", label: "Extra", low_pct: 1, high_pct: 2 })
        expect(add.error).not.toBeNull()
        const del = await client.from("costing_cost_categories").delete().eq("key", "labor").select("key")
        expect(del.data ?? []).toEqual([])
        expect((await asSvc(svc().from("costing_cost_categories").select("key").eq("key", "labor"), "labor")).length).toBe(1)
    })

    it("has row level security on", async () => {
        expect((await rlsStatus("costing_cost_categories")).enabled).toBe(true)
    })
})

describe("a cost-only row's category", () => {
    it("is required on a new row", async () => {
        for (const missing of [undefined, null, "", "   "]) {
            const refused = await addRow("dealOwner", missing)
            expect(refused.error?.message, JSON.stringify(missing)).toBe("costing_cost_row: a cost needs a category")
            expect(refused.error?.code).toBe("22023")
        }
        const unknown = await addRow("dealOwner", "snacks")
        expect(unknown.error?.message).toBe("costing_cost_row: that category does not exist")
        const rows = await asSvc(svc().from("costing_cost_rows").select("id").eq("matrix_id", matrixId), "rows")
        expect(rows).toHaveLength(1)
    })

    it("is kept on a new row, and the row is the caller's to add only within the Sales and Purchasing bands", async () => {
        const added = await addRow("dealOwner", "labor", "Installers")
        expect(added.error).toBeNull()
        const row = await asSvc(svc().from("costing_cost_rows").select("category_key").eq("id", added.data).single(), "row")
        expect(row.category_key).toBe("labor")

        const participant = await addRow("stageParticipant", "labor")
        expect(participant.error?.message).toBe("costing_band:costing_cost_rows.*:sales,purchasing")
    })

    it("can be changed, but a row that has one cannot lose it", async () => {
        const added = await addRow("dealOwner", "labor", "Crew")
        const set = async (patch) => (await (await clientFor("dealOwner")).rpc("costing_set_money", { p_table: "costing_cost_rows", p_row: added.data, p_patch: patch })).error
        expect(await set({ category_key: "logistics" })).toBeNull()
        const blank = await set({ category_key: null })
        expect(blank?.message).toBe("costing_cost_row: a cost needs a category")
        const row = await asSvc(svc().from("costing_cost_rows").select("category_key").eq("id", added.data).single(), "row")
        expect(row.category_key).toBe("logistics")
        await svc().from("costing_cost_rows").delete().eq("id", added.data)
    })

    it("lets an old row stay blank while its other fields change", async () => {
        const error = (await (await clientFor("dealOwner")).rpc("costing_set_money", { p_table: "costing_cost_rows", p_row: oldRowId, p_patch: { description: "Old permit, renamed" } })).error
        expect(error).toBeNull()
        const row = await asSvc(svc().from("costing_cost_rows").select("category_key").eq("id", oldRowId).single(), "row")
        expect(row.category_key).toBeNull()
    })

    it("is read by every tier that reads the row", async () => {
        for (const who of ["dealOwner", "stageParticipant"]) {
            const { data } = await (await clientFor(who)).rpc("costing_matrix_read", { p_opportunity_id: sorId })
            const rows = data.tables.costing_cost_rows
            expect(rows.length, who).toBeGreaterThan(0)
            expect(rows.every((r) => "category_key" in r), who).toBe(true)
        }
    })
})

describe("the guide: shares of the Final Offer", () => {
    beforeAll(async () => {
        // Rows by category, all against the 1,000,000 offer. Product Component: 75%. Old blank row: 5%.
        const rows = [
            ["labor", 100000], // 10%: within 8 to 15
            ["logistics", 20000], // 2%: below 3 to 7
            ["overhead", 60000], // 6%: above 2 to 5
        ]
        let position = 10
        for (const [category, final] of rows) {
            await asSvc(
                svc().from("costing_cost_rows").insert({ matrix_id: matrixId, position: position++, description: `Guide ${category}`, quantity: 1, category_key: category, final_acquire_unit: final }),
                category,
            )
        }
        // The rows the earlier tests left are removed so the figures are exact.
        await svc().from("costing_cost_rows").delete().eq("matrix_id", matrixId).eq("category_key", "labor").neq("description", "Guide labor")
    })

    it("works each share as the category total over the Final Offer total, with Components counted as Products", async () => {
        const guide = await guideAs("dealOwner")
        expect(Number(guide.final_offer_total)).toBe(1000000)
        expect(Number(categoryOf(guide, "products").share_pct)).toBe(75)
        expect(Number(categoryOf(guide, "labor").share_pct)).toBe(10)
        expect(Number(categoryOf(guide, "logistics").share_pct)).toBe(2)
        expect(Number(categoryOf(guide, "overhead").share_pct)).toBe(6)
        expect(Number(categoryOf(guide, "profit").share_pct)).toBe(0)
        expect(Number(guide.uncategorised.total)).toBe(50000)
        expect(Number(guide.uncategorised.share_pct)).toBe(5)
    })

    it("flags a share below or above its range, and calls an in-range one within", async () => {
        const guide = await guideAs("dealOwner")
        expect(categoryOf(guide, "products").status).toBe("within")
        expect(categoryOf(guide, "labor").status).toBe("within")
        expect(categoryOf(guide, "logistics").status).toBe("below")
        expect(categoryOf(guide, "overhead").status).toBe("above")
        expect(categoryOf(guide, "profit").status).toBe("below")
    })

    it("follows a range a Super Admin changes", async () => {
        await (await clientFor("superAdmin")).from("costing_cost_categories").update({ low_pct: 1, high_pct: 2 }).eq("key", "logistics")
        expect(categoryOf(await guideAs("dealOwner"), "logistics").status).toBe("within")
        await asSvc(svc().from("costing_cost_categories").update({ low_pct: 3, high_pct: 7 }).eq("key", "logistics"), "restore logistics")
    })

    it("never refuses anything because a share is outside its range", async () => {
        const error = (await (await clientFor("dealOwner")).rpc("costing_set_money", { p_table: "costing_cost_rows", p_row: oldRowId, p_patch: { final_acquire_unit: 900000 } })).error
        expect(error).toBeNull()
        const guide = await guideAs("dealOwner")
        expect(Number(guide.uncategorised.share_pct)).toBe(90)
        await asSvc(svc().from("costing_cost_rows").update({ final_acquire_unit: 50000 }).eq("id", oldRowId), "restore")
    })

    it("gives no shares while a line has no Final Offer, and never reads a blank as zero", async () => {
        await svc().from("costing_tender_line_prices").update({ final_offer_unit: null }).eq("tender_line_id", lineId)
        const guide = await guideAs("dealOwner")
        expect(guide.final_offer_total).toBeNull()
        expect(guide.missing_offer).toBe(1)
        expect(categoryOf(guide, "labor").share_pct).toBeNull()
        expect(categoryOf(guide, "labor").status).toBeNull()
        await asSvc(svc().from("costing_tender_line_prices").update({ final_offer_unit: 1000000 }).eq("tender_line_id", lineId), "restore offer")
    })

    it("is served only to a tier that reads both the Final Offer and Final Acquire", async () => {
        for (const who of ["stageParticipant", "finance", "ordinary"]) {
            expect(await guideAs(who), who).toBeNull()
        }
        expect(await guideAs("dealOwner")).not.toBeNull()
        expect(await guideAs("superAdmin")).not.toBeNull()

        // The tiers that stay out are exactly those the registry keeps from one of the two columns.
        const registry = await asSvc(
            svc()
                .from("costing_column_tiers")
                .select("table_name, column_name, tiers")
                .or("and(table_name.eq.costing_tender_line_prices,column_name.eq.final_offer_unit),and(table_name.eq.costing_component_costs,column_name.eq.final_acquire_unit),and(table_name.eq.costing_cost_rows,column_name.eq.final_acquire_unit)"),
            "registry",
        )
        const both = registry.map((r) => r.tiers).reduce((a, b) => a.filter((t) => b.includes(t)))
        expect(both).toEqual(["closed_book"])
    })

    it("sends a participant's matrix read neither the money the shares come from", async () => {
        const { data } = await (await clientFor("stageParticipant")).rpc("costing_matrix_read", { p_opportunity_id: sorId })
        const text = JSON.stringify(data)
        expect(text).not.toMatch(/final_acquire_unit|final_offer_unit/)
    })

    it("returns nothing for an SOR with no matrix", async () => {
        const lonely = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
        sorIds.push(lonely)
        const { data, error } = await (await clientFor("dealOwner")).rpc("costing_cost_guide", { p_opportunity_id: lonely })
        expect(error).toBeNull()
        expect(data).toBeNull()
    })
})
