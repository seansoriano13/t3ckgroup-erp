/**
 * Costing Matrix, Final Acquire by the rule (#962, spec #955 decision 3).
 *
 *   Stockable   Odoo SRP x (1 + percent / 100)
 *   Source Out  the Acquire (the attached P0's price when there is one), no percent
 *   no Status   blank
 *
 * Only the Closed Book tier reads the percents, the typed mark and the figure; only the decider list
 * (the final_acquire signer list, the 'management' band) writes them. A typed value wins over the rule and
 * never moves; a rule-filled one follows its inputs. The database and src/utils/costingMath.js give the same
 * figure to the centavo.
 *
 * The cast, on one SOR: dealOwner (Sales band), outsider (Purchasing band), ipasSigner (on the
 * final_acquire list: Management band), stageParticipant (participant tier, no band).
 * Fixtures are written with the service role; every assertion about who may do what runs as a cast member.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"
import {
    COMPONENT_COST_BANDS,
    COMPONENT_COST_TIERS,
    COMPONENT_FINAL_ACQUIRE_BANDS,
    COMPONENT_FINAL_ACQUIRE_TIERS,
    MATRIX_MONEY_BANDS,
    MATRIX_MONEY_TIERS,
} from "../../constants/costing.js"
import { finalAcquireByRule } from "../../utils/costingMath.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId
let sorId, matrixId, lineId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const readMatrix = async (who) => {
    const { data, error } = await (await clientFor(who)).rpc("costing_matrix_read", { p_opportunity_id: sorId })
    if (error) throw new Error(`costing_matrix_read as ${who}: ${error.message}`)
    return data
}

const setCost = async (who, componentId, patch) =>
    (await (await clientFor(who)).rpc("costing_set_money", { p_table: "costing_component_costs", p_row: componentId, p_patch: patch })).error

const setMatrixMoney = async (who, patch) =>
    (await (await clientFor(who)).rpc("costing_set_money", { p_table: "costing_matrix_money", p_row: matrixId, p_patch: patch })).error

const costOf = async (componentId) => asSvc(svc().from("costing_component_costs").select("*").eq("component_id", componentId).single(), "costs")

const num = (v) => (v === null || v === undefined ? null : Number(v))
let position = 0

/** A Component with its status and costs, written with the service role. */
const makeComponent = async (status, costs) => {
    position += 1
    const row = await asSvc(
        svc().from("costing_components").insert({ tender_line_id: lineId, position, name: `Part ${position}`, quantity: 1, status }).select("id").single(),
        "component",
    )
    if (costs) await asSvc(svc().from("costing_component_costs").insert({ component_id: row.id, ...costs }), "costs")
    return row.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} FinalAcquire` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} FA Stage`, sort_order: 10 }).select("id").single(), "stage")).id
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, supportSales1Id: ids.support, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)
    const visit = await asSvc(svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).single(), "visit")
    await asSvc(
        svc().from("sor_stage_participants").insert({ opportunity_id: sorId, employee_id: ids.stageParticipant, source: "action", opened_visit_id: visit.id, until_rule: "stage_left" }),
        "participant window",
    )
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
    await asSvc(svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.ipasSigner }), "signer list")
    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data
    lineId = (
        await asSvc(
            svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Rescue vehicle", quantity: 1, created_by: ids.dealOwner }).select("id").single(),
            "Tender Line",
        )
    ).id
})

