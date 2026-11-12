/**
 * Costing Matrix, the summary the sheet's way (#964, spec #955 decision 4): the database's Revenue
 * (costing_planned_revenue, behind the Bid Decision's loss check) equals the screen's
 * (costingMath.summary) for the same evaluation, a blank input blanks it, and only the Closed Book
 * tier reads what it is worked from.
 *
 * The cast, on one SOR:
 *   dealOwner         Deal Team                       -> closed_book tier
 *   outsider          Purchasing access (flagged)     -> cost tier
 *   stageParticipant  open Stage Participant window   -> participant tier
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"
import { summary } from "../../utils/costingMath.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId
let sorId, matrixId, lineId, componentId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}
const num = (value) => (value === null || value === undefined ? null : Number(value))

const dbRevenue = async () => {
    const db = sql()
    const [row] = await db`select public.costing_planned_revenue(${matrixId}::uuid) as revenue`
    return num(row.revenue)
}

const readMatrix = async (who) => {
    const { data, error } = await (await clientFor(who)).rpc("costing_matrix_read", { p_opportunity_id: sorId })
    if (error) throw new Error(`costing_matrix_read as ${who}: ${error.message}`)
    return data
}

/** The screen's figure for the same rows: costingMath.summary over what the database holds. */
const screenSummary = async () => {
    const settings = await asSvc(svc().from("costing_settings").select("*").eq("id", 1).single(), "settings")
    const prices = await asSvc(svc().from("costing_tender_line_prices").select("*").eq("tender_line_id", lineId).single(), "prices")
    const costs = await asSvc(svc().from("costing_component_costs").select("*").eq("component_id", componentId).single(), "costs")
    const rows = await asSvc(svc().from("costing_cost_rows").select("*").eq("matrix_id", matrixId), "cost rows")
    const money = (await svc().from("costing_matrix_money").select("*").eq("matrix_id", matrixId).maybeSingle()).data
    return summary(
        {
            tenderLines: [
                {
                    quantity: 1,
                    final_offer_unit: num(prices.final_offer_unit),
                    abc_unit: num(prices.abc_unit),
                    components: [{ quantity: 1, final_acquire_unit: num(costs.final_acquire_unit) }],
                },
            ],
            costRows: rows.map((r) => ({ quantity: Number(r.quantity), acquire_unit: num(r.acquire_unit), final_acquire_unit: num(r.final_acquire_unit), abc_pct: num(r.abc_pct) })),
            money,
        },
        {
            vatDivisor: Number(settings.vat_divisor),
            taxRate: Number(settings.tax_rate),
            retentionRate: Number(settings.retention_rate),
            itrRate: Number(settings.itr_rate),
            itrAllowance: Number(settings.itr_allowance),
            goLinePercent: Number(settings.go_line_percent),
        },
    )
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} SheetSummary` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} SheetSummary Stage`, sort_order: 10 }).select("id").single(), "stage")).id
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)
    const visit = await asSvc(svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).single(), "visit")
    await asSvc(
        svc().from("sor_stage_participants").insert({ opportunity_id: sorId, employee_id: ids.stageParticipant, source: "action", opened_visit_id: visit.id, until_rule: "stage_left" }),
        "participant window",
    )
    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data
    lineId = (
        await asSvc(
            svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Rescue vehicle", quantity: 1, created_by: ids.dealOwner }).select("id").single(),
            "Tender Line",
        )
    ).id
    await asSvc(svc().from("costing_tender_line_prices").upsert({ tender_line_id: lineId, abc_unit: 371500, final_offer_unit: 370000 }), "prices")
    // The sheet's Final Acquire total, 125,104, as a Source Out Component (its Acquire is its Final Acquire).
    componentId = (
        await asSvc(
            svc().from("costing_components").insert({ tender_line_id: lineId, position: 1, name: "Part", quantity: 1, status: "source_out" }).select("id").single(),
            "component",
        )
    ).id
    await asSvc(svc().from("costing_component_costs").insert({ component_id: componentId, acquire_unit: 125104 }), "costs")
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("Revenue the sheet's way", () => {
    it("is blank while Project expenses or Marketing are blank, never zero", async () => {
        expect(await dbRevenue()).toBeNull()
        for (const [description, acquire] of [["Labor", 60000], ["Permits", 29160]]) {
            await asSvc(svc().from("costing_cost_rows").insert({ matrix_id: matrixId, position: description === "Labor" ? 1 : 2, description, quantity: 1, acquire_unit: acquire, created_by: ids.dealOwner }), "cost row")
        }
        // Marketing still blank.
        expect(await dbRevenue()).toBeNull()
        expect((await screenSummary()).revenue).toBeNull()
    })

    it("works the sheet's table: Revenue 102,793.14, and the database equals the screen", async () => {
        await asSvc(svc().from("costing_matrix_money").upsert({ matrix_id: matrixId, marketing: 0 }), "marketing")
        expect(await dbRevenue()).toBe(102793.14)
        const screen = await screenSummary()
        expect(screen).toMatchObject({ opex: 217964, revenue: 102793.14, revenuePercent: 27.78, underGoLine: false })
        expect(await dbRevenue()).toBe(screen.revenue)
    })

    it("agrees with the screen as Marketing and the rates change", async () => {
        await asSvc(svc().from("costing_matrix_money").upsert({ matrix_id: matrixId, marketing: 12345.67 }), "marketing")
        expect(await dbRevenue()).toBe((await screenSummary()).revenue)
        const original = await asSvc(svc().from("costing_settings").select("*").eq("id", 1).single(), "settings")
        try {
            await asSvc(svc().from("costing_settings").update({ vat_divisor: 1.1, retention_rate: 0.02, itr_rate: 0.25, itr_allowance: 100000 }).eq("id", 1), "rates")
            expect(await dbRevenue()).toBe((await screenSummary()).revenue)
        } finally {
            await asSvc(
                svc().from("costing_settings").update({ vat_divisor: original.vat_divisor, retention_rate: original.retention_rate, itr_rate: original.itr_rate, itr_allowance: original.itr_allowance }).eq("id", 1),
                "restore rates",
            )
        }
    })

    it("starts the Go line at 20 percent", async () => {
        const settings = await asSvc(svc().from("costing_settings").select("go_line_percent").eq("id", 1).single(), "settings")
        expect(Number(settings.go_line_percent)).toBe(20)
    })
})

describe("who reads what the Revenue is worked from", () => {
    it("gives the Closed Book the Marketing row, and every other tier none of it", async () => {
        expect((await readMatrix("dealOwner")).tables.costing_matrix_money?.[0]?.marketing).toBeDefined()
        for (const who of ["outsider", "stageParticipant"]) {
            const data = await readMatrix(who)
            expect(data.tables.costing_matrix_money ?? [], who).toEqual([])
        }
    })

    it("keeps the Revenue function out of every signed-in caller's hands", async () => {
        const { error } = await (await clientFor("dealOwner")).rpc("costing_planned_revenue", { p_matrix_id: matrixId })
        expect(error).not.toBeNull()
    })
})
