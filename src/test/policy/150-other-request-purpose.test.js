/**
 * Ask for a product (#679, spec #675; 20261104150000_other_request_purpose.sql).
 *
 * Sales, a deal member and Purchasing can each add an Other request: the asker's words, a
 * quantity above zero, optional photos, and what it is for ("client" or "job"). It lands at Not
 * checked, with who asked. Someone who may not add items is refused by the database. Material for
 * the job can never be an S0 line's item.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
let sorId, requestId

const ask = async (who, args) =>
    (await clientFor(who)).rpc("purchase_request_add_new_item", { p_request_id: requestId, p_name: `${MARKER} Tarpaulin`, p_quantity: 2, ...args })

const itemOf = async (id) => (await svc().from("purchase_request_items").select("*").eq("id", id).single()).data

beforeAll(async () => {
    await ensureCastLoaded()
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    const { data, error } = await svc()
        .from("purchase_requests")
        .insert({ opportunity_id: sorId, created_by: ids.dealOwner, buyer_id: ids.stageParticipant })
        .select("id")
        .single()
    if (error) throw error
    requestId = data.id
})

afterAll(async () => {
    await svc().from("purchase_requests").delete().eq("id", requestId)
    await svc().from("sales_opportunity_items").delete().eq("opportunity_id", sorId)
    await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("who may ask", () => {
    it.each(["dealOwner", "stageParticipant"])("lets %s add an ask, For the client by default, at Not checked", async (who) => {
        const { data, error } = await ask(who, {})
        expect(error).toBeNull()
        expect(await itemOf(data)).toMatchObject({
            source: "new",
            sor_item_id: null,
            status: "not_checked",
            purpose: "client",
            requested_by: ids[who],
        })
    })

    it("keeps Material for the job and the photos", async () => {
        const images = [{ url: "https://example.test/a.jpg", name: "a.jpg" }]
        const { data, error } = await ask("dealOwner", { p_purpose: "job", p_images: images })
        expect(error).toBeNull()
        expect(await itemOf(data)).toMatchObject({ purpose: "job", images })
    })

    it("refuses someone who may not add items", async () => {
        const { error } = await ask("outsider", {})
        expect(error?.code).toBe("42501")
    })
})

describe("what an ask needs", () => {
    it.each([0, -1, null])("refuses a quantity of %s", async (qty) => {
        expect((await ask("dealOwner", { p_quantity: qty })).error?.code).toBe("22023")
    })

    it("refuses an empty description", async () => {
        expect((await ask("dealOwner", { p_name: "   " })).error?.code).toBe("22023")
    })

    it("refuses a purpose that is neither", async () => {
        expect((await ask("dealOwner", { p_purpose: "other" })).error?.code).toBe("22023")
    })
})

describe("materials never become S0 lines", () => {
    it("refuses job on an item that has an S0 line", async () => {
        const { data: line } = await svc()
            .from("sales_opportunity_items")
            .insert({ opportunity_id: sorId, product_name: `${MARKER} Rope`, quantity: 1, unit: "pc", unit_price: 1 })
            .select("id")
            .single()
        const { data: item } = await svc().from("purchase_request_items").select("id").eq("sor_item_id", line.id).maybeSingle()
        if (!item) return
        const { error } = await svc().from("purchase_request_items").update({ purpose: "job" }).eq("id", item.id)
        expect(error?.code).toBe("23514")
    })
})
