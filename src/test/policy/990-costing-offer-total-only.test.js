/**
 * The S0 Evaluation's Final Offer typed as one total (the price corridor, layout F, the sheet's way): the tiers and
 * bands of costing_matrices.offer_mode and offer_total, costing_offer_total as the one offer rule (the over-ABC
 * check, the missing-offer count), and a Go locking the typed totals.
 *
 * The cast, on one SOR (dealOwner is its Deal Team, so Sales band and closed_book tier):
 *   dealOwner         Deal Team                       -> closed_book tier, Sales band
 *   stageParticipant  open Stage Participant window   -> participant tier, reads neither column
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
const offerTotal = async () => (await sql().query(`select public.costing_offer_total($1) as total`, [matrixId])).rows[0].total

beforeAll(async () => {
    await ensureCastLoaded()
    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} OfferTotal` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} OfferTotal Stage`, sort_order: 10 }).select("id").single(), "stage")).id
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
        await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Portable tower light", quantity: 2, created_by: ids.dealOwner }).select("id").single(), "line")
    ).id
})

afterAll(async () => {
    await svc().from("costing_bid_decisions").delete().eq("matrix_id", matrixId)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("the offer columns: registries", () => {
    it("are read by the tiers that read final_offer_unit, and written by the Sales band", async () => {
        const { rows: tiers } = await sql().query(
            `select column_name, tiers from public.costing_column_tiers where table_name = 'costing_matrices' and column_name in ('offer_mode','offer_total') order by column_name`,
        )
        for (const row of tiers) expect([...row.tiers].sort()).toEqual(["closed_book", "price"])
        expect(tiers).toHaveLength(2)
        const { rows: bands } = await sql().query(
            `select column_name, bands from public.costing_column_bands where table_name = 'costing_matrices' and column_name in ('offer_mode','offer_total') order by column_name`,
        )
        for (const row of bands) expect(row.bands).toEqual(["sales"])
        expect(bands).toHaveLength(2)
    })

    it("reach the Deal Team and never a Stage Participant", async () => {
        const deal = (await readMatrix("dealOwner")).tables.costing_matrices[0]
        expect(deal.offer_mode).toBe("by_line")
        expect(deal.offer_total).toBeNull()
        const participant = (await readMatrix("stageParticipant")).tables.costing_matrices?.[0] ?? {}
        expect("offer_mode" in participant).toBe(false)
        expect("offer_total" in participant).toBe(false)
    })

    it("are written by Sales and refused to a Stage Participant", async () => {
        expect((await tryUpdate(await clientFor("dealOwner"), "costing_matrices", matrixId, { offer_mode: "by_line" })).ok).toBe(true)
        const no = await tryUpdate(await clientFor("stageParticipant"), "costing_matrices", matrixId, { offer_total: 1 })
        expect(no.ok && no.affected > 0).toBe(false)
    })
})

describe("one offer rule, to the centavo", () => {
    it("uses the typed total in Total only, and the lines again in By line", async () => {
        // The line: ABC 2 x 1,000.00 = 2,000.00; its own offer 2 x 900.00 = 1,800.00.
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineId, { abc_unit: 1000, final_offer_unit: 900 })).toBeNull()
        expect(Number(await offerTotal())).toBe(1800)

        expect((await tryUpdate(await clientFor("dealOwner"), "costing_matrices", matrixId, { offer_mode: "total_only", offer_total: 2000 })).affected).toBe(1)
        expect(Number(await offerTotal())).toBe(2000)
        let data = (await inputs("dealOwner")).data
        expect(data.over_abc).toBe(false)
        expect(data.missing_offer).toBe(0)

        await asSvc(svc().from("costing_matrices").update({ offer_total: 2000.01 }).eq("id", matrixId), "one centavo over")
        expect((await inputs("dealOwner")).data.over_abc).toBe(true)

        // A blank total is never zero: one thing missing, nothing to be over.
        await asSvc(svc().from("costing_matrices").update({ offer_total: null }).eq("id", matrixId), "blank")
        data = (await inputs("dealOwner")).data
        expect(data.missing_offer).toBe(1)
        expect(data.over_abc).toBe(false)
        expect(await offerTotal()).toBeNull()

        // Back to By line: the line's own offer is still there and decides again.
        await asSvc(svc().from("costing_matrices").update({ offer_mode: "by_line" }).eq("id", matrixId), "by line")
        expect(Number(await offerTotal())).toBe(1800)
    })
})

describe("a Go locks the typed totals", () => {
    it("refuses a change to the offer or ABC total while a Go stands, and allows it once the Go is cleared", async () => {
        await asSvc(svc().from("costing_matrices").update({ offer_mode: "total_only", offer_total: 1900 }).eq("id", matrixId), "total")
        await asSvc(
            svc().from("costing_bid_decisions").insert({ matrix_id: matrixId, verdict: "go", reason: `${MARKER} go`, decided_by: ids.dealOwner, final_offer_total: 1900 }),
            "a Go",
        )
        const offer = await tryUpdate(await clientFor("dealOwner"), "costing_matrices", matrixId, { offer_total: 1950 })
        expect(offer.ok && offer.affected > 0).toBe(false)
        const abc = await tryUpdate(await clientFor("dealOwner"), "costing_matrices", matrixId, { abc_total: 5000 })
        expect(abc.ok && abc.affected > 0).toBe(false)

        await asSvc(svc().from("costing_bid_decisions").update({ cleared_at: new Date().toISOString(), cleared_reason: `${MARKER} unlocked` }).eq("matrix_id", matrixId), "clear the Go")
        expect((await tryUpdate(await clientFor("dealOwner"), "costing_matrices", matrixId, { offer_total: 1950 })).affected).toBe(1)
    })
})
