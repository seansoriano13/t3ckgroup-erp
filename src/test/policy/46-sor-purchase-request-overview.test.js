/**
 * The SOR's view of its Purchase Request (#310, part of #209):
 * `sor_purchase_request_overview` gives the Buyer and Requested Items to
 * whoever can read the request, and nothing to anyone else, including a
 * Deal Team member who was left out. No request, no rows.
 *
 * `outsider` is given Purchasing access. `dealOwner` is a member (sales),
 * `ordinary` is nobody to the request.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded, anonymousClient } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
let sorWith, sorWithout, requestId

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

const overview = async (who, sorId) => {
    const { data, error } = await (await clientFor(who)).rpc("sor_purchase_request_overview", { p_opportunity_id: sorId })
    if (error) throw error
    return data
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    sorWith = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorWithout = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    requestId = await insert("purchase_requests", {
        opportunity_id: sorWith,
        created_by: ids.dealOwner,
        buyer_id: ids.stageParticipant,
    })
    await insert("purchase_request_members", { request_id: requestId, employee_id: ids.dealOwner, side: "sales" })
    await insert("purchase_request_members", { request_id: requestId, employee_id: ids.stageParticipant, side: "purchasing" })
    for (const [name, status] of [["Carabiner", "not_checked"], ["Rope", "received"]]) {
        await insert("purchase_request_items", {
            request_id: requestId,
            source: "new",
            name: `${MARKER} ${name}`,
            quantity: 2,
            status,
            requested_by: ids.dealOwner,
        })
    }
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await svc().from("sor_stage_participants").delete().eq("source_id", requestId)
    await svc().from("purchase_requests").delete().eq("id", requestId)
    await svc().from("sales_opportunities").delete().in("id", [sorWith, sorWithout])
})

describe("sor_purchase_request_overview", () => {
    it("gives a member the Buyer and every item", async () => {
        const rows = await overview("dealOwner", sorWith)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ request_id: requestId, buyer_id: ids.stageParticipant })
        expect(rows[0].buyer_name).toBeTruthy()
        expect(rows[0].items.map((i) => i.status).sort()).toEqual(["not_checked", "received"])
        expect(rows[0].items[0]).toHaveProperty("odoo_product_id")
    })

    it("gives the Buyer the same, though they are not on the deal", async () => {
        expect(await overview("stageParticipant", sorWith)).toHaveLength(1)
    })

    it("gives nothing to someone who can't read the request, even with Purchasing access once it has a Buyer", async () => {
        expect(await overview("outsider", sorWith)).toEqual([])
        expect(await overview("ordinary", sorWith)).toEqual([])
    })

    it("gives nothing for an SOR with no Purchase Request", async () => {
        expect(await overview("dealOwner", sorWithout)).toEqual([])
    })

    it("is refused to the signed-out", async () => {
        const { error } = await anonymousClient().rpc("sor_purchase_request_overview", { p_opportunity_id: sorWith })
        expect(error).not.toBeNull()
    })
})
