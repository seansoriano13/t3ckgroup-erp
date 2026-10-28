/**
 * #545 (spec #544): the Final Acquire list and the Evaluation list open any SOR that has a
 * Costing Matrix, at any stage, with no mention and no Stage Participant window. An SOR with
 * no matrix stays closed to both. The Evaluation list reads the matrix at the participant tier
 * (no money) and approves the Evaluation; a higher tier is never lowered by also being listed.
 *
 * The cast, on one SOR with a matrix (dealOwner is its Deal Team):
 *   ipasSigner  Final Acquire list only         -> opens the SOR, closed_book
 *   ordinary    Evaluation list only            -> opens the SOR, participant
 *   outsider    Purchasing + Evaluation list    -> closed_book (not lowered)
 *   dealOwner   Deal Team + Evaluation list     -> closed_book (not lowered)
 *   superAdmin                                  -> closed_book
 *   finance     on neither list                 -> closed
 * A second SOR (same Deal Team) has no matrix: closed to both lists.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()
const ABC = 1111.11
const OFFER = 977.77
const ACQUIRE = 417.31

let saleTypeId, flowId, stageId, stageTwoId
let sorId, noMatrixSorId, matrixId, lineId, componentId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}
const rpc = async (who, fn, args) => (await clientFor(who)).rpc(fn, args)
const level = async (who, sor = sorId) => (await rpc(who, "sor_access_level", { p_opportunity_id: sor })).data
const tier = async (who, sor = sorId) => (await rpc(who, "costing_tier", { p_opportunity_id: sor })).data
const numbersIn = (value, found = []) => {
    if (typeof value === "number") found.push(value)
    else if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) found.push(Number(value))
    else if (value && typeof value === "object") for (const v of Object.values(value)) numbersIn(v, found)
    return found
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} List Access` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} List Stage A`, sort_order: 10 }).select("id").single(), "stage")).id
    stageTwoId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} List Stage B`, sort_order: 20 }).select("id").single(), "stage 2")).id

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    noMatrixSorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId, noMatrixSorId)

    await asSvc(
        svc().from("costing_signer_lists").insert([
            { list_key: "final_acquire", employee_id: ids.ipasSigner },
            { list_key: "markup", employee_id: ids.ipasSigner },
            { list_key: "evaluation", employee_id: ids.ordinary },
            { list_key: "evaluation", employee_id: ids.outsider },
            { list_key: "evaluation", employee_id: ids.dealOwner },
        ]),
        "lists",
    )

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data
    lineId = (
        await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Rescue tripod", quantity: 2, created_by: ids.dealOwner }).select("id").single(), "line")
    ).id
    componentId = (
        await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 1, name: "Tripod head", quantity: 2 }).select("id").single(), "component")
    ).id
    for (const [who, table, row, patch] of [
        ["dealOwner", "costing_tender_line_prices", lineId, { abc_unit: ABC, final_offer_unit: OFFER }],
        ["outsider", "costing_component_costs", componentId, { acquire_unit: ACQUIRE }],
    ]) {
        const { error } = await rpc(who, "costing_set_money", { p_table: table, p_row: row, p_patch: patch })
        if (error) throw new Error(`typing as ${who}: ${error.message}`)
    }
})

afterAll(async () => {
    await svc().from("notifications").delete().in("reference_id", sorIds)
    await svc().from("costing_signer_lists").delete().in("employee_id", [ids.ipasSigner, ids.ordinary, ids.outsider, ids.dealOwner])
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("Final Acquire list", () => {
    it("opens an SOR that has a matrix without a mention or a Stage Participant window", async () => {
        expect(await level("ipasSigner")).toBe("participant")
        const record = await rpc("ipasSigner", "sor_participant_record", { p_opportunity_id: sorId })
        expect(record.data).toHaveLength(1)
        expect(await tier("ipasSigner")).toBe("closed_book")
    })

    it("keeps the Closed Book view and may set Final Acquire and markup", async () => {
        const set = await rpc("ipasSigner", "costing_set_money", { p_table: "costing_component_costs", p_row: componentId, p_patch: { final_acquire_unit: 389.77, markup_factor: 1.3719 } })
        expect(set.error).toBeNull()
        const read = await rpc("ipasSigner", "costing_matrix_read", { p_opportunity_id: sorId })
        expect(read.error).toBeNull()
        expect(numbersIn(read.data)).toContain(ACQUIRE)
    })

    it("still opens it after the stage moves", async () => {
        await asSvc(svc().from("sales_opportunities").update({ flow_stage_id: stageTwoId }).eq("id", sorId), "move stage")
        expect(await level("ipasSigner")).toBe("participant")
        expect(await tier("ipasSigner")).toBe("closed_book")
        await asSvc(svc().from("sales_opportunities").update({ flow_stage_id: stageId }).eq("id", sorId), "move back")
    })

    it("stays closed on an SOR with no matrix", async () => {
        expect(await level("ipasSigner", noMatrixSorId)).toBe("none")
        const record = await rpc("ipasSigner", "sor_participant_record", { p_opportunity_id: noMatrixSorId })
        expect(record.data ?? []).toHaveLength(0)
    })
})

describe("Evaluation list", () => {
    it("opens an SOR with a matrix at the participant tier, with no money", async () => {
        expect(await level("ordinary")).toBe("participant")
        expect(await tier("ordinary")).toBe("participant")
        const read = await rpc("ordinary", "costing_matrix_read", { p_opportunity_id: sorId })
        expect(read.error).toBeNull()
        expect(read.data.tables.costing_tender_lines[0].tender_specification).toBe("Rescue tripod")
        expect(read.data.tables.costing_components[0].name).toBe("Tripod head")
        const numbers = numbersIn(read.data)
        for (const secret of [ABC, OFFER, ACQUIRE, 389.77, 1.3719]) expect(numbers).not.toContain(secret)
    })

    it("still opens it after the stage moves", async () => {
        await asSvc(svc().from("sales_opportunities").update({ flow_stage_id: stageTwoId }).eq("id", sorId), "move stage")
        expect(await level("ordinary")).toBe("participant")
        expect(await tier("ordinary")).toBe("participant")
        await asSvc(svc().from("sales_opportunities").update({ flow_stage_id: stageId }).eq("id", sorId), "move back")
    })

    it("stays closed on an SOR with no matrix", async () => {
        expect(await level("ordinary", noMatrixSorId)).toBe("none")
        expect(await tier("ordinary", noMatrixSorId)).toBeNull()
        const read = await rpc("ordinary", "costing_matrix_read", { p_opportunity_id: noMatrixSorId })
        // A closed matrix read answers null, not an error (costing_matrix_read).
        expect(read.data).toBeNull()
    })

    it("approves the Evaluation once every Component has a verdict, and not before", async () => {
        const early = await rpc("ordinary", "costing_sign", { p_matrix_id: matrixId, p_role: "evaluation_approved" })
        expect(early.error?.message).toMatch(/no verdict yet/)
        await asSvc(svc().from("costing_components").update({ compliance: "complies" }).eq("id", componentId), "compliance")
        const signed = await rpc("ordinary", "costing_sign", { p_matrix_id: matrixId, p_role: "evaluation_approved" })
        expect(signed.error).toBeNull()
        expect(signed.data.signoff).toMatchObject({ role: "evaluation_approved", signed_by: ids.ordinary })
    })
})

describe("higher tiers are not lowered by also being on the Evaluation list", () => {
    it.each([
        ["outsider", "closed_book"],
        ["dealOwner", "closed_book"],
        ["superAdmin", "closed_book"],
    ])("%s keeps %s", async (who, expected) => {
        expect(await tier(who)).toBe(expected)
    })
})

describe("someone on neither list", () => {
    it("cannot open the SOR", async () => {
        expect(await level("finance")).toBe("none")
        expect(await tier("finance")).toBeNull()
    })
})
