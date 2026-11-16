/**
 * Replace a product with another (#687, spec #675; 20261104200000_replace_a_product.sql).
 *
 * purchase_request_replace_item cancels A with the reason, stops A's open Canvass, and adds B to
 * Other requests with A's quantity, all in one call. An S0 line is flagged "S0 still lists A" and
 * Sales is told in the request chat. Only Purchasing may; a reason is required; a Cancelled or
 * Received line cannot be replaced.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const NO_ID = "00000000-0000-0000-0000-000000000000"
const NOT_ALLOWED = "42501"
const REFUSED = "22023"

let sorId, requestId
const sorIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}
const itemRow = async (id) => asSvc(svc().from("purchase_request_items").select("*").eq("id", id).single(), "item")
const makeItem = async (fields = {}) =>
    (
        await asSvc(
            svc().from("purchase_request_items").insert({ request_id: requestId, name: `${MARKER} Item`, quantity: 3, unit: "pc", source: "new", requested_by: ids.dealOwner, ...fields }).select("id").single(),
            "item",
        )
    ).id
const replace = async (who, itemId, name, reason) => (await clientFor(who)).rpc("purchase_request_replace_item", { p_item_id: itemId, p_name: name, p_reason: reason })

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorIds.push(sorId)
    await asSvc(svc().from("sales_opportunity_items").insert({ opportunity_id: sorId, product_name: `${MARKER} Stretcher`, unit: "pc", quantity: 2, unit_price: 100, odoo_line_id: 9201 }), "SOR line")
    requestId = (await asSvc(svc().from("purchase_requests").insert({ opportunity_id: sorId, created_by: ids.dealOwner }).select("id").single(), "request")).id
    for (const [employee_id, side] of [[ids.dealOwner, "sales"], [ids.outsider, "purchasing"]]) {
        await asSvc(svc().from("purchase_request_members").upsert({ request_id: requestId, employee_id, side }, { onConflict: "request_id,employee_id" }), "member")
    }
})

afterAll(async () => {
    await svc().from("request_canvasses").delete().eq("request_id", requestId ?? NO_ID)
    await svc().from("purchase_request_items").delete().eq("request_id", requestId ?? NO_ID)
    await svc().from("purchase_request_members").delete().eq("request_id", requestId ?? NO_ID)
    await svc().from("purchase_requests").delete().eq("id", requestId ?? NO_ID)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await svc().from("sales_opportunity_items").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
})

describe("Replace", () => {
    it("cancels A with the reason and adds B, in one call; A's quotes stay as the record", async () => {
        const a = await makeItem({ status: "to_purchase" })
        const found = (await svc().from("request_canvasses").select("id").eq("request_id", requestId).maybeSingle()).data
        const canvass = found ?? (await asSvc(svc().from("request_canvasses").insert({ request_id: requestId, number: "x", created_by: ids.outsider }).select("id").single(), "Canvass"))
        const supplier = await asSvc(svc().from("request_canvass_suppliers").insert({ canvass_id: canvass.id, supplier_name: `${MARKER} Replace` }).select("id").single(), "supplier")
        await asSvc(svc().from("request_canvass_quotes").insert({ canvass_id: canvass.id, supplier_id: supplier.id, item_id: a }), "quote")

        const { data: bId, error } = await replace("outsider", a, "Other brand", "Brand out of stock")
        expect(error).toBeNull()

        expect(await itemRow(a)).toMatchObject({ status: "cancelled", replaced_reason: "Brand out of stock", s0_still_lists: false })
        expect(await itemRow(bId)).toMatchObject({ name: "Other brand", quantity: 3, unit: "pc", status: "not_checked", source: "new", substitute_for_item_id: a, sor_item_id: null })
        const kept = await asSvc(svc().from("request_canvass_quotes").select("id").eq("item_id", a), "quotes")
        expect(kept).toHaveLength(1)
    })

    it("flags an S0 line, tells Sales in the chat, and Purchasing is not blocked", async () => {
        const line = await asSvc(svc().from("purchase_request_items").select("id").eq("request_id", requestId).not("sor_item_id", "is", null).single(), "S0 item")
        const { error } = await replace("outsider", line.id, "Stretcher, other make", "Spec change")
        expect(error).toBeNull()
        expect(await itemRow(line.id)).toMatchObject({ status: "cancelled", s0_still_lists: true })
        const events = await asSvc(svc().from("purchase_request_messages").select("content, metadata").eq("request_id", requestId), "chat")
        expect(events.some((e) => e.metadata?.event === "s0_still_lists" && e.metadata?.item_id === line.id && /Sales to update the S0/.test(e.content))).toBe(true)
    })

    it("refuses a missing reason or name, and changes nothing", async () => {
        const a = await makeItem({ status: "to_purchase" })
        for (const [name, reason] of [["Other brand", "  "], ["  ", "Why"]]) {
            const { error } = await replace("outsider", a, name, reason)
            expect(error?.code).toBe(REFUSED)
        }
        expect((await itemRow(a)).status).toBe("to_purchase")
    })

    it("is for Purchasing only", async () => {
        const a = await makeItem({ status: "to_purchase" })
        const { error } = await replace("dealOwner", a, "Other brand", "Why")
        expect(error?.code).toBe(NOT_ALLOWED)
        expect((await itemRow(a)).status).toBe("to_purchase")
    })

    it.each(["cancelled", "received"])("is off on a %s line", async (status) => {
        const a = await makeItem({ status })
        const { error } = await replace("outsider", a, "Other brand", "Why")
        expect(error?.code).toBe(REFUSED)
    })
})
