/**
 * Costing Matrix, the summary's inputs, Final Acquire and the rates (#270, spec #266, tiers
 * from #319): who writes Final Acquire, Marketing and OPEX, who edits the rates and the signer
 * lists, and that the figures the summary is worked from reach the Closed Book tier alone.
 *
 * The summary itself is worked in the browser from what a tier received (costingMath.summary),
 * so what this file proves is the reading and writing it stands on.
 *
 * Loosened by 20261102170000: Sales, Purchasing and the Final Acquire list write Final Acquire,
 * Marketing and OPEX (Finance access too for the last two), and all of them read the Closed Book.
 *
 * The cast, on one SOR (dealOwner is its Deal Team):
 *   dealOwner           Deal Team                          -> closed_book, Sales band
 *   outsider            Purchasing access, no part in it   -> closed_book, Purchasing band
 *   stageParticipant    open Stage Participant window      -> participant tier
 *   finance             Finance access alone               -> no tier, Finance band
 *   ipasSigner          on the final_acquire list          -> closed_book, Management + Finance bands
 *   superAdmin                                             -> closed_book, Sales and Purchasing
 *   ordinary            nobody                             -> no tier
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, rlsStatus } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { tryInsert, tryDelete, RLS_VIOLATION } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"
import { MATRIX_MONEY_BANDS, MATRIX_MONEY_TIERS, COMPONENT_COST_TIERS } from "../../constants/costing.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId
let sorId, matrixId, lineId, componentId, costRowId
let originalRates
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

const history = async (who, args = {}) => {
    const { data, error } = await (await clientFor(who)).rpc("costing_history", { p_opportunity_id: sorId, ...args })
    if (error) throw new Error(`costing_history as ${who}: ${error.message}`)
    return data
}

/** Writes through costing_set_money as `who`: resolves to the RPC's error (null on success). */
const setMoney = async (who, table, row, patch) =>
    (await (await clientFor(who)).rpc("costing_set_money", { p_table: table, p_row: row, p_patch: patch })).error

const setCost = (who, patch) => setMoney(who, "costing_component_costs", componentId, patch)
const setMatrixMoney = (who, patch) => setMoney(who, "costing_matrix_money", matrixId, patch)

const moneyRow = async () => asSvc(svc().from("costing_matrix_money").select("*").eq("matrix_id", matrixId).single(), "money row")

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    originalRates = await asSvc(svc().from("costing_settings").select("*").eq("id", 1).single(), "settings row")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Summary` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (
        await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Summary Stage`, sort_order: 10 }).select("id").single(), "stage")
    ).id

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)

    const visit = await asSvc(svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).single(), "visit")
    await asSvc(
        svc().from("sor_stage_participants").insert({
            opportunity_id: sorId,
            employee_id: ids.stageParticipant,
            source: "action",
            opened_visit_id: visit.id,
            until_rule: "stage_left",
        }),
        "participant window",
    )

    await asSvc(svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.ipasSigner }), "signer list")

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data

    lineId = (
        await asSvc(
            svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Rescue tripod", quantity: 2, created_by: ids.dealOwner }).select("id").single(),
            "Tender Line",
        )
    ).id
    componentId = (
        await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position: 1, name: "Tripod head", quantity: 2 }).select("id").single(), "Component")
    ).id
    const row = await (await clientFor("outsider")).rpc("costing_add_cost_row", { p_matrix_id: matrixId, p_description: "Delivery Charge", p_quantity: 1, p_category_key: "logistics" })
    if (row.error) throw new Error(`costing_add_cost_row: ${row.error.message}`)
    costRowId = row.data
})