afterAll(async () => {
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("the rule: the database and costingMath.js give the same figure", () => {
    it("works the sheet's row, a percent, Source Out and a blank to the centavo", async () => {
        const cases = [
            ["stockable", { odoo_unit: 49800 }],
            ["stockable", { odoo_unit: 9980 }],
            ["stockable", { odoo_unit: 0.05, final_acquire_percent: -50 }],
            ["stockable", { odoo_unit: 33.33 }],
            ["stockable", { odoo_unit: 10.01, final_acquire_percent: 12.5 }],
            ["stockable", {}],
            ["source_out", { acquire_unit: 4000.5, odoo_unit: 9000 }],
            ["source_out", { acquire_unit: 4000.5, p0_unit_price: 3900.25 }],
            ["source_out", { odoo_unit: 9000 }],
            [null, { acquire_unit: 100, odoo_unit: 200 }],
        ]
        for (const [status, costs] of cases) {
            const id = await makeComponent(status, costs)
            const row = await costOf(id)
            const expected = finalAcquireByRule({ status, ...costs }, -20)
            expect(num(row.final_acquire_unit), JSON.stringify([status, costs])).toBe(expected)
            expect(row.final_acquire_typed).toBe(false)
        }
        expect(num((await costOf(await makeComponent("stockable", { odoo_unit: 49800 }))).final_acquire_unit)).toBe(39840)
    })

    it("is worked again when the SRP, the Status, the Acquire or the P0 price changes", async () => {
        const id = await makeComponent("stockable", { odoo_unit: 1000 })
        expect(num((await costOf(id)).final_acquire_unit)).toBe(800)
        await asSvc(svc().from("costing_component_costs").update({ odoo_unit: 2000 }).eq("component_id", id), "srp")
        expect(num((await costOf(id)).final_acquire_unit)).toBe(1600)
        await asSvc(svc().from("costing_component_costs").update({ acquire_unit: 1234.5 }).eq("component_id", id), "acquire")
        await asSvc(svc().from("costing_components").update({ status: "source_out" }).eq("id", id), "status")
        expect(num((await costOf(id)).final_acquire_unit)).toBe(1234.5)
        await asSvc(svc().from("costing_component_costs").update({ p0_unit_price: 1200 }).eq("component_id", id), "p0")
        expect(num((await costOf(id)).final_acquire_unit)).toBe(1200)
        await asSvc(svc().from("costing_components").update({ status: null }).eq("id", id), "status cleared")
        expect(num((await costOf(id)).final_acquire_unit)).toBeNull()
    })

    it("lets Sales set the Status and moves the figure, though Sales cannot write the figure", async () => {
        const id = await makeComponent(null, { odoo_unit: 500 })
        const { error } = await (await clientFor("dealOwner")).from("costing_components").update({ status: "stockable" }).eq("id", id)
        expect(error).toBeNull()
        expect(num((await costOf(id)).final_acquire_unit)).toBe(400)
    })
})

describe("the evaluation's percent and a line's own", () => {
    it("starts at -20 and, changed by the decider list, moves every rule-filled line that has no percent of its own", async () => {
        const follower = await makeComponent("stockable", { odoo_unit: 1000 })
        const own = await makeComponent("stockable", { odoo_unit: 1000, final_acquire_percent: 5 })
        const typed = await makeComponent("stockable", { odoo_unit: 1000, final_acquire_unit: 999 })
        expect(num((await costOf(follower)).final_acquire_unit)).toBe(800)

        expect(await setMatrixMoney("ipasSigner", { final_acquire_percent: -10 })).toBeNull()
        expect(num((await costOf(follower)).final_acquire_unit)).toBe(900)
        expect(num((await costOf(own)).final_acquire_unit)).toBe(1050)
        expect(num((await costOf(typed)).final_acquire_unit)).toBe(999)

        expect(await setCost("ipasSigner", own, { final_acquire_percent: null })).toBeNull()
        expect(num((await costOf(own)).final_acquire_unit)).toBe(900)
        expect(await setMatrixMoney("ipasSigner", { final_acquire_percent: -20 })).toBeNull()
    })

    it("refuses a percent of -100 or less", async () => {
        const error = await setMatrixMoney("ipasSigner", { final_acquire_percent: -100 })
        expect(error).not.toBeNull()
    })
})

describe("typed over the rule", () => {
    it("is marked typed, wins over the rule and never moves; blank puts the line back on the rule", async () => {
        const id = await makeComponent("stockable", { odoo_unit: 1000 })
        expect(await setCost("ipasSigner", id, { final_acquire_unit: 777 })).toBeNull()
        let row = await costOf(id)
        expect(num(row.final_acquire_unit)).toBe(777)
        expect(row.final_acquire_typed).toBe(true)

        await asSvc(svc().from("costing_component_costs").update({ odoo_unit: 5000 }).eq("component_id", id), "srp")
        await asSvc(svc().from("costing_components").update({ status: "source_out" }).eq("id", id), "status")
        expect(num((await costOf(id)).final_acquire_unit)).toBe(777)

        expect(await setCost("ipasSigner", id, { final_acquire_unit: null })).toBeNull()
        row = await costOf(id)
        expect(row.final_acquire_typed).toBe(false)
        expect(num(row.final_acquire_unit)).toBeNull() // Source Out with no Acquire
    })

    it("keeps a Final Acquire stored before the rule as a typed value", async () => {
        const id = await makeComponent("stockable", { odoo_unit: 1000, final_acquire_unit: 123.45 })
        const row = await costOf(id)
        expect(row.final_acquire_typed).toBe(true)
        expect(num(row.final_acquire_unit)).toBe(123.45)
    })
})

describe("who writes: the decider list alone", () => {
    it("refuses Sales, Purchasing and a Stage Participant writing the figure, the line's percent and the evaluation's", async () => {
        const id = await makeComponent("stockable", { odoo_unit: 1000 })
        for (const who of ["dealOwner", "outsider", "stageParticipant"]) {
            for (const patch of [{ final_acquire_unit: 1 }, { final_acquire_percent: 5 }, { final_acquire_typed: true }]) {
                const error = await setCost(who, id, patch)
                expect(error, `${who} ${JSON.stringify(patch)}`).not.toBeNull()
            }
            expect(await setMatrixMoney(who, { final_acquire_percent: -5 }), who).not.toBeNull()
        }
        expect(num((await costOf(id)).final_acquire_unit)).toBe(800)
    })

    it("lets the decider list and a Super Admin write them", async () => {
        const id = await makeComponent("stockable", { odoo_unit: 1000 })
        for (const who of ["ipasSigner", "superAdmin"]) {
            expect(await setCost(who, id, { final_acquire_percent: 10 }), who).toBeNull()
            expect(await setMatrixMoney(who, { final_acquire_percent: -20 }), who).toBeNull()
        }
    })
})

describe("who reads: the Closed Book tier alone", () => {
    it("registers the percents, the typed mark and the figure for closed_book, and the decider band for writing", async () => {
        const tiers = await asSvc(
            svc().from("costing_column_tiers").select("table_name, column_name, tiers").in("table_name", ["costing_component_costs", "costing_matrix_money"]).like("column_name", "final_acquire%"),
            "tiers",
        )
        const bands = await asSvc(
            svc().from("costing_column_bands").select("table_name, column_name, bands").in("table_name", ["costing_component_costs", "costing_matrix_money"]).like("column_name", "final_acquire%"),
            "bands",
        )
        const sorted = (list, table, column, key) => [...(list.find((r) => r.table_name === table && r.column_name === column)?.[key] ?? [])].sort()
        const expectedTiers = {
            costing_component_costs: { final_acquire_unit: COMPONENT_COST_TIERS.final_acquire_unit, ...COMPONENT_FINAL_ACQUIRE_TIERS },
            costing_matrix_money: { final_acquire_percent: MATRIX_MONEY_TIERS.final_acquire_percent },
        }
        const expectedBands = {
            costing_component_costs: { final_acquire_unit: COMPONENT_COST_BANDS.final_acquire_unit, ...COMPONENT_FINAL_ACQUIRE_BANDS },
            costing_matrix_money: { final_acquire_percent: MATRIX_MONEY_BANDS.final_acquire_percent },
        }
        for (const [table, columns] of Object.entries(expectedTiers)) {
            for (const [column, expected] of Object.entries(columns)) {
                expect(sorted(tiers, table, column, "tiers"), `${table}.${column}`).toEqual([...expected].sort())
                expect(sorted(tiers, table, column, "tiers"), `${table}.${column}`).toEqual(["closed_book"])
            }
        }
        for (const [table, columns] of Object.entries(expectedBands)) {
            for (const [column, expected] of Object.entries(columns)) {
                expect(sorted(bands, table, column, "bands"), `${table}.${column}`).toEqual([...expected].sort())
                expect(sorted(bands, table, column, "bands"), `${table}.${column}`).toEqual(["management"])
            }
        }
    })

    it("sends the percents and the figure to the Closed Book and to nobody below it", async () => {
        const id = await makeComponent("stockable", { odoo_unit: 1000, final_acquire_percent: 3 })
        const closed = await readMatrix("ipasSigner")
        const costs = closed.tables.costing_component_costs.find((c) => c.component_id === id)
        expect(Object.keys(costs)).toEqual(expect.arrayContaining(["final_acquire_unit", "final_acquire_percent", "final_acquire_typed"]))
        expect(closed.tables.costing_matrix_money[0]).toHaveProperty("final_acquire_percent")

        const participant = await readMatrix("stageParticipant")
        expect(JSON.stringify(participant)).not.toMatch(/final_acquire/)
    })
})
