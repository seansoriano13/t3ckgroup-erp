/**
 * Costing Matrix, the printed matrix's sign-offs (#274, spec #266): who may sign Prepared by,
 * Costed by and Final Acquire and offer approved, what the signature is stamped with, and which
 * change clears which sign-off.
 *
 * The cast, on one SOR:
 *   dealOwner   Deal Team, the matrix's Sales incharge       -> closed_book tier, signs "prepared"
 *   support     Deal Team, not the incharge                  -> closed_book tier
 *   outsider    Purchasing access, the Purchasing incharge   -> closed_book tier, signs "costed"
 *   ipasSigner  on the final_acquire list                    -> closed_book, signs "final_approved"
 *   superAdmin  closed_book, on no list, incharge of nothing
 * Since 20261102180000 anyone at the Closed Book may approve the Final Acquire and offer, not only the list.
 *   ordinary    nobody                                       -> no tier
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { readFileSync } from "node:fs"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"
import { replayCostingFunctions } from "./support/replay.js"

const svc = () => serviceClient()
const RLS_VIOLATION = "42501"
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

/** Signs the three roles as their rightful signers, whichever are not signed yet. */
async function signAll() {
    for (const [who, role] of [
        ["dealOwner", "prepared"],
        ["outsider", "costed"],
        ["ipasSigner", "final_approved"],
    ]) {
        if (await live(role)) continue
        const { error } = await sign(who, role)
        if (error) throw new Error(`sign ${role} as ${who}: ${error.message}`)
    }
}

beforeAll(async () => {
    // Test 82 replays #271's migration to prove it is re-runnable, which puts back that migration's
    // costing_sign. Replaying this one first restores ours (and proves it re-runs without harm).
    await sql().query(readFileSync("supabase/migrations/20261018200000_costing_print_signoffs.sql", "utf8"))
    // ...and #556 carries costing_sign forward with its refusal codes, so put that on top. Only the
    // costing functions: replaying the whole file would put back the IPAS functions as of #556 too.
    await replayCostingFunctions(sql(), "supabase/migrations/20261023210000_refusal_codes.sql")
    // ...and 20261102180000 opens costing_sign's Final Acquire sign-off per SOR, so put that on top too.
    await replayCostingFunctions(sql(), "supabase/migrations/20261102180000_costing_open_review_fixes.sql")
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
    previousSignature = (await asSvc(svc().from("employees").select("signature_path").eq("id", ids.dealOwner).single(), "signature")).signature_path
    await asSvc(svc().from("employees").update({ signature_path: SIGNATURE }).eq("id", ids.dealOwner), "signature path")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Print` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Print Stage`, sort_order: 10 }).select("id").single(), "stage")).id

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, supportSales1Id: ids.support, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)
    await asSvc(svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.ipasSigner }), "signer list")

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
    const row = await (await clientFor("outsider")).rpc("costing_add_cost_row", { p_matrix_id: matrixId, p_description: "Delivery Charge", p_quantity: 1 })
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

describe("Prepared by", () => {
    it("is refused to anyone but the Sales incharge", async () => {
        for (const who of ["support", "outsider", "ipasSigner", "superAdmin"]) {
            const { error } = await sign(who, "prepared")
            expect(error?.code, who).toBe(RLS_VIOLATION)
            expect(error?.message, who).toBe("costing_sign: only the Sales incharge can sign Prepared by")
        }
        const { error } = await sign("ordinary", "prepared")
        expect(error?.code).toBe(RLS_VIOLATION)
        expect(await live("prepared")).toBeNull()
    })

    it("lets the Sales incharge sign, stamped with the signature on file", async () => {
        const { data, error } = await sign("dealOwner", "prepared")
        expect(error).toBeNull()
        expect(data.signoff.role).toBe("prepared")
        const row = await live("prepared")
        expect(row.signed_by).toBe(ids.dealOwner)
        expect(row.signature_declined).toBe(false)
        expect(row.signature_version).toBe(SIGNATURE)
    })

    it("refuses a second live signature", async () => {
        const { error } = await sign("dealOwner", "prepared")
        expect(error?.code).toBe(WRONG_STATE)
    })
})

describe("Costed by", () => {
    it("is refused to anyone but the Purchasing incharge", async () => {
        for (const who of ["dealOwner", "support", "ipasSigner", "superAdmin"]) {
            const { error } = await sign(who, "costed")
            expect(error?.code, who).toBe(RLS_VIOLATION)
            expect(error?.message, who).toBe("costing_sign: only the Purchasing incharge can sign Costed by")
        }
        expect(await live("costed")).toBeNull()
    })

    it("lets the Purchasing incharge sign, with no signature version when they have none", async () => {
        const { error } = await sign("outsider", "costed")
        expect(error).toBeNull()
        const row = await live("costed")
        expect(row.signed_by).toBe(ids.outsider)
        expect(row.signature_version).toBeNull()
    })
})

