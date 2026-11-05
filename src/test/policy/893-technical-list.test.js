/**
 * Who can see the Technical list (#877, restored for the in-charge model in #908; spec #907 decision 10). The list
 * is the S0 Evaluations whose Technical in-charge is the caller. The RRD and IOE teams are retired, so being on
 * an old team list gives nothing.
 *
 *   technical     named Technical in-charge     -> the SOR, marked as theirs
 *   ordinary      on no tier, no in-charge      -> nothing (the old team list does not count)
 *   superAdmin    Super Admin                   -> every in-charge's SOR, none marked as theirs
 *   dealOwner     Deal Team, not the in-charge  -> nothing
 *   outsider      Purchasing access             -> nothing
 *   anonymous                                    -> refused
 *   cleared       in-charge removed             -> the SOR leaves the list
 *
 * Carries no money: the row has SOR names and counts only.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId, sor, matrix

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const list = async (who) => (await clientFor(who)).rpc("costing_technical_list")
const rowFor = (data) => (data ?? []).find((r) => r.opportunity_id === sor)

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Technical List` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Tech Stage`, sort_order: 10 }).select("id").single(), "stage")).id
    sor = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    matrix = (await svc().rpc("costing_open_matrix", { p_opportunity_id: sor })).data
    await asSvc(svc().from("costing_matrices").update({ technical_incharge_id: ids.technical }).eq("id", matrix), "name in-charge")
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors([sor])
    await svc().from("sales_opportunities").delete().eq("id", sor)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("who sees the Technical list", () => {
    it("shows the named in-charge their SOR, marked as theirs", async () => {
        const row = rowFor((await list("technical")).data)
        expect(row).toMatchObject({ team: "Technical", is_mine: true })
        expect(row.sor_code).toMatch(/^SOR-\d+$/)
    })

    it("shows a Super Admin the SOR, but not as theirs", async () => {
        expect(rowFor((await list("superAdmin")).data)).toMatchObject({ is_mine: false })
    })

    it("gives an ordinary employee nothing", async () => {
        expect(rowFor((await list("ordinary")).data)).toBeUndefined()
    })

    it.each(["dealOwner", "outsider"])("shows %s nothing, since they are not the in-charge", async (who) => {
        expect(rowFor((await list(who)).data)).toBeUndefined()
    })

    it("refuses someone not signed in", async () => {
        const { error } = await anonymousClient().rpc("costing_technical_list")
        expect(error).not.toBeNull()
    })

    it("carries no money column", async () => {
        const row = rowFor((await list("technical")).data)
        expect(Object.keys(row).join(",")).not.toMatch(/offer|acquire|price|cost|landed|revenue/i)
    })

    it("leaves the SOR off the list once the in-charge is cleared", async () => {
        await asSvc(svc().from("costing_matrices").update({ technical_incharge_id: null }).eq("id", matrix), "clear in-charge")
        expect(rowFor((await list("technical")).data)).toBeUndefined()
        await asSvc(svc().from("costing_matrices").update({ technical_incharge_id: ids.technical }).eq("id", matrix), "restore in-charge")
    })
})
