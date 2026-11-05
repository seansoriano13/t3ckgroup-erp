/**
 * Technical in-charge (#908, spec #907 decision 10): who may name the one Technical employee who judges an
 * SOR's S0 Evaluation, which employees can be named, and the Technical list the in-charge reads.
 *
 *   dealOwner        Deal Team (Sales band)           -> may name an in-charge, may not name a non-Technical one
 *   outsider         Purchasing access (Purchasing)   -> may name an in-charge
 *   superAdmin       Sales band, by Super Admin       -> may name an in-charge
 *   stageParticipant open window, no band             -> refused
 *   ordinary         no tier on the SOR               -> nothing written (the row is hidden)
 *   technical        named in-charge                  -> the Technical list shows the SOR, marked as theirs
 *   superAdmin       Super Admin                      -> the Technical list shows every in-charge's SOR
 *   outsider, dealOwner, anonymous                    -> no rows, or refused
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { tryUpdate } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()
const NOT_ALLOWED = "42501"
const NOT_TECHNICAL = "22023"

let saleTypeId, flowId, stageId, sor, matrix, lineA, lineB
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

/** Names the in-charge as the given cast member; `who` is the cast key. */
async function setInChargeAs(who, employeeId) {
    const client = await clientFor(who)
    const { data, error } = await client.from("costing_matrices").update({ technical_incharge_id: employeeId }).eq("id", matrix).select("id")
    if (error) return { ok: false, code: error.code, message: error.message }
    return { ok: true, affected: data.length }
}

const clearInCharge = () => asSvc(svc().from("costing_matrices").update({ technical_incharge_id: null }).eq("id", matrix), "clear in-charge")

const list = async (who) => (await clientFor(who)).rpc("costing_technical_list")
const rowFor = (data) => (data ?? []).find((r) => r.opportunity_id === sor)

beforeAll(async () => {
    await ensureCastLoaded()
    // Purchasing access (Purchasing band) and a stage participant window with no band.
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Technical In-charge` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Technical Stage`, sort_order: 10 }).select("id").single(), "stage")).id
    sor = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sor)
    const visit = await asSvc(svc().from("sor_stage_visits").select("id").eq("opportunity_id", sor).single(), "visit")
    // A plain employee (no Deal Team, no Purchasing access, no flags): a window alone grants no band.
    await asSvc(
        svc().from("sor_stage_participants").insert({
            opportunity_id: sor,
            employee_id: ids.checkByTwo,
            source: "action",
            opened_visit_id: visit.id,
            until_rule: "stage_left",
        }),
        "participant window",
    )
    matrix = (await svc().rpc("costing_open_matrix", { p_opportunity_id: sor })).data
    lineA = (await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrix, position: 1, tender_specification: "Line A", quantity: 1, created_by: ids.dealOwner }).select("id").single(), "line A")).id
    lineB = (await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrix, position: 2, tender_specification: "Line B", quantity: 1, created_by: ids.dealOwner }).select("id").single(), "line B")).id
    await asSvc(svc().from("costing_components").insert([{ tender_line_id: lineA, position: 1, name: "Hose", quantity: 1 }, { tender_line_id: lineB, position: 1, name: "Gauge", quantity: 1 }]), "components")
})