afterAll(async () => {
    await svc().from("costing_settings").update({
        vat_divisor: originalRates.vat_divisor,
        tax_rate: originalRates.tax_rate,
        retention_rate: originalRates.retention_rate,
        itr_rate: originalRates.itr_rate,
        itr_allowance: originalRates.itr_allowance,
    }).eq("id", 1)
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await svc().from("costing_signer_lists").delete().eq("employee_id", ids.superAdmin)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("Final Acquire", () => {
    it("lets a Super Admin, Purchasing and Sales write it, and refuses a Stage Participant, naming the bands", async () => {
        for (const [who, value] of [["superAdmin", 1001], ["outsider", 1002], ["dealOwner", 1003]]) {
            expect(await setCost(who, { final_acquire_unit: value }), who).toBeNull()
        }
        const refused = await setCost("stageParticipant", { final_acquire_unit: 1000 })
        expect(refused?.code).toBe(RLS_VIOLATION)
        expect(refused?.message).toBe("costing_band:costing_component_costs.final_acquire_unit:sales,purchasing,management")
        expect((await setCost("ordinary", { final_acquire_unit: 1000 }))?.code).toBe(RLS_VIOLATION)
        const cost = await asSvc(svc().from("costing_component_costs").select("final_acquire_unit").eq("component_id", componentId).single(), "cost")
        expect(Number(cost.final_acquire_unit)).toBe(1003)
    })

    it("lets a member of the list write it on a Component and on a cost-only row", async () => {
        expect(await setCost("ipasSigner", { final_acquire_unit: 17900 })).toBeNull()
        expect(await setMoney("ipasSigner", "costing_cost_rows", costRowId, { final_acquire_unit: 2500 })).toBeNull()
        const cost = await asSvc(svc().from("costing_component_costs").select("*").eq("component_id", componentId).single(), "cost")
        expect(Number(cost.final_acquire_unit)).toBe(17900)
        const row = await asSvc(svc().from("costing_cost_rows").select("*").eq("id", costRowId).single(), "cost row")
        expect(Number(row.final_acquire_unit)).toBe(2500)
    })

    it("lets a Super Admin off the list write a cost-only row's Final Acquire too", async () => {
        expect(await setMoney("superAdmin", "costing_cost_rows", costRowId, { final_acquire_unit: 2400 })).toBeNull()
        expect(await setMoney("ipasSigner", "costing_cost_rows", costRowId, { final_acquire_unit: 2500 })).toBeNull()
    })

    it("lets a Super Admin write it on the list or off it", async () => {
        await asSvc(svc().from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.superAdmin }), "list the Super Admin")
        try {
            expect(await setCost("superAdmin", { final_acquire_unit: 17950 })).toBeNull()
            const cost = await asSvc(svc().from("costing_component_costs").select("*").eq("component_id", componentId).single(), "cost")
            expect(Number(cost.final_acquire_unit)).toBe(17950)
        } finally {
            await svc().from("costing_signer_lists").delete().eq("employee_id", ids.superAdmin)
        }
        expect(await setCost("superAdmin", { final_acquire_unit: 17960 })).toBeNull()
    })

    it("clears Final Acquire back to blank with null", async () => {
        expect(await setCost("ipasSigner", { final_acquire_unit: null })).toBeNull()
        const cost = await asSvc(svc().from("costing_component_costs").select("*").eq("component_id", componentId).single(), "cost")
        expect(cost.final_acquire_unit).toBeNull()
    })
})

describe("Marketing and OPEX", () => {
    it("lets Purchasing, Sales and a Super Admin type them, and refuses a Stage Participant and a plain employee", async () => {
        for (const [who, value] of [["outsider", 11000], ["dealOwner", 11001], ["superAdmin", 11002]]) {
            expect(await setMatrixMoney(who, { marketing: value, opex: value }), who).toBeNull()
        }
        expect(Number((await moneyRow()).marketing)).toBe(11002)
        const refused = await setMatrixMoney("stageParticipant", { marketing: 12000 })
        expect(refused?.code).toBe(RLS_VIOLATION)
        expect(refused?.message).toBe("costing_band:costing_matrix_money.marketing:finance,sales,purchasing,management")
        expect((await setMatrixMoney("stageParticipant", { opex: 5 }))?.message).toBe("costing_band:costing_matrix_money.opex:finance,sales,purchasing,management")
        expect((await setMatrixMoney("ordinary", { marketing: 1 }))?.code).toBe(RLS_VIOLATION)
        await asSvc(svc().from("costing_matrix_money").update({ marketing: null, opex: null }).eq("matrix_id", matrixId), "money back")
    })

    it("lets Finance access type them, though Finance has no read tier on the SOR", async () => {
        expect(await setMatrixMoney("finance", { marketing: 12000.5, opex: 8000 })).toBeNull()
        const row = await moneyRow()
        expect(Number(row.marketing)).toBe(12000.5)
        expect(Number(row.opex)).toBe(8000)
        expect(await readMatrix("finance")).toBeNull()
    })

    it("lets a member of the Final Acquire list type them too", async () => {
        expect(await setMatrixMoney("ipasSigner", { marketing: 15000 })).toBeNull()
        expect(Number((await moneyRow()).marketing)).toBe(15000)
    })

    it("lets Finance access type them with nothing else, and refuses anything of another band in the same patch", async () => {
        const mixed = await setMoney("finance", "costing_component_costs", componentId, { final_acquire_unit: 1 })
        expect(mixed?.code).toBe(RLS_VIOLATION)
        const reachable = await setMoney("finance", "costing_matrix_money", matrixId, { marketing: 1, matrix_id: matrixId })
        expect(reachable?.code).toBe("22023")
    })

    it("refuses a negative Marketing or OPEX", async () => {
        expect((await setMatrixMoney("ipasSigner", { marketing: -1 }))?.code).toBe("23514")
        expect((await setMatrixMoney("ipasSigner", { opex: -1 }))?.code).toBe("23514")
    })

    it("records the change in the history for Closed Book only", async () => {
        const closed = await history("ipasSigner", { p_table: "costing_matrix_money" })
        expect(closed.some((e) => e.detail.column === "marketing" && e.actor_id === ids.ipasSigner && Number(e.detail.new) === 15000)).toBe(true)
        for (const who of ["dealOwner", "outsider"]) {
            const seen = await history(who, { p_table: "costing_matrix_money" })
            expect(seen.some((e) => e.detail.column === "marketing"), who).toBe(true)
        }
        const participant = await history("stageParticipant")
        expect(JSON.stringify(participant)).not.toMatch(/marketing|opex/)
    })
})

