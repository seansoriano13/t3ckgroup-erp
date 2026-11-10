/**
 * #836: costing_matrix_header hands the S0 Evaluation header (S0 code, client, project, Sales
 * Reference, Deal Owner) to anyone with a costing tier on the SOR, and nothing to anyone without.
 *
 *   outsider   Purchasing                -> gets the header
 *   dealOwner  Deal Team                 -> gets the header
 *   finance    no costing tier           -> null, no error
 * Purchasing reads every SOR (costing_tier), so an SOR with no matrix still gives them the header.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()

let saleTypeId, flowId, stageId
let sorId, noMatrixSorId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}
const header = async (who, sor = sorId) => (await clientFor(who)).rpc("costing_matrix_header", { p_opportunity_id: sor })

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Header` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Header Stage`, sort_order: 10 }).select("id").single(), "stage")).id

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    noMatrixSorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId, noMatrixSorId)

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("costing_matrix_header (#836)", () => {
    it("gives a Purchasing user the header fields", async () => {
        const { data, error } = await header("outsider")
        expect(error).toBeNull()
        expect(data).toMatchObject({ id: sorId, deal_owner_id: ids.dealOwner })
        expect(Object.keys(data).sort()).toEqual(["client_name", "deal_owner_id", "id", "project_title", "sales_reference", "sor_code"])
    })

    it("gives the Deal Owner the same header", async () => {
        const { data, error } = await header("dealOwner")
        expect(error).toBeNull()
        expect(data.id).toBe(sorId)
    })

    it("answers null, not an error, to someone with no costing tier", async () => {
        const { data, error } = await header("finance")
        expect(error).toBeNull()
        expect(data).toBeNull()
    })

    it("still gives a Purchasing user the header on an SOR with no matrix", async () => {
        const { data, error } = await header("outsider", noMatrixSorId)
        expect(error).toBeNull()
        expect(data.id).toBe(noMatrixSorId)
    })
})
