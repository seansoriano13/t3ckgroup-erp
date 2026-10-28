/**
 * Costing Matrix, the printed matrix's sign-offs (#274, spec #266), after #722 (spec #718): Prepared by,
 * Costed by and Final approved can no longer be signed, an old signature stays live and readable, and
 * the Evaluation approval is the one sign-off left (its rules are in 82-costing-evaluation.test.js).
 *
 * The cast, on one SOR:
 *   dealOwner   Deal Team, the matrix's Sales incharge       -> closed_book tier
 *   outsider    Purchasing access, the Purchasing incharge   -> closed_book tier
 *   ipasSigner  on the final_acquire and evaluation lists    -> closed_book
 *   superAdmin  closed_book, on no list
 *   ordinary    nobody                                       -> no tier
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { readFileSync } from "node:fs"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"
import { snapshotCostingFunctions } from "./support/replay.js"

const svc = () => serviceClient()
const WRONG_STATE = "22023"
const SIGNATURE = `${MARKER}/signature-v1.png`

let saleTypeId, flowId, stageId
let sorId, matrixId, lineId, componentId, costRowId
let previousSignature
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const sign = async (who, role, decline = false) =>
    (await clientFor(who)).rpc("costing_sign", { p_matrix_id: matrixId, p_role: role, p_decline_signature: decline })

const setMoney = async (who, table, row, patch) =>
    (await (await clientFor(who)).rpc("costing_set_money", { p_table: table, p_row: row, p_patch: patch })).error

const rowsOf = (role) => asSvc(svc().from("costing_signoffs").select("*").eq("matrix_id", matrixId).eq("role", role).order("signed_at").order("id"), "sign-offs")
const live = async (role) => (await rowsOf(role)).find((r) => r.cleared_at === null) ?? null
const lastCleared = async (role) => (await rowsOf(role)).filter((r) => r.cleared_at !== null).at(-1) ?? null

/** Puts a live signature on each retired role, as an old deal has it (the function no longer signs them). */
async function seedLegacySignoffs() {
    for (const [who, role] of [
        ["dealOwner", "prepared"],
        ["outsider", "costed"],
        ["ipasSigner", "final_approved"],
    ]) {
        if (await live(role)) continue
        await asSvc(svc().from("costing_signoffs").insert({ matrix_id: matrixId, role, signed_by: ids[who], signature_version: role === "prepared" ? SIGNATURE : null }), `seed ${role}`)
    }
}

beforeAll(async () => {
    // Replaying this migration proves it re-runs without harm, but puts back its older costing_sign (and any
    // other costing function it defines). The snapshot puts the live ones back straight after.
    const restoreFunctions = await snapshotCostingFunctions(sql())
    await sql().query(readFileSync("supabase/migrations/20261018200000_costing_print_signoffs.sql", "utf8"))
    await restoreFunctions()
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
    previousSignature = (await asSvc(svc().from("employees").select("signature_path").eq("id", ids.dealOwner).single(), "signature")).signature_path
    await asSvc(svc().from("employees").update({ signature_path: SIGNATURE }).eq("id", ids.dealOwner), "signature path")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Print` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Print Stage`, sort_order: 10 }).select("id").single(), "stage")).id

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, supportSales1Id: ids.support, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)
    await asSvc(svc().from("costing_signer_lists").insert([{ list_key: "final_acquire", employee_id: ids.ipasSigner }, { list_key: "markup", employee_id: ids.ipasSigner }]), "signer list")

    const opened = await svc().rpc("costing_open_matrix", {
        p_opportunity_id: sorId,
        p_config: { sales_incharge_id: ids.dealOwner, purchasing_incharge_id: ids.outsider },
    })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data

    lineId = (
        await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Rescue tripod", quantity: 1, created_by: ids.dealOwner }).select("id").single(), "Tender Line")
    ).id
    componentId = (await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 1, name: "Tripod head", quantity: 1 }).select("id").single(), "Component")).id
    const row = await (await clientFor("outsider")).rpc("costing_add_cost_row", { p_matrix_id: matrixId, p_description: "Delivery Charge", p_quantity: 1, p_category_key: "logistics" })
    if (row.error) throw new Error(`costing_add_cost_row: ${row.error.message}`)
    costRowId = row.data
})

afterAll(async () => {
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await svc().from("employees").update({ signature_path: previousSignature }).eq("id", ids.dealOwner)
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("the retired sign-offs", () => {
    it("refuses Prepared by, Costed by and Final approved to everyone, even their old signers", async () => {
        for (const [who, role] of [
            ["dealOwner", "prepared"],
            ["outsider", "costed"],
            ["ipasSigner", "final_approved"],
            ["superAdmin", "final_approved"],
        ]) {
            const { error } = await sign(who, role)
            expect(error?.code, `${who} ${role}`).toBe(WRONG_STATE)
            expect(error?.message, `${who} ${role}`).toBe(`costing_sign: ${role} is not a sign-off`)
            expect(await live(role), `${who} ${role}`).toBeNull()
        }
    })

    it("still refuses a role that is not a sign-off", async () => {
        const { error } = await sign("ipasSigner", "something_else")
        expect(error?.code).toBe(WRONG_STATE)
    })
})

describe("old signatures", () => {
    it("stay live when the figure they vouched for changes", async () => {
        await seedLegacySignoffs()
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineId, { final_offer_unit: 1500 })).toBeNull()
        expect(await setMoney("outsider", "costing_component_costs", componentId, { acquire_unit: 800 })).toBeNull()
        expect(await setMoney("outsider", "costing_cost_rows", costRowId, { acquire_unit: 50 })).toBeNull()
        expect(await setMoney("ipasSigner", "costing_component_costs", componentId, { markup_factor: 1.35 })).toBeNull()
        expect(await setMoney("ipasSigner", "costing_matrix_money", matrixId, { default_factor: 1.4 })).toBeNull()
        expect(await setMoney("ipasSigner", "costing_component_costs", componentId, { final_acquire_unit: 900 })).toBeNull()
        for (const role of ["prepared", "costed", "final_approved"]) {
            expect(await live(role), role).not.toBeNull()
            expect(await lastCleared(role), role).toBeNull()
        }
    })
})

describe("who reads the sign-offs", () => {
    it("serves every tier that reads the matrix the signature version with the sign-off", async () => {
        await seedLegacySignoffs()
        for (const who of ["dealOwner", "outsider", "ipasSigner"]) {
            const { data, error } = await (await clientFor(who)).rpc("costing_matrix_read", { p_opportunity_id: sorId })
            expect(error, who).toBeNull()
            const prepared = data.tables.costing_signoffs.find((s) => s.role === "prepared" && s.cleared_at === null)
            expect(prepared, who).toBeTruthy()
            expect(prepared.signature_version, who).toBe(SIGNATURE)
        }
    })
})
