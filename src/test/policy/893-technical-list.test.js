/**
 * The Technical list (#706): costing_technical_list() gives a member of the RRD or IOE team the SORs with
 * rows given to their team, with counts and no money, and a Super Admin every team's. Nobody else reads it.
 * Giving a row to a team notifies the team once per SOR, until the notice is read.
 *
 *   ordinary     on team_rrd              -> RRD rows only
 *   ipasSigner   on team_ioe              -> IOE rows only
 *   superAdmin                            -> both teams' rows
 *   dealOwner    Deal Team, on no team    -> refused
 *   outsider     Purchasing access        -> refused
 *   anonymous                             -> refused
 *
 * One SOR with two Tender Lines: Line 1 (two Components) is RRD's, Line 2 (one Component) is IOE's; a third
 * Tender Line has no team. One RRD Component is judged.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()
const NOT_ALLOWED = "42501"
const TYPE = "COSTING_EVALUATION_ASSIGNED"

let saleTypeId, flowId, stageId, sor, matrix, lineRrd, lineIoe, lineNone
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}
const list = async (who) => (await clientFor(who)).rpc("costing_technical_list")
const teamRows = (data) => (data ?? []).filter((r) => r.opportunity_id === sor)
const notices = async (who) => (await svc().from("notifications").select("*").eq("type", TYPE).eq("reference_id", sor).eq("recipient_id", ids[who])).data

beforeAll(async () => {
    await ensureCastLoaded()
    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Technical List` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Tech Stage`, sort_order: 10 }).select("id").single(), "stage")).id
    sor = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sor)
    await asSvc(
        svc().from("costing_signer_lists").insert([
            { list_key: "team_rrd", employee_id: ids.ordinary },
            { list_key: "team_ioe", employee_id: ids.ipasSigner },
        ]),
        "team lists",
    )
    matrix = (await svc().rpc("costing_open_matrix", { p_opportunity_id: sor })).data
    const makeLine = async (position, team) =>
        (await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrix, position, tender_specification: `Line ${position}`, quantity: 1, created_by: ids.dealOwner, evaluating_team: team }).select("id").single(), "line")).id
    const makeComponent = async (lineId, position, name, compliance) =>
        (await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position, name, quantity: 1, compliance }).select("id").single(), name)).id
    lineRrd = await makeLine(1, "RRD")
    lineIoe = await makeLine(2, "IOE")
    lineNone = await makeLine(3, null)
    await makeComponent(lineRrd, 1, "Hose", "complies")
    await makeComponent(lineRrd, 2, "Gauge", null)
    await makeComponent(lineIoe, 1, "Tape", null)
    await makeComponent(lineNone, 1, "Rope", null)
})

afterAll(async () => {
    await svc().from("notifications").delete().eq("type", TYPE).eq("reference_id", sor)
    await svc().from("costing_signer_lists").delete().in("employee_id", [ids.ordinary, ids.ipasSigner])
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("who reads the Technical list", () => {
    it("gives an RRD member the RRD rows only, with counts", async () => {
        const { data, error } = await list("ordinary")
        expect(error).toBeNull()
        const rows = teamRows(data)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ team: "RRD", rows_total: 2, rows_judged: 1, approved: false, is_mine: true })
        expect(rows[0].sor_code).toMatch(/^SOR-\d+$/)
    })

    it("gives an IOE member the IOE rows only", async () => {
        const rows = teamRows((await list("ipasSigner")).data)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ team: "IOE", rows_total: 1, rows_judged: 0 })
    })

    it("gives a Super Admin both teams, and never the row with no team", async () => {
        const rows = teamRows((await list("superAdmin")).data)
        expect(rows.map((r) => r.team).sort()).toEqual(["IOE", "RRD"])
        // A Super Admin on no team reads both teams' rows but none is theirs to judge.
        expect(rows.every((r) => r.is_mine === false)).toBe(true)
    })

    it("carries no money column", async () => {
        const row = teamRows((await list("ordinary")).data)[0]
        expect(Object.keys(row).join(",")).not.toMatch(/offer|acquire|price|cost|landed|revenue/i)
    })

    it.each(["dealOwner", "outsider"])("refuses %s, who is on no team", async (who) => {
        const { error } = await list(who)
        expect(error?.code).toBe(NOT_ALLOWED)
    })

    it("refuses someone not signed in", async () => {
        const { error } = await anonymousClient().rpc("costing_technical_list")
        expect(error).not.toBeNull()
    })
})

describe("telling the team its rows are waiting", () => {
    it("notified each member of the team that was given rows, once, and not the other team", async () => {
        // The rows were inserted with their teams by the service role: the trigger told the members.
        expect(await notices("ordinary")).toHaveLength(1)
        expect(await notices("ipasSigner")).toHaveLength(1)
        const [rrd] = await notices("ordinary")
        expect(rrd.title).toBe("Rows waiting for RRD")
        expect(rrd.message).toMatch(/rows are waiting for RRD to judge/)
    })

    it("does not repeat an unread notice when another row is given to the same team", async () => {
        const extra = (await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrix, position: 4, tender_specification: "Line 4", quantity: 1, created_by: ids.dealOwner, evaluating_team: "RRD" }).select("id").single(), "line")).id
        expect(await notices("ordinary")).toHaveLength(1)
        await svc().from("costing_tender_lines").delete().eq("id", extra)
    })

    it("tells the team again once the first notice is read", async () => {
        await svc().from("notifications").update({ is_read: true }).eq("type", TYPE).eq("reference_id", sor).eq("recipient_id", ids.ordinary)
        await asSvc(svc().from("costing_tender_lines").update({ evaluating_team: null }).eq("id", lineRrd), "clear team")
        await asSvc(svc().from("costing_tender_lines").update({ evaluating_team: "RRD" }).eq("id", lineRrd), "give team")
        expect(await notices("ordinary")).toHaveLength(2)
    })
})
