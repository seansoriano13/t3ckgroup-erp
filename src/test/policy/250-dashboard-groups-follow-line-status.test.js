/**
 * #690 (spec #675): the Purchasing Dashboard's groups are read from the stored line status.
 * Not checked, To purchase, Still canvassing and Purchased (grp on_order) each count the lines
 * at that status; a Purchased line carries its delivery note; once Received it leaves the groups.
 * A Cancelled line is in none. One SOR sits in as many groups as apply.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor } from "./support/rows.js"

const svc = () => serviceClient()
let sorId, requestId
const itemIds = {}

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const mine = async () => {
    const { data, error } = await (await clientFor("outsider")).rpc("purchasing_dashboard_rows")
    if (error) throw new Error(error.message)
    return (data ?? []).filter((row) => row.opportunity_id === sorId)
}
const group = (rows, grp) => rows.filter((row) => row.grp === grp)
const count = (rows, grp) => group(rows, grp).reduce((sum, row) => sum + row.item_count, 0)

async function addItem(name, fields) {
    const row = await asSvc(
        svc().from("purchase_request_items").insert({ request_id: requestId, name, source: "new", requested_by: ids.dealOwner, ...fields }).select("id").single(),
        name,
    )
    itemIds[name] = row.id
    return row.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    requestId = (
        await asSvc(svc().from("purchase_requests").insert({ opportunity_id: sorId, created_by: ids.dealOwner, buyer_id: ids.outsider }).select("id").single(), "request")
    ).id
    await addItem("Unchecked", { status: "not_checked" })
    await addItem("Buy me", { status: "to_purchase" })
    await addItem("Buy me too", { status: "to_purchase" })
    await addItem("Canvassing", { status: "still_canvassing" })
    await addItem("Waiting", { status: "purchased", po_ordered: 5, po_received: 0, po_eta: "2026-11-12" })
    await addItem("Cancelled", { status: "cancelled" })
})

afterAll(async () => {
    await svc().from("purchase_request_items").delete().eq("request_id", requestId)
    await svc().from("purchase_requests").delete().eq("id", requestId)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("groups follow the stored line status", () => {
    it("counts each status in its own group and leaves Cancelled out", async () => {
        const rows = await mine()
        expect(count(rows, "not_checked")).toBe(1)
        expect(count(rows, "to_purchase")).toBe(2)
        expect(count(rows, "still_canvassing")).toBe(1)
        expect(count(rows, "on_order")).toBe(1)
        expect(rows.flatMap((row) => row.item_count).reduce((a, b) => a + b, 0)).toBe(5)
    })

    it("opens the request from each group", async () => {
        const rows = await mine()
        for (const grp of ["not_checked", "to_purchase", "still_canvassing", "on_order"]) {
            expect(group(rows, grp)[0]).toMatchObject({ target_kind: "purchase_request", target_id: requestId, request_id: requestId })
        }
    })
})

describe("the Purchased delivery note", () => {
    it("says Not received yet with the ETA", async () => {
        expect(group(await mine(), "on_order")[0].delivery_note).toBe("Not received yet · ETA Nov 12")
    })

    it("says no ETA set when Odoo has none", async () => {
        await asSvc(svc().from("purchase_request_items").update({ po_eta: null }).eq("id", itemIds.Waiting), "clear eta")
        expect(group(await mine(), "on_order")[0].delivery_note).toBe("Not received yet · no ETA set")
    })

    it("says x of y received after a part receipt", async () => {
        await asSvc(svc().from("purchase_request_items").update({ po_received: 3 }).eq("id", itemIds.Waiting), "part receipt")
        expect(group(await mine(), "on_order")[0].delivery_note).toBe("3 of 5 received")
    })

    it("has no note outside Purchased", async () => {
        const rows = await mine()
        for (const grp of ["not_checked", "to_purchase", "still_canvassing"]) expect(group(rows, grp)[0].delivery_note).toBeNull()
    })
})

describe("a Received line leaves the groups", () => {
    it("drops out of Purchased (not received)", async () => {
        await asSvc(svc().from("purchase_request_items").update({ status: "received", po_received: 5 }).eq("id", itemIds.Waiting), "receive")
        const rows = await mine()
        expect(count(rows, "on_order")).toBe(0)
        expect(count(rows, "not_checked") + count(rows, "to_purchase") + count(rows, "still_canvassing")).toBe(4)
    })
})
