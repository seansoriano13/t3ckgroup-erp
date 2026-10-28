/**
 * Costing Matrix, the Costing priced Stage Condition (#463, spec #266): the kind CHECK and the
 * three keys #463 adds to `costing_condition_inputs` (#272 owns the function and its access rule;
 * policy 86 proves who may ask). Here: the counts move with Acquire (not Final Acquire), count
 * Components and cost-only rows but not Inclusions, and follow the Purchasing Incharge; and the
 * answer holds no peso figure.
 *
 * The cast, on one SOR (dealOwner is its Deal Team):
 *   dealOwner   Deal Team                         -> reads the evidence
 *   outsider    Purchasing access, no part in it  -> closed_book tier (writes Acquire, adds cost-only rows)
 *   ipasSigner  on the final_acquire list         -> closed_book (writes Final Acquire)
 *   ordinary    nobody                            -> refused
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId
let sorId, matrixId, lineId, bundleId, componentId, costRowId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const inputs = async (who = "dealOwner") =>
    (await clientFor(who)).rpc("costing_condition_inputs", { p_opportunity_id: sorId })
const priced = async (who = "dealOwner") => {
    const { data, error } = await inputs(who)
    if (error) throw new Error(`costing_condition_inputs: ${error.message}`)
    const { component_count, missing_acquire, has_purchasing_incharge } = data
    return { component_count, missing_acquire, has_purchasing_incharge }
}
const setMoney = async (who, table, row, patch) =>
    (await (await clientFor(who)).rpc("costing_set_money", { p_table: table, p_row: row, p_patch: patch })).error

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Priced` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Priced Stage`, sort_order: 10 }).select("id").single(), "stage")).id

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)
    await asSvc(svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.ipasSigner }), "signer list")
})

afterAll(async () => {
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("stage_conditions").delete().eq("stage_id", stageId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("the condition kind", () => {
    it("is accepted by the kind CHECK, alongside every older kind", async () => {
        for (const kind of ["costing_priced", "costing_settled", "purchasing_settled", "attachment"]) {
            const { data, error } = await svc().from("stage_conditions").insert({ stage_id: stageId, kind, label: `${MARKER} ${kind}` }).select("id").single()
            expect(error, kind).toBeNull()
            await svc().from("stage_conditions").delete().eq("id", data.id)
        }
        const { error } = await svc().from("stage_conditions").insert({ stage_id: stageId, kind: "nonsense", label: MARKER })
        expect(error?.code).toBe("23514")
    })
})

describe("the evidence Costing priced reads", () => {
    it("says only that there is no matrix before one is opened", async () => {
        const { data, error } = await inputs()
        expect(error).toBeNull()
        expect(data).toEqual({ has_matrix: false })
    })

    it("starts empty: no Component, nothing missing, no Incharge", async () => {
        const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
        if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
        matrixId = opened.data
        expect(await priced()).toEqual({ component_count: 0, missing_acquire: 0, has_purchasing_incharge: false })
    })

    it("counts a Component with no Acquire as missing, until Acquire is written", async () => {
        lineId = (
            await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Rescue tripod", quantity: 2, created_by: ids.dealOwner }).select("id").single(), "line")
        ).id
        componentId = (
            await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 1, name: "Tripod head", quantity: 1 }).select("id").single(), "component")
        ).id
        expect(await priced()).toEqual({ component_count: 1, missing_acquire: 1, has_purchasing_incharge: false })

        expect(await setMoney("outsider", "costing_component_costs", componentId, { acquire_unit: 380 })).toBeNull()
        expect(await priced()).toMatchObject({ component_count: 1, missing_acquire: 0 })
    })

    it("does not take Final Acquire for Acquire", async () => {
        const second = (
            await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 2, name: "Carabiner", quantity: 1 }).select("id").single(), "component 2")
        ).id
        expect(await setMoney("ipasSigner", "costing_component_costs", second, { final_acquire_unit: 40 })).toBeNull()
        expect(await priced()).toMatchObject({ component_count: 2, missing_acquire: 1 })
        expect(await setMoney("outsider", "costing_component_costs", second, { acquire_unit: 35 })).toBeNull()
        expect(await priced()).toMatchObject({ component_count: 2, missing_acquire: 0 })
    })

    it("counts a cost-only row with no Acquire as missing, but not as a Component", async () => {
        const row = await (await clientFor("outsider")).rpc("costing_add_cost_row", { p_matrix_id: matrixId, p_description: "Delivery", p_quantity: 1, p_category_key: "logistics" })
        if (row.error) throw new Error(`costing_add_cost_row: ${row.error.message}`)
        costRowId = row.data
        expect(await priced()).toMatchObject({ component_count: 2, missing_acquire: 1 })
        expect(await setMoney("outsider", "costing_cost_rows", costRowId, { acquire_unit: 90 })).toBeNull()
        expect(await priced()).toMatchObject({ component_count: 2, missing_acquire: 0 })
    })

    it("ignores Inclusions", async () => {
        bundleId = (
            await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 3, name: "Rescue kit", quantity: 1, is_bundle: true }).select("id").single(), "bundle")
        ).id
        expect(await setMoney("outsider", "costing_component_costs", bundleId, { acquire_unit: 1200 })).toBeNull()
        await asSvc(svc().from("costing_inclusions").insert({ component_id: bundleId, position: 1, description: "Lanyard", quantity: 1 }), "inclusion")
        expect(await priced()).toMatchObject({ component_count: 3, missing_acquire: 0 })
    })

    it("follows the Purchasing Incharge named on the matrix", async () => {
        await asSvc(svc().from("costing_matrices").update({ purchasing_incharge_id: ids.outsider }).eq("id", matrixId), "incharge")
        expect((await priced()).has_purchasing_incharge).toBe(true)
        await asSvc(svc().from("costing_matrices").update({ purchasing_incharge_id: null }).eq("id", matrixId), "clear incharge")
        expect((await priced()).has_purchasing_incharge).toBe(false)
    })

    it("a cleared Acquire is missing again, live", async () => {
        expect(await setMoney("outsider", "costing_component_costs", componentId, { acquire_unit: null })).toBeNull()
        expect(await priced()).toMatchObject({ missing_acquire: 1 })
    })

    it("gives the same answer to everyone who can see the SOR, with no peso figure", async () => {
        const mine = (await inputs("dealOwner")).data
        const admin = await inputs("superAdmin")
        expect(admin.error).toBeNull()
        expect(admin.data).toEqual(mine)
        expect(typeof mine.component_count).toBe("number")
        expect(typeof mine.missing_acquire).toBe("number")
        expect(typeof mine.has_purchasing_incharge).toBe("boolean")
        expect(JSON.stringify(mine)).not.toMatch(/380|1200|"35|"90/)
        expect((await inputs("ordinary")).error?.code).toBe("42501")
    })
})