afterAll(async () => {
    await svc().from("employees").update({ sub_department: null }).eq("id", ids.ipasSigner)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("who may name the Technical in-charge", () => {
    it("lets the Deal Team (Sales) name a Technical employee", async () => {
        await clearInCharge()
        expect(await setInChargeAs("dealOwner", ids.technical)).toEqual({ ok: true, affected: 1 })
        const row = await asSvc(svc().from("costing_matrices").select("technical_incharge_id").eq("id", matrix).single(), "matrix")
        expect(row.technical_incharge_id).toBe(ids.technical)
    })

    it("lets Purchasing name it too, and a Super Admin", async () => {
        await clearInCharge()
        expect(await setInChargeAs("outsider", ids.technical)).toEqual({ ok: true, affected: 1 })
        await clearInCharge()
        expect(await setInChargeAs("superAdmin", ids.technical)).toEqual({ ok: true, affected: 1 })
    })

    it("refuses a participant with no band, and writes nothing for someone with no tier", async () => {
        await clearInCharge()
        const refused = await setInChargeAs("checkByTwo", ids.technical)
        expect(refused).toMatchObject({ ok: false, code: NOT_ALLOWED })
        expect(refused.message).toBe("costing_band:costing_matrices.technical_incharge_id:sales,purchasing")
        // Finance access alone, with no window and no Deal Team: no tier, so the row is hidden.
        expect(await setInChargeAs("finance", ids.technical)).toEqual({ ok: true, affected: 0 })
        await asSvc(svc().from("costing_matrices").update({ technical_incharge_id: ids.technical }).eq("id", matrix), "restore in-charge")
    })

    it("refuses an employee who is not in the Technical sub-department", async () => {
        for (const who of [ids.dealOwner, ids.ordinary, ids.head]) {
            const { error } = await (await clientFor("dealOwner")).from("costing_matrices").update({ technical_incharge_id: who }).eq("id", matrix)
            expect(error?.code, who).toBe(NOT_TECHNICAL)
            expect(error?.message, who).toBe("costing_technical: the Technical in-charge must be an employee in the Technical sub-department")
        }
    })

    it("refuses a deleted Technical employee", async () => {
        await asSvc(svc().from("employees").update({ is_deleted: true }).eq("id", ids.technical), "delete")
        try {
            const { error } = await svc().from("costing_matrices").update({ technical_incharge_id: null }).eq("id", matrix).select("id")
            expect(error).toBeNull()
            const named = await svc().from("costing_matrices").update({ technical_incharge_id: ids.technical }).eq("id", matrix)
            expect(named.error?.code).toBe(NOT_TECHNICAL)
        } finally {
            await asSvc(svc().from("employees").update({ is_deleted: false }).eq("id", ids.technical), "restore")
        }
    })

    it("reads sub-department with trim and no regard to case", async () => {
        await asSvc(svc().from("employees").update({ sub_department: "  technical " }).eq("id", ids.ipasSigner), "padded sub-department")
        try {
            expect(await setInChargeAs("dealOwner", ids.ipasSigner)).toEqual({ ok: true, affected: 1 })
        } finally {
            await svc().from("employees").update({ sub_department: null }).eq("id", ids.ipasSigner)
            await setInChargeAs("dealOwner", ids.technical)
        }
    })
})

describe("the Technical list", () => {
    it("shows the in-charge their SOR, with its lines and no verdict yet", async () => {
        const row = rowFor((await list("technical")).data)
        expect(row).toMatchObject({ team: "Technical", rows_total: 2, rows_judged: 0, approved: false, is_mine: true })
        expect(row.sor_code).toMatch(/^SOR-\d+$/)
    })

    it("counts the SOR as checked once the in-charge gives the verdict", async () => {
        const verdict = await tryUpdate(await clientFor("technical"), "costing_matrices", matrix, { compliance: "complies" })
        expect(verdict).toEqual({ ok: true, affected: 1 })
        expect(rowFor((await list("technical")).data)).toMatchObject({ rows_total: 2, rows_judged: 2 })
    })

    it("shows a Super Admin every in-charge's SOR, and none of them is theirs", async () => {
        const row = rowFor((await list("superAdmin")).data)
        expect(row).toMatchObject({ is_mine: false })
    })

    it("shows nothing to someone who is not the in-charge", async () => {
        expect(rowFor((await list("outsider")).data)).toBeUndefined()
        expect(rowFor((await list("dealOwner")).data)).toBeUndefined()
    })

    it("carries no money column", async () => {
        const row = rowFor((await list("technical")).data)
        expect(Object.keys(row).join(",")).not.toMatch(/offer|acquire|price|cost|landed|revenue/i)
    })

    it("refuses someone not signed in", async () => {
        const { error } = await anonymousClient().rpc("costing_technical_list")
        expect(error).not.toBeNull()
    })

    it("leaves out a SOR once its in-charge is cleared", async () => {
        await asSvc(svc().from("costing_matrices").update({ technical_incharge_id: null }).eq("id", matrix), "clear in-charge")
        expect(rowFor((await list("technical")).data)).toBeUndefined()
        await setInChargeAs("dealOwner", ids.technical)
    })
})
