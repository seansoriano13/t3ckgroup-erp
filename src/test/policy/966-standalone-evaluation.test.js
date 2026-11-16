/**
 * S0 Evaluation from just an S0 (#966, spec #955 decision 7): who reads a standalone evaluation, one per S0, the
 * incharges, and linking it to a SOR hands access over to the SOR's rules.
 *
 * The cast, on one standalone evaluation:
 *   dealOwner      starts it (Deal Team of a SOR, so allowed to start)     -> price tier
 *   support        named Sales incharge                                    -> price tier
 *   ordinary       named PMS incharge (no Purchasing access)               -> cost tier
 *   outsider       Purchasing access (flagged)                             -> cost tier
 *   leaveManager   on the decider list                                     -> closed_book
 *   superAdmin                                                              -> closed_book
 *   warehouse      a stranger                                               -> nothing
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors, purgeCostingMatrices } from "./support/costing.js"

const svc = () => serviceClient()

const S0 = "S0966001"
const S0_LINK = "S0966002"
const S0_ON_SOR = "S0966003"
let matrixId, lineId, componentId
let sorId, sorWithS0Id, otherSorId
const sorIds = []
const matrixIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}
const rpc = async (who, name, args = {}) => (await clientFor(who)).rpc(name, args)
const tierOf = async (who, subject) => {
    const { data, error } = await rpc(who, "costing_tier", { p_opportunity_id: subject })
    if (error) throw new Error(`costing_tier as ${who}: ${error.message}`)
    return data
}
const readAs = async (who, subject) => {
    const { data, error } = await rpc(who, "costing_matrix_read", { p_opportunity_id: subject })
    if (error) throw new Error(`costing_matrix_read as ${who}: ${error.message}`)
    return data
}
const LINES = [
    { name: "Rescue vehicle", quantity: 2, unit: "Unit", odoo_product_id: 4242, odoo_line_id: 91001 },
    { name: "Hose reel", quantity: 5, unit: "pc", odoo_product_id: null, odoo_line_id: 91002 },
]

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
    await asSvc(svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.leaveManager }), "decider list")
    // A SOR the starter is on the Deal Team of: that is what lets them start an evaluation at all.
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(sorId)
    // A SOR that already carries an S0 Evaluation of its own, on the S0 below.
    sorWithS0Id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(sorWithS0Id)
    await asSvc(svc().from("sales_opportunities").update({ sales_reference: S0_ON_SOR }).eq("id", sorWithS0Id), "sales reference")
    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorWithS0Id })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    otherSorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(otherSorId)
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.leaveManager)
    await purgeCostingMatrices(matrixIds)
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
})

describe("starting an evaluation from an S0", () => {
    it("makes one with no SOR, its lines from Odoo, and the two incharges", async () => {
        const { data, error } = await rpc("dealOwner", "costing_standalone_open", {
            p_s0_number: ` ${S0.toLowerCase()} `,
            p_sales_incharge: ids.support,
            p_pms_incharge: ids.ordinary,
            p_lines: LINES,
        })
        expect(error).toBeNull()
        expect(data).toMatchObject({ existed: false, standalone: true })
        matrixId = data.matrix_id
        matrixIds.push(matrixId)
        expect(data.subject_id).toBe(matrixId)

        const matrix = await asSvc(svc().from("costing_matrices").select("*").eq("id", matrixId).single(), "matrix")
        expect(matrix).toMatchObject({ opportunity_id: null, s0_number: S0, created_by: ids.dealOwner, sales_incharge_id: ids.support, purchasing_incharge_id: ids.ordinary })
        const lines = await asSvc(svc().from("costing_tender_lines").select("*").eq("matrix_id", matrixId).order("position"), "lines")
        expect(lines.map((l) => [l.tender_specification, Number(l.quantity), l.source, l.odoo_line_id])).toEqual([
            ["Rescue vehicle", 2, "typed", 91001],
            ["Hose reel", 5, "typed", 91002],
        ])
        lineId = lines[0].id
        const components = await asSvc(svc().from("costing_components").select("id, odoo_product_id").eq("tender_line_id", lineId), "components")
        expect(components).toHaveLength(1)
        expect(components[0].odoo_product_id).toBe(4242)
        componentId = components[0].id
    })

    it("refuses what is not an S0 number", async () => {
        for (const bad of ["", "S-1", "SO123", "12345", "S0abc"]) {
            const { error } = await rpc("dealOwner", "costing_standalone_open", { p_s0_number: bad, p_sales_incharge: ids.support, p_pms_incharge: ids.ordinary, p_lines: [] })
            expect(error?.code, bad).toBe("22023")
        }
    })

    it("refuses to start without both incharges", async () => {
        const { error } = await rpc("dealOwner", "costing_standalone_open", { p_s0_number: "S0966099", p_sales_incharge: ids.support, p_pms_incharge: null, p_lines: [] })
        expect(error?.code).toBe("22023")
    })

    it("opens the one that exists instead of making a second", async () => {
        const { data, error } = await rpc("support", "costing_standalone_open", { p_s0_number: S0, p_sales_incharge: ids.support, p_pms_incharge: ids.ordinary, p_lines: LINES })
        // `support` is on no Deal Team, so is not allowed to start, but the dealOwner asking again gets the same one.
        expect(error?.code).toBe("42501")
        expect(data).toBeNull()
        const again = await rpc("dealOwner", "costing_standalone_open", { p_s0_number: S0, p_sales_incharge: ids.support, p_pms_incharge: ids.ordinary, p_lines: LINES })
        expect(again.error).toBeNull()
        expect(again.data).toMatchObject({ existed: true, standalone: true, matrix_id: matrixId, subject_id: matrixId })
        const rows = await asSvc(svc().from("costing_matrices").select("id").eq("s0_number", S0), "rows")
        expect(rows).toHaveLength(1)
    })

    it("opens the SOR's own evaluation when the S0 is already on a SOR", async () => {
        const { data, error } = await rpc("dealOwner", "costing_standalone_open", { p_s0_number: S0_ON_SOR, p_sales_incharge: ids.support, p_pms_incharge: ids.ordinary, p_lines: LINES })
        expect(error).toBeNull()
        expect(data).toMatchObject({ existed: true, standalone: false, subject_id: sorWithS0Id })
        const standalone = await asSvc(svc().from("costing_matrices").select("id").eq("s0_number", S0_ON_SOR), "standalone rows")
        expect(standalone).toHaveLength(0)
    })

    it("does not let a stranger start one", async () => {
        const { error } = await rpc("warehouse", "costing_standalone_open", { p_s0_number: "S0966098", p_sales_incharge: ids.support, p_pms_incharge: ids.ordinary, p_lines: [] })
        expect(error?.code).toBe("42501")
    })

    it("holds one evaluation per S0 in the table itself", async () => {
        const { error } = await svc().from("costing_matrices").insert({ opportunity_id: null, s0_number: S0.toLowerCase() })
        expect(error?.code).toBe("23505")
    })
})

describe("who reads a standalone evaluation, and which side", () => {
    beforeAll(async () => {
        await asSvc(svc().from("costing_tender_line_prices").upsert({ tender_line_id: lineId, abc_unit: 150000, final_offer_unit: 140000 }), "prices")
        await asSvc(svc().from("costing_component_costs").upsert({ component_id: componentId, acquire_unit: 90000 }), "costs")
        await asSvc(svc().from("costing_matrix_money").upsert({ matrix_id: matrixId, marketing: 1000 }), "marketing")
    })

    it("gives each reader exactly their tier", async () => {
        expect(await tierOf("dealOwner", matrixId)).toBe("price")
        expect(await tierOf("support", matrixId)).toBe("price")
        expect(await tierOf("ordinary", matrixId)).toBe("cost")
        expect(await tierOf("outsider", matrixId)).toBe("cost")
        expect(await tierOf("leaveManager", matrixId)).toBe("closed_book")
        expect(await tierOf("superAdmin", matrixId)).toBe("closed_book")
    })

    it("gives a stranger nothing", async () => {
        for (const who of ["warehouse", "closingSales", "flowEditor"]) {
            expect(await tierOf(who, matrixId), who).toBeNull()
            expect(await readAs(who, matrixId), who).toBeNull()
            const { data } = await (await clientFor(who)).from("costing_matrices").select("id").eq("id", matrixId)
            expect(data, who).toEqual([])
            const lines = await (await clientFor(who)).from("costing_tender_lines").select("id").eq("matrix_id", matrixId)
            expect(lines.data, who).toEqual([])
        }
    })

    it("lets the price side read the prices and not the costs", async () => {
        for (const who of ["dealOwner", "support"]) {
            const data = await readAs(who, matrixId)
            expect(data.tier, who).toBe("price")
            expect(data.tables.costing_tender_line_prices?.[0]?.final_offer_unit, who).toBeDefined()
            expect(JSON.stringify(data.tables), who).not.toContain("acquire_unit")
            expect(data.tables.costing_matrix_money ?? [], who).toEqual([])
        }
    })

    it("lets the cost side read the costs and not the prices", async () => {
        for (const who of ["ordinary", "outsider"]) {
            const data = await readAs(who, matrixId)
            expect(data.tier, who).toBe("cost")
            expect(data.tables.costing_component_costs?.[0]?.acquire_unit, who).toBeDefined()
            expect(JSON.stringify(data.tables), who).not.toContain("final_offer_unit")
            expect(data.tables.costing_matrix_money ?? [], who).toEqual([])
        }
    })

    it("lets the decider list and Super Admins read everything", async () => {
        for (const who of ["leaveManager", "superAdmin"]) {
            const data = await readAs(who, matrixId)
            expect(data.tier, who).toBe("closed_book")
            expect(data.tables.costing_tender_line_prices?.[0]?.final_offer_unit, who).toBeDefined()
            expect(data.tables.costing_component_costs?.[0]?.acquire_unit, who).toBeDefined()
            expect(data.tables.costing_matrix_money?.[0]?.marketing, who).toBeDefined()
        }
    })

    it("shows the header as the S0, with no SOR", async () => {
        const { data, error } = await rpc("support", "costing_matrix_header", { p_opportunity_id: matrixId })
        expect(error).toBeNull()
        expect(data).toMatchObject({ standalone: true, sales_reference: S0, sor_code: null })
        expect((await rpc("warehouse", "costing_matrix_header", { p_opportunity_id: matrixId })).data).toBeNull()
    })

    it("lists it for its readers with the figures of their tier", async () => {
        const rowOf = async (who) => (await rpc(who, "costing_standalone_page")).data?.find((r) => r.matrix_id === matrixId)
        const price = await rowOf("support")
        expect(price).toMatchObject({ tier: "price", s0_number: S0, line_count: 2 })
        expect(price.final_acquire_total).toBeNull()
        const cost = await rowOf("ordinary")
        expect(cost.tier).toBe("cost")
        expect(cost.final_offer_total).toBeNull()
        const all = await rowOf("leaveManager")
        expect(all).toMatchObject({ tier: "closed_book" })
        expect(Number(all.marketing)).toBe(1000)
        expect(await rowOf("warehouse")).toBeUndefined()
    })

    it("tells a named reader the page is theirs, and a stranger not", async () => {
        expect((await rpc("support", "costing_standalone_anywhere")).data).toBe(true)
        expect((await rpc("ordinary", "costing_standalone_anywhere")).data).toBe(true)
        expect((await rpc("warehouse", "costing_standalone_anywhere")).data).toBe(false)
    })
})

describe("who writes on a standalone evaluation", () => {
    const setMoney = (who, table, row, patch) => rpc(who, "costing_set_money", { p_table: table, p_row: row, p_patch: patch })

    it("lets the price side type the prices and refuses them a cost", async () => {
        const offer = await setMoney("support", "costing_tender_line_prices", lineId, { final_offer_unit: 141000 })
        expect(offer.error).toBeNull()
        const cost = await setMoney("support", "costing_component_costs", componentId, { acquire_unit: 1 })
        expect(cost.error).not.toBeNull()
    })

    it("lets the named PMS incharge type a cost, and refuses them a price", async () => {
        const cost = await setMoney("ordinary", "costing_component_costs", componentId, { acquire_unit: 91000 })
        expect(cost.error).toBeNull()
        const offer = await setMoney("ordinary", "costing_tender_line_prices", lineId, { final_offer_unit: 1 })
        expect(offer.error).not.toBeNull()
    })

    it("refuses a stranger both", async () => {
        expect((await setMoney("warehouse", "costing_tender_line_prices", lineId, { final_offer_unit: 1 })).error).not.toBeNull()
        expect((await setMoney("warehouse", "costing_component_costs", componentId, { acquire_unit: 1 })).error).not.toBeNull()
    })

    it("lets the starter add a line, and refuses a stranger", async () => {
        const added = await (await clientFor("dealOwner")).from("costing_tender_lines").insert({ matrix_id: matrixId, position: 3, tender_specification: "Extra", quantity: 1, created_by: ids.dealOwner }).select("id")
        expect(added.error).toBeNull()
        const refused = await (await clientFor("warehouse")).from("costing_tender_lines").insert({ matrix_id: matrixId, position: 4, tender_specification: "Sneaky", quantity: 1 }).select("id")
        expect(refused.error?.code).toBe("42501")
    })

    it("keeps the SOR-bound rules: an evaluation on a SOR still goes by the SOR", async () => {
        expect(await tierOf("dealOwner", sorWithS0Id)).toBe("closed_book")
        expect(await tierOf("support", sorWithS0Id)).toBeNull()
        expect(await tierOf("warehouse", sorWithS0Id)).toBeNull()
    })
})

describe("the incharges", () => {
    it("changes them for the starter, and the old Sales incharge stops reading", async () => {
        const { error } = await rpc("dealOwner", "costing_standalone_set_incharge", { p_matrix_id: matrixId, p_sales_incharge: ids.closingSales, p_pms_incharge: ids.ordinary })
        expect(error).toBeNull()
        expect(await tierOf("support", matrixId)).toBeNull()
        expect(await tierOf("closingSales", matrixId)).toBe("price")
    })

    it("refuses the PMS incharge, a stranger, and a blank name", async () => {
        for (const who of ["ordinary", "warehouse"]) {
            const { error } = await rpc(who, "costing_standalone_set_incharge", { p_matrix_id: matrixId, p_sales_incharge: ids.support, p_pms_incharge: ids.ordinary })
            expect(error?.code, who).toBe("42501")
        }
        const blank = await rpc("dealOwner", "costing_standalone_set_incharge", { p_matrix_id: matrixId, p_sales_incharge: ids.support, p_pms_incharge: null })
        expect(blank.error?.code).toBe("22023")
    })

    it("names a new PMS incharge who then reads the cost side", async () => {
        const { error } = await rpc("dealOwner", "costing_standalone_set_incharge", { p_matrix_id: matrixId, p_sales_incharge: ids.support, p_pms_incharge: ids.technical })
        expect(error).toBeNull()
        expect(await tierOf("technical", matrixId)).toBe("cost")
        expect(await tierOf("ordinary", matrixId)).toBeNull()
    })
})

describe("linking to a SOR", () => {
    let linkMatrixId

    beforeAll(async () => {
        const { data, error } = await rpc("dealOwner", "costing_standalone_open", { p_s0_number: S0_LINK, p_sales_incharge: ids.support, p_pms_incharge: ids.ordinary, p_lines: LINES })
        if (error) throw new Error(error.message)
        linkMatrixId = data.matrix_id
        matrixIds.push(linkMatrixId)
    })

    it("is refused to someone who cannot read the evaluation", async () => {
        const { error } = await rpc("ordinary", "costing_standalone_link", { p_matrix_id: linkMatrixId, p_opportunity_id: otherSorId })
        expect(error?.code).toBe("42501")
    })

    it("is refused for a SOR that already has an evaluation", async () => {
        const { error } = await rpc("dealOwner", "costing_standalone_link", { p_matrix_id: linkMatrixId, p_opportunity_id: sorWithS0Id })
        expect(error?.code).toBe("22023")
        expect((await asSvc(svc().from("costing_matrices").select("opportunity_id").eq("id", linkMatrixId).single(), "matrix")).opportunity_id).toBeNull()
    })

    it("is refused for a SOR that is on another S0", async () => {
        await asSvc(svc().from("sales_opportunities").update({ sales_reference: "S0123456" }).eq("id", otherSorId), "sales reference")
        const { error } = await rpc("dealOwner", "costing_standalone_link", { p_matrix_id: linkMatrixId, p_opportunity_id: otherSorId })
        expect(error?.code).toBe("22023")
        await asSvc(svc().from("sales_opportunities").update({ sales_reference: S0_LINK }).eq("id", otherSorId), "sales reference")
    })

    it("hands access to the SOR's rules", async () => {
        const before = {
            salesIncharge: await tierOf("support", linkMatrixId),
            pmsIncharge: await tierOf("ordinary", linkMatrixId),
        }
        expect(before).toEqual({ salesIncharge: "price", pmsIncharge: "cost" })

        const { data, error } = await rpc("dealOwner", "costing_standalone_link", { p_matrix_id: linkMatrixId, p_opportunity_id: otherSorId })
        expect(error).toBeNull()
        expect(data).toMatchObject({ opportunity_id: otherSorId, matrix_id: linkMatrixId })

        // The standalone readers no longer apply: the matrix id stops being a subject, and the SOR's rules decide.
        for (const who of ["support", "ordinary", "warehouse"]) {
            expect(await tierOf(who, linkMatrixId), `${who} by matrix id`).toBeNull()
            expect(await tierOf(who, otherSorId), `${who} by SOR`).toBeNull()
        }
        expect(await tierOf("dealOwner", otherSorId)).toBe("closed_book")
        expect(await tierOf("outsider", otherSorId)).toBe("closed_book")
        const read = await readAs("dealOwner", otherSorId)
        expect(read.tables.costing_tender_lines).toHaveLength(2)
        const { data: rowsAfter } = await (await clientFor("support")).from("costing_matrices").select("id").eq("id", linkMatrixId)
        expect(rowsAfter).toEqual([])
    })

    it("cannot be linked twice", async () => {
        const { error } = await rpc("dealOwner", "costing_standalone_link", { p_matrix_id: linkMatrixId, p_opportunity_id: sorId })
        expect(error?.code).toBe("22023")
        const incharge = await rpc("dealOwner", "costing_standalone_set_incharge", { p_matrix_id: linkMatrixId, p_sales_incharge: ids.support, p_pms_incharge: ids.ordinary })
        expect(incharge.error?.code).toBe("22023")
    })
})

describe("every part of the evaluation works without a SOR", () => {
    let wholeId, wholeLineId, wholeComponentId

    beforeAll(async () => {
        const { data, error } = await rpc("dealOwner", "costing_standalone_open", {
            p_s0_number: "S0966004",
            p_sales_incharge: ids.support,
            p_pms_incharge: ids.ordinary,
            p_lines: [{ name: "Rescue vehicle", quantity: 1, unit: "Unit", odoo_product_id: 4242, odoo_line_id: 92001 }],
        })
        if (error) throw new Error(error.message)
        wholeId = data.matrix_id
        matrixIds.push(wholeId)
        wholeLineId = (await asSvc(svc().from("costing_tender_lines").select("id").eq("matrix_id", wholeId).single(), "line")).id
        wholeComponentId = (await asSvc(svc().from("costing_components").select("id").eq("tender_line_id", wholeLineId).single(), "component")).id
    })

    it("answers the desk's reads for every reader without an error", async () => {
        for (const who of ["dealOwner", "ordinary", "leaveManager", "superAdmin"]) {
            for (const [name, args] of [
                ["costing_cost_guide", { p_opportunity_id: wholeId }],
                ["costing_component_requests", { p_opportunity_id: wholeId }],
                ["costing_landed_costs", { p_opportunity_id: wholeId }],
                ["costing_component_purchases", { p_opportunity_id: wholeId }],
                ["canvass_po_suppliers", { p_opportunity_id: wholeId }],
                ["costing_history", { p_opportunity_id: wholeId }],
            ]) {
                const { error } = await rpc(who, name, args)
                expect(error?.message ?? null, `${who} ${name}`).toBeNull()
            }
        }
    })

    it("fills the Odoo SRP for the readers who write, and for no stranger", async () => {
        const filled = await svc().rpc("costing_fill_odoo_costs", { p_actor: ids.dealOwner, p_opportunity_id: wholeId, p_costs: { 4242: 80000 }, p_srps: { 4242: 120000 } })
        expect(filled.error).toBeNull()
        expect(filled.data).toBe(1)
        const costs = await asSvc(svc().from("costing_component_costs").select("odoo_unit, acquire_unit").eq("component_id", wholeComponentId).single(), "costs")
        expect(Number(costs.odoo_unit)).toBe(120000)
        const refused = await svc().rpc("costing_fill_odoo_costs", { p_actor: ids.warehouse, p_opportunity_id: wholeId, p_costs: { 4242: 1 }, p_srps: {} })
        expect(refused.error?.code).toBe("42501")
    })

    it("takes the Bid Decision from the Closed Book alone, and locks the sheet on a Go", async () => {
        await rpc("dealOwner", "costing_set_money", { p_table: "costing_tender_line_prices", p_row: wholeLineId, p_patch: { final_offer_unit: 200000 } })
        const priceSide = await rpc("dealOwner", "costing_decide_bid", { p_matrix_id: wholeId, p_verdict: "revise", p_reason: "price side cannot decide" })
        expect(priceSide.error?.code).toBe("42501")
        const costSide = await rpc("ordinary", "costing_decide_bid", { p_matrix_id: wholeId, p_verdict: "revise", p_reason: "cost side cannot decide" })
        expect(costSide.error?.code).toBe("42501")
        const revise = await rpc("leaveManager", "costing_decide_bid", { p_matrix_id: wholeId, p_verdict: "revise", p_reason: "worked again" })
        expect(revise.error).toBeNull()
        const unlocked = await rpc("leaveManager", "costing_decide_bid", { p_matrix_id: wholeId, p_verdict: "go", p_reason: "wait for the evaluation" })
        expect(unlocked.error?.message).toMatch(/Evaluation of Specification/)
    })

    it("gives the Technical verdict and approves the evaluation, then takes a Go", async () => {
        // The Technical in-charge reads without money and gives the one verdict.
        await rpc("dealOwner", "costing_standalone_set_incharge", { p_matrix_id: wholeId, p_sales_incharge: ids.support, p_pms_incharge: ids.ordinary })
        await asSvc(svc().from("costing_matrices").update({ technical_incharge_id: ids.technical }).eq("id", wholeId), "technical in-charge")
        expect(await tierOf("technical", wholeId)).toBe("participant")
        const read = await readAs("technical", wholeId)
        expect(JSON.stringify(read.tables)).not.toContain("final_offer_unit")
        // The overall verdict follows from the products' verdicts, which the in-charge gives.
        const verdict = await (await clientFor("technical")).from("costing_components").update({ compliance: "complies" }).eq("id", wholeComponentId).select("id")
        expect(verdict.error?.message ?? null).toBeNull()
        expect(verdict.data).toHaveLength(1)
        expect((await asSvc(svc().from("costing_matrices").select("compliance").eq("id", wholeId).single(), "matrix")).compliance).toBe("complies")

        await asSvc(svc().from("costing_signer_lists").insert({ list_key: "evaluation", employee_id: ids.finance }), "evaluation list")
        try {
            expect(await tierOf("finance", wholeId)).toBe("participant")
            const signed = await rpc("finance", "costing_sign", { p_matrix_id: wholeId, p_role: "evaluation_approved" })
            expect(signed.error?.message ?? null).toBeNull()
            const go = await rpc("leaveManager", "costing_decide_bid", { p_matrix_id: wholeId, p_verdict: "go", p_reason: "approved" })
            expect(go.error?.message ?? null).toBeNull()
            // A Go locks the sheet, standalone as on a SOR.
            const locked = await rpc("dealOwner", "costing_set_money", { p_table: "costing_tender_line_prices", p_row: wholeLineId, p_patch: { final_offer_unit: 1 } })
            expect(locked.error).not.toBeNull()
        } finally {
            await svc().from("costing_signer_lists").delete().eq("employee_id", ids.finance)
        }
    })
})
