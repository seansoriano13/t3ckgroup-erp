/**
 * Costing Matrix, an Other costs row typed as a percent of the ABC (#963, spec #955): the tiers and band of
 * costing_cost_rows.abc_pct. It is read and written by the same tiers and band as the row's Acquire.
 *
 * The cast, on one SOR:
 *   dealOwner         Deal Team                       -> closed_book tier, Sales band (no Purchasing band)
 *   outsider          Purchasing access (flagged)     -> cost tier, Purchasing band
 *   stageParticipant  open Stage Participant window   -> participant tier, reads neither Acquire nor the percent
 *   ordinary          nobody                          -> sees nothing
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { tryUpdate } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"
import { COST_ROW_BANDS, COST_ROW_TIERS } from "../../constants/costing.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId
let sorId, matrixId, rowId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}
const setMoney = async (who, lineId, patch) =>
    (await (await clientFor(who)).rpc("costing_set_money", { p_table: "costing_tender_line_prices", p_row: lineId, p_patch: patch })).error
const setRowMoney = async (who, patch) =>
    (await (await clientFor(who)).rpc("costing_set_money", { p_table: "costing_cost_rows", p_row: rowId, p_patch: patch })).error
const readRow = async (who) => {
    const { data, error } = await (await clientFor(who)).rpc("costing_matrix_read", { p_opportunity_id: sorId })
    if (error) throw new Error(`costing_matrix_read as ${who}: ${error.message}`)
    return (data.tables.costing_cost_rows ?? []).find((r) => r.id === rowId)
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} CostRowPct` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} CostRowPct Stage`, sort_order: 10 }).select("id").single(), "stage")).id
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
    const added = await (await clientFor("dealOwner")).rpc("costing_add_cost_row", { p_matrix_id: matrixId, p_description: "Labor", p_quantity: 1, p_category_key: "labor" })
    if (added.error) throw new Error(`costing_add_cost_row: ${added.error.message}`)
    rowId = added.data
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

describe("abc_pct: registries", () => {
    it("has the same tiers and band as the row's Acquire, and the screen mirrors them", async () => {
        const { rows: tiers } = await sql().query(
            `select column_name, tiers from public.costing_column_tiers where table_name = 'costing_cost_rows' and column_name in ('acquire_unit','abc_pct') order by column_name`,
        )
        expect(tiers).toHaveLength(2)
        expect([...tiers[0].tiers].sort()).toEqual([...tiers[1].tiers].sort())
        expect([...tiers[1].tiers].sort()).toEqual(["closed_book", "cost"])
        const { rows: bands } = await sql().query(
            `select column_name, bands from public.costing_column_bands where table_name = 'costing_cost_rows' and column_name in ('acquire_unit','abc_pct') order by column_name`,
        )
        expect(bands).toHaveLength(2)
        expect(bands[0].bands).toEqual(["sales", "purchasing"])
        expect(bands[1].bands).toEqual(["purchasing"])
        expect([...COST_ROW_TIERS.abc_pct].sort()).toEqual(["closed_book", "cost"])
        expect(COST_ROW_BANDS.abc_pct).toEqual(["sales", "purchasing"])
    })
})

describe("abc_pct: who writes", () => {
    it("is written by Purchasing, together with the amount, and refused to a Stage Participant", async () => {
        expect(await setRowMoney("outsider", { abc_pct: 10, acquire_unit: 37150 })).toBeNull()
        expect((await setRowMoney("stageParticipant", { abc_pct: 5 }))?.message).toBe("costing_band:costing_cost_rows.abc_pct:sales,purchasing")
        const row = await asSvc(svc().from("costing_cost_rows").select("abc_pct, acquire_unit").eq("id", rowId).single(), "row")
        expect(Number(row.abc_pct)).toBe(10)
        // The database works the amount itself (no ABC yet): the typed 37150 is not kept.
        expect(row.acquire_unit).toBeNull()
    })

    it("is cleared by typing the peso amount by hand", async () => {
        expect(await setRowMoney("outsider", { acquire_unit: 40000, abc_pct: null })).toBeNull()
        const row = await asSvc(svc().from("costing_cost_rows").select("abc_pct, acquire_unit").eq("id", rowId).single(), "row")
        expect(row.abc_pct).toBeNull()
        expect(Number(row.acquire_unit)).toBe(40000)
    })

    it("refuses a negative percent", async () => {
        expect(await setRowMoney("outsider", { abc_pct: -1 })).not.toBeNull()
    })
})

describe("abc_pct: who reads", () => {
    it("reaches the cost side and the Deal Team, never a Stage Participant", async () => {
        expect(await setRowMoney("outsider", { abc_pct: 7 })).toBeNull()
        expect(Number((await readRow("outsider")).abc_pct)).toBe(7)
        expect(Number((await readRow("dealOwner")).abc_pct)).toBe(7)
        const participant = (await readRow("stageParticipant")) ?? {}
        expect("abc_pct" in participant).toBe(false)
        expect("acquire_unit" in participant).toBe(false)
    })
})

describe("abc_pct: Sales types it, the database works the amount (follow-ups of #963)", () => {
    let lineId
    const unit = async () => Number((await asSvc(svc().from("costing_cost_rows").select("acquire_unit").eq("id", rowId).single(), "row")).acquire_unit)
    const rawUnit = async () => (await asSvc(svc().from("costing_cost_rows").select("acquire_unit").eq("id", rowId).single(), "row")).acquire_unit

    beforeAll(async () => {
        lineId = (
            await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Tripod", quantity: 2, created_by: ids.dealOwner }).select("id").single(), "line")
        ).id
        await asSvc(svc().from("costing_cost_rows").update({ quantity: 1 }).eq("id", rowId), "quantity")
        await asSvc(svc().from("costing_matrices").update({ abc_mode: "total_only", abc_total: null }).eq("id", matrixId), "total only")
    })

    it("lets Sales type the percent, with a blank ABC giving a blank amount (never zero)", async () => {
        expect(await setRowMoney("dealOwner", { abc_pct: 10 })).toBeNull()
        expect(await rawUnit()).toBeNull()
    })

    it("refuses Sales typing the amount by hand", async () => {
        expect((await setRowMoney("dealOwner", { acquire_unit: 5 }))?.message).toBe("costing_band:costing_cost_rows.acquire_unit:purchasing")
        expect(await rawUnit()).toBeNull()
    })

    it("refreshes the row when Sales changes the ABC total, and blanks it when the ABC is cleared", async () => {
        expect((await tryUpdate(await clientFor("dealOwner"), "costing_matrices", matrixId, { abc_total: 371500.55 })).affected).toBe(1)
        expect(await unit()).toBe(37150.06)
        await asSvc(svc().from("costing_matrices").update({ abc_total: null }).eq("id", matrixId), "blank")
        expect(await rawUnit()).toBeNull()
    })

    it("refreshes the row when a line's ABC or quantity changes in By line mode, by Sales", async () => {
        await asSvc(svc().from("costing_matrices").update({ abc_mode: "by_line" }).eq("id", matrixId), "by line")
        expect(await rawUnit()).toBeNull()
        expect(await setMoney("dealOwner", lineId, { abc_unit: 1000 })).toBeNull()
        expect(await unit()).toBe(200)
        const q = await (await clientFor("dealOwner")).from("costing_tender_lines").update({ quantity: 3 }).eq("id", lineId).select("id")
        expect(q.error).toBeNull()
        expect(await unit()).toBe(300)
    })

    it("holds the same figure as the screen function", async () => {
        const { percentOfAbcAmount } = await import("../../utils/costingMath.js")
        for (const [pct, total] of [[10, 371500.55], [7.5, 12345.67], [33.33, 999999.99]]) {
            await asSvc(svc().from("costing_matrices").update({ abc_mode: "total_only", abc_total: total }).eq("id", matrixId), "total")
            expect(await setRowMoney("dealOwner", { abc_pct: pct })).toBeNull()
            expect(await unit()).toBe(Number(percentOfAbcAmount(pct, total).toFixed(2)))
        }
    })

    it("still lets the cost side clear the percent and type pesos", async () => {
        expect(await setRowMoney("outsider", { acquire_unit: 40000, abc_pct: null })).toBeNull()
        expect(await unit()).toBe(40000)
    })
})