describe("who receives the summary's figures", () => {
    it("serves Closed Book the money row, Final Acquire, Marketing and OPEX", async () => {
        expect(await setCost("ipasSigner", { final_acquire_unit: 17900 })).toBeNull()
        for (const who of ["ipasSigner", "superAdmin", "dealOwner", "outsider"]) {
            const read = await readMatrix(who)
            expect(read.tier, who).toBe("closed_book")
            const money = read.tables.costing_matrix_money
            expect(money, who).toHaveLength(1)
            expect(Number(money[0].marketing), who).toBe(15000)
            expect(Number(money[0].opex), who).toBe(8000)
            expect(Number(read.tables.costing_component_costs[0].final_acquire_unit), who).toBe(17900)
            expect(Number(read.tables.costing_cost_rows[0].final_acquire_unit), who).toBe(2500)
        }
    })

    it("sends a Stage Participant no Final Acquire, Marketing or OPEX, the keys absent", async () => {
        for (const who of ["stageParticipant"]) {
            const read = await readMatrix(who)
            expect(read.tables.costing_matrix_money, who).toBeUndefined()
            const text = JSON.stringify(read)
            expect(text, who).not.toMatch(/final_acquire_unit|marketing|opex/)
        }
    })

    it("lets nobody but Closed Book select the money row directly", async () => {
        const count = async (who) => (await (await clientFor(who)).from("costing_matrix_money").select("matrix_id").eq("matrix_id", matrixId)).data.length
        for (const who of ["stageParticipant", "finance", "ordinary"]) expect(await count(who), who).toBe(0)
        for (const who of ["ipasSigner", "superAdmin", "dealOwner", "outsider"]) expect(await count(who), who).toBe(1)
    })

    it("matches the registries the screen mirrors in src/constants/costing.js", async () => {
        const tiers = await asSvc(svc().from("costing_column_tiers").select("column_name, tiers").eq("table_name", "costing_matrix_money"), "tiers")
        for (const [column, expected] of Object.entries(MATRIX_MONEY_TIERS)) {
            const row = tiers.find((t) => t.column_name === column)
            expect([...row.tiers].sort(), column).toEqual([...expected].sort())
        }
        const bands = await asSvc(svc().from("costing_column_bands").select("column_name, bands").eq("table_name", "costing_matrix_money"), "bands")
        for (const [column, expected] of Object.entries(MATRIX_MONEY_BANDS)) {
            const row = bands.find((b) => b.column_name === column)
            expect([...row.bands].sort(), column).toEqual([...expected].sort())
        }
        // The cost columns #268 registered still say what the screen says.
        const costTiers = await asSvc(svc().from("costing_column_tiers").select("column_name, tiers").eq("table_name", "costing_component_costs"), "cost tiers")
        expect([...costTiers.find((t) => t.column_name === "final_acquire_unit").tiers]).toEqual(COMPONENT_COST_TIERS.final_acquire_unit)
    })
})