describe("Final Acquire and offer approved", () => {
    it("lets the Deal Team, Purchasing and a Super Admin approve it too, as they read the Closed Book", async () => {
        for (const who of ["dealOwner", "outsider", "superAdmin"]) {
            const { error } = await sign(who, "final_approved")
            expect(error, who).toBeNull()
            expect((await live("final_approved"))?.signed_by, who).toBe(ids[who])
            await svc().from("costing_signoffs").delete().eq("matrix_id", matrixId).eq("role", "final_approved")
        }
        expect(await live("final_approved")).toBeNull()
    })

    it("is refused to someone who cannot read the matrix", async () => {
        const { error } = await sign("ordinary", "final_approved")
        expect(error?.code).toBe(RLS_VIOLATION)
        expect(await live("final_approved")).toBeNull()
    })

    it("lets a member of the list sign, and records declining the signature", async () => {
        const { error } = await sign("ipasSigner", "final_approved", true)
        expect(error).toBeNull()
        const row = await live("final_approved")
        expect(row.signed_by).toBe(ids.ipasSigner)
        expect(row.signature_declined).toBe(true)
        expect(row.signature_version).toBeNull()
    })

    it("still refuses a role that is not a sign-off", async () => {
        const { error } = await sign("ipasSigner", "something_else")
        expect(error?.code).toBe("22023")
    })
})

describe("what clears a sign-off", () => {
    it("clears Prepared by and Final Acquire and offer on a Final Offer change, and not Costed by", async () => {
        await signAll()
        expect(await setMoney("dealOwner", "costing_tender_line_prices", lineId, { final_offer_unit: 1500 })).toBeNull()
        expect(await live("prepared")).toBeNull()
        expect(await live("final_approved")).toBeNull()
        expect(await live("costed")).not.toBeNull()
        expect((await lastCleared("prepared")).cleared_reason).toBe("The Final Offer changed")
        expect((await lastCleared("final_approved")).cleared_reason).toBe("The Final Offer changed")
    })

    it("clears Costed by on an Acquire change, and neither of the others", async () => {
        await signAll()
        expect(await setMoney("outsider", "costing_component_costs", componentId, { acquire_unit: 800 })).toBeNull()
        expect(await live("costed")).toBeNull()
        expect((await lastCleared("costed")).cleared_reason).toBe("An Acquire changed")
        expect(await live("prepared")).not.toBeNull()
        expect(await live("final_approved")).not.toBeNull()
    })

    it("clears Costed by on a cost-only row's Acquire", async () => {
        await signAll()
        expect(await setMoney("outsider", "costing_cost_rows", costRowId, { acquire_unit: 50 })).toBeNull()
        expect(await live("costed")).toBeNull()
        expect(await live("prepared")).not.toBeNull()
    })

    it("clears Costed by on a markup factor, a Component's own or the default, and not the others", async () => {
        await signAll()
        expect(await setMoney("ipasSigner", "costing_component_costs", componentId, { markup_factor: 1.35 })).toBeNull()
        expect(await live("costed")).toBeNull()
        expect((await lastCleared("costed")).cleared_reason).toBe("A markup factor changed")
        expect(await live("prepared")).not.toBeNull()
        expect(await live("final_approved")).not.toBeNull()

        await signAll()
        expect(await setMoney("ipasSigner", "costing_matrix_money", matrixId, { default_factor: 1.4 })).toBeNull()
        expect(await live("costed")).toBeNull()
        expect(await live("final_approved")).not.toBeNull()
    })

    it("clears Final Acquire and offer on a Final Acquire change, and not Prepared by or Costed by", async () => {
        await signAll()
        expect(await setMoney("ipasSigner", "costing_component_costs", componentId, { final_acquire_unit: 900 })).toBeNull()
        expect(await live("final_approved")).toBeNull()
        expect((await lastCleared("final_approved")).cleared_reason).toBe("A Final Acquire changed")
        expect(await live("prepared")).not.toBeNull()
        expect(await live("costed")).not.toBeNull()

        await signAll()
        expect(await setMoney("ipasSigner", "costing_cost_rows", costRowId, { final_acquire_unit: 60 })).toBeNull()
        expect(await live("final_approved")).toBeNull()
        expect(await live("prepared")).not.toBeNull()
    })

    it("keeps a cleared sign-off as history and allows one live signature", async () => {
        await signAll()
        expect((await rowsOf("final_approved")).length).toBeGreaterThan(1)
        expect((await rowsOf("final_approved")).filter((r) => r.cleared_at === null)).toHaveLength(1)
    })
})

describe("who reads the sign-offs", () => {
    it("serves every tier that reads the matrix the signature version with the sign-off", async () => {
        await signAll()
        for (const who of ["dealOwner", "outsider", "ipasSigner"]) {
            const { data, error } = await (await clientFor(who)).rpc("costing_matrix_read", { p_opportunity_id: sorId })
            expect(error, who).toBeNull()
            const prepared = data.tables.costing_signoffs.find((s) => s.role === "prepared" && s.cleared_at === null)
            expect(prepared, who).toBeTruthy()
            expect(prepared.signature_version, who).toBe(SIGNATURE)
        }
    })
})
