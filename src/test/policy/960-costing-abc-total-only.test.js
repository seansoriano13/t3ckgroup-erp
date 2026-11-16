/**
 * Costing Matrix, the ABC typed as one total (#960, spec #955): the tiers and bands of
 * costing_matrices.abc_mode and abc_total, and the database's over-ABC check in Total only, to the centavo.
 *
 * The cast, on one SOR (dealOwner is its Deal Team, so Sales band and closed_book tier):
 *   dealOwner      Deal Team                      -> closed_book tier, Sales band
 *   stageParticipant  open Stage Participant window -> participant tier, reads neither column
 *   ordinary       nobody                          -> sees nothing
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { tryUpdate } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId
let sorId, matrixId, lineId, visitId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}
const inputs = async (who) => (await clientFor(who)).rpc("costing_condition_inputs", { p_opportunity_id: sorId })
const setMoney = async (who, table, row, patch) =>
    (await (await clientFor(who)).rpc("costing_set_money", { p_table: table, p_row: row, p_patch: patch })).error
const readMatrix = async (who) => (await (await clientFor(who)).rpc("costing_matrix_read", { p_opportunity_id: sorId })).data

beforeAll(async () => {
    await ensureCastLoaded()
    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} AbcTotal` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} AbcTotal Stage`, sort_order: 10 }).select("id").single(), "stage")).id
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)
    visitId = (await asSvc(svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).single(), "visit")).id
    await asSvc(
        svc().from("sor_stage_participants").insert({ opportunity_id: sorId, employee_id: ids.stageParticipant, source: "action", opened_visit_id: visitId, until_rule: "stage_left" }),
        "participant window",
    )
    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data
    lineId = (
        await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Rescue tripod", quantity: 2, created_by: ids.dealOwner }).select("id").single(), "line")
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

describe("the new columns: registries", () => {
    it("are read by the tiers that read abc_unit, and written by the Sales band", async () => {
        const { rows: tiers } = await sql().query(
            `select column_name, tiers from public.costing_column_tiers where table_name = 'costing_matrices' and column_name in ('abc_mode','abc_total') order by column_name`,
        )
        for (const row of tiers) expect([...row.tiers].sort()).toEqual(["closed_book", "cost", "price"])
        expect(tiers).toHaveLength(2)
        const { rows: bands } = await sql().query(
            `select column_name, bands from public.costing_column_bands where table_name = 'costing_matrices' and column_name in ('abc_mode','abc_total') order by column_name`,
        )
        for (const row of bands) expect(row.bands).toEqual(["sales"])
        expect(bands).toHaveLength(2)
    })

    it("reach the Deal Team and never a Stage Participant", async () => {
        const deal = (await readMatrix("dealOwner")).tables.costing_matrices[0]
        expect(deal.abc_mode).toBe("by_line")
        expect(deal.abc_total).toBeNull()
        const participant = (await readMatrix("stageParticipant")).tables.costing_matrices?.[0] ?? {}
        expect("abc_mode" in participant).toBe(false)
        expect("abc_total" in participant).toBe(false)
    })

    it("are written by Sales and refused to a Stage Participant", async () => {
        const ok = await tryUpdate(await clientFor("dealOwner"), "costing_matrices", matrixId, { abc_mode: "by_line" })
        expect(ok.ok).toBe(true)
        const no = await tryUpdate(await clientFor("stageParticipant"), "costing_matrices", matrixId, { abc_total: 1 })
        expect(no.ok && no.affected > 0).toBe(false)
    })
})

describe("over-ABC in Total only, to the centavo", () => {
    it("uses the typed total, and keeps the line ABC for when the mode returns", async () => {
        // The line's own ABC (2 x 1,000.00) is ignored in Total only; the offer is 2 x 1,000.00 = 2,000.00.
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineId, { abc_unit: 1000, final_offer_unit: 1000 })).toBeNull()
        expect((await inputs("dealOwner")).data.over_abc).toBe(false)

        expect((await tryUpdate(await clientFor("dealOwner"), "costing_matrices", matrixId, { abc_mode: "total_only", abc_total: 2000 })).affected).toBe(1)
        expect((await inputs("dealOwner")).data.over_abc).toBe(false)

        await asSvc(svc().from("costing_matrices").update({ abc_total: 1999.99 }).eq("id", matrixId), "one centavo under")
        expect((await inputs("dealOwner")).data.over_abc).toBe(true)

        await asSvc(svc().from("costing_matrices").update({ abc_total: 2000.01 }).eq("id", matrixId), "one centavo over")
        expect((await inputs("dealOwner")).data.over_abc).toBe(false)

        // A blank total is never zero: nothing to be over.
        await asSvc(svc().from("costing_matrices").update({ abc_total: null }).eq("id", matrixId), "blank")
        expect((await inputs("dealOwner")).data.over_abc).toBe(false)

        // Back to By line: the line's ABC is still there and decides again.
        await asSvc(svc().from("costing_matrices").update({ abc_mode: "by_line" }).eq("id", matrixId), "by line")
        const price = await asSvc(svc().from("costing_tender_line_prices").select("abc_unit").eq("tender_line_id", lineId).single(), "price")
        expect(Number(price.abc_unit)).toBe(1000)
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineId, { final_offer_unit: 1000.01 })).toBeNull()
        expect((await inputs("dealOwner")).data.over_abc).toBe(true)
    })
})