describe("the rates", () => {
    it("starts with one row at the sheet's rates", async () => {
        const all = await asSvc(svc().from("costing_settings").select("*"), "settings")
        expect(all).toHaveLength(1)
        expect(all[0].id).toBe(1)
        // The migration's defaults; a test run on a database that has been edited since keeps its own.
        expect(Number(originalRates.vat_divisor)).toBeGreaterThanOrEqual(1)
    })

    it("lets any signed-in employee read the rates", async () => {
        for (const who of ["ordinary", "dealOwner", "outsider", "stageParticipant", "finance", "ipasSigner", "superAdmin"]) {
            const { data } = await (await clientFor(who)).from("costing_settings").select("id, tax_rate").eq("id", 1)
            expect(data, who).toHaveLength(1)
        }
    })

    it("lets Finance access change a rate, and stamps who did", async () => {
        const edit = await (await clientFor("finance")).from("costing_settings").update({ tax_rate: 0.05 }).eq("id", 1).select("tax_rate, updated_by")
        expect(edit.error).toBeNull()
        expect(Number(edit.data[0].tax_rate)).toBe(0.05)
        expect(edit.data[0].updated_by).toBe(ids.finance)
    })

    it("lets a Super Admin change a rate", async () => {
        const edit = await (await clientFor("superAdmin")).from("costing_settings").update({ itr_allowance: 300000 }).eq("id", 1).select("itr_allowance")
        expect(edit.error).toBeNull()
        expect(Number(edit.data[0].itr_allowance)).toBe(300000)
    })

    it("refuses Purchasing, Sales, the Final Acquire list and a plain employee", async () => {
        for (const who of ["outsider", "dealOwner", "ipasSigner", "stageParticipant", "ordinary"]) {
            const edit = await (await clientFor(who)).from("costing_settings").update({ tax_rate: 0.99 }).eq("id", 1).select("tax_rate")
            expect(edit.data ?? [], who).toHaveLength(0)
        }
        const now = await asSvc(svc().from("costing_settings").select("tax_rate").eq("id", 1).single(), "settings")
        expect(Number(now.tax_rate)).toBe(0.05)
    })

    it("refuses a second row, a delete and a rate outside its range", async () => {
        const second = await tryInsert(await clientFor("superAdmin"), "costing_settings", { id: 2 })
        expect(second.ok).toBe(false)
        const second2 = await svc().from("costing_settings").insert({ id: 2 })
        expect(second2.error).not.toBeNull()
        const gone = await (await clientFor("superAdmin")).from("costing_settings").delete().eq("id", 1)
        expect(gone.error).not.toBeNull()
        const tooHigh = await (await clientFor("finance")).from("costing_settings").update({ tax_rate: 1.5 }).eq("id", 1)
        expect(tooHigh.error?.code).toBe("23514")
        const lowDivisor = await (await clientFor("finance")).from("costing_settings").update({ vat_divisor: 0.5 }).eq("id", 1)
        expect(lowDivisor.error?.code).toBe("23514")
        const negative = await (await clientFor("finance")).from("costing_settings").update({ itr_allowance: -1 }).eq("id", 1)
        expect(negative.error?.code).toBe("23514")
    })

    it("has row level security on the rates", async () => {
        expect((await rlsStatus("costing_settings")).enabled).toBe(true)
    })
})

describe("the signer lists", () => {
    it("lets any signed-in employee read who is on a list", async () => {
        for (const who of ["ordinary", "dealOwner", "outsider", "finance", "ipasSigner"]) {
            const { data } = await (await clientFor(who)).from("costing_signer_lists").select("employee_id").eq("list_key", "final_acquire")
            expect(data.some((r) => r.employee_id === ids.ipasSigner), who).toBe(true)
        }
    })

    it("refuses a plain employee, Finance, Purchasing and the list's own members adding or removing", async () => {
        for (const who of ["ordinary", "finance", "outsider", "dealOwner", "ipasSigner"]) {
            const add = await tryInsert(await clientFor(who), "costing_signer_lists", { list_key: "final_acquire", employee_id: ids.ordinary })
            expect(add, who).toMatchObject({ ok: false, code: RLS_VIOLATION })
        }
        const row = await asSvc(svc().from("costing_signer_lists").select("id").eq("employee_id", ids.ipasSigner).eq("list_key", "final_acquire").single(), "row")
        for (const who of ["ordinary", "finance", "ipasSigner"]) {
            expect(await tryDelete(await clientFor(who), "costing_signer_lists", row.id), who).toEqual({ ok: true, affected: 0 })
        }
    })

    it("lets a Super Admin add and remove a member", async () => {
        const added = await (await clientFor("superAdmin")).from("costing_signer_lists").insert({ list_key: "final_acquire", employee_id: ids.checkByTwo }).select("id").single()
        expect(added.error).toBeNull()
        const removed = await tryDelete(await clientFor("superAdmin"), "costing_signer_lists", added.data.id)
        expect(removed).toEqual({ ok: true, affected: 1 })
    })

    it("seeds only employees whose call sign is 101 on the Final Acquire list", async () => {
        const rows = await asSvc(svc().from("costing_signer_lists").select("employee_id, employee:employees!costing_signer_lists_employee_id_fkey(call_sign)").eq("list_key", "final_acquire"), "list")
        const strangers = rows.filter((r) => r.employee_id !== ids.ipasSigner && r.employee?.call_sign !== "101")
        expect(strangers).toEqual([])
    })
})
