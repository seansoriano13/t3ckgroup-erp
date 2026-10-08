/**
 * Follow-ups to #209: the Buyer hears when the SOR is deleted, and someone
 * granted Purchasing access later joins the requests still being worked.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const requests = []
const sors = []

async function newRequest({ buyer = null, itemStatus = "requested" } = {}) {
    const sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sors.push(sorId)
    const { data, error } = await svc()
        .from("purchase_requests")
        .insert({ opportunity_id: sorId, created_by: ids.dealOwner, buyer_id: buyer ? ids[buyer] : null })
        .select("id")
        .single()
    if (error) throw new Error(error.message)
    requests.push(data.id)
    if (buyer) {
        const m = await svc().from("purchase_request_members").insert({ request_id: data.id, employee_id: ids[buyer], side: "purchasing" })
        if (m.error) throw new Error(m.error.message)
    }
    const i = await svc()
        .from("purchase_request_items")
        .insert({ request_id: data.id, source: "new", name: "Cable", quantity: 1, status: itemStatus, requested_by: ids.dealOwner })
    if (i.error) throw new Error(i.error.message)
    return { id: data.id, sorId }
}

beforeAll(ensureCastLoaded)

afterAll(async () => {
    await sql().query("update employees set has_purchasing_flow = false where id = $1", [ids.hr])
    if (requests.length) {
        await svc().from("notifications").delete().in("reference_id", requests)
        await svc().from("purchase_requests").delete().in("id", requests)
    }
    if (sors.length) await svc().from("sales_opportunities").delete().in("id", sors)
})

describe("SOR deleted", () => {
    it("tells the Buyer once while items are open", async () => {
        const { id, sorId } = await newRequest({ buyer: "outsider" })
        await sql().query("update sales_opportunities set is_deleted = true where id = $1", [sorId])
        const { data } = await svc().from("notifications").select("recipient_id, type").eq("reference_id", id)
        expect(data).toEqual([{ recipient_id: ids.outsider, type: "PURCHASE_REQUEST_SOR_CLOSED" }])
    })

    it("stays quiet once every item is closed", async () => {
        const { id, sorId } = await newRequest({ buyer: "outsider", itemStatus: "received" })
        await sql().query("update sales_opportunities set is_deleted = true where id = $1", [sorId])
        const { data } = await svc().from("notifications").select("id").eq("reference_id", id)
        expect(data).toEqual([])
    })
})

describe("someone granted Purchasing access later", () => {
    it("joins a request with open items but not a finished one", async () => {
        const live = await newRequest()
        const done = await newRequest({ itemStatus: "cancelled" })
        await sql().query("update employees set has_purchasing_flow = true where id = $1", [ids.hr])
        const { data } = await svc()
            .from("purchase_request_members")
            .select("request_id, side")
            .eq("employee_id", ids.hr)
            .in("request_id", [live.id, done.id])
        expect(data).toEqual([{ request_id: live.id, side: "purchasing" }])
    })
})
