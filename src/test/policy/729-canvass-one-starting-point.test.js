/**
 * One starting point for a Canvass (#729, spec #718, ADR 0047).
 *
 * A Canvass starts on a product line (a project line, or a line of a Direct request), never against
 * nothing. Creating a free-standing Canvass and making a Purchase Request from Canvasses are refused;
 * Canvasses that already exist stay readable.
 *
 * The cast: outsider has Purchasing access; ordinary opens the Direct request.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { coverSlots } from "./support/canvassSlots.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const BAD_INPUT = "22023"

const canvasses = []
const requests = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

const start = async (who, args) =>
    (await clientFor(who)).rpc("canvass_start", {
        p_component_id: null,
        p_requested_item_id: null,
        p_product_name: null,
        p_offer: { supplier_name: "Redleaf Inc.", currency: "PHP" },
        p_price: { unit_price: 1200 },
        ...args,
    })

const countNamed = async (name) =>
    (await svc().from("sor_canvasses").select("id", { count: "exact", head: true }).eq("product_name", name)).count

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
})

afterAll(async () => {
    if (canvasses.length) await svc().from("sor_canvasses").delete().in("id", canvasses)
    if (requests.length) await svc().from("purchase_requests").delete().in("id", requests)
})

describe("a new free-standing Canvass is refused", () => {
    it("canvass_start with only a product name raises and writes nothing", async () => {
        const name = `${MARKER} free-standing`
        const { data, error } = await start("outsider", { p_product_name: name })
        expect(data).toBeNull()
        expect(error?.code).toBe(BAD_INPUT)
        expect(await countNamed(name)).toBe(0)
    })

    it("a signed-in person cannot insert one straight into the table either", async () => {
        const name = `${MARKER} straight insert`
        const { error } = await (await clientFor("outsider")).from("sor_canvasses").insert({ product_name: name })
        expect(error).not.toBeNull()
        expect(await countNamed(name)).toBe(0)
    })
})

describe("existing free-standing Canvasses stay readable", () => {
    it("a purchaser still reads, lists and picks a winner on one made before", async () => {
        const old = await asSvc(svc().from("sor_canvasses").insert({ product_name: `${MARKER} old bare`, created_by: ids.outsider }).select("id, number").single(), "old Canvass")
        canvasses.push(old.id)
        const offer = await asSvc(svc().from("sor_canvass_offers").insert({ canvass_id: old.id, supplier_name: "Old Co", currency: "PHP" }).select("id").single(), "Offer")

        const purchaser = await clientFor("outsider")
        const read = await purchaser.from("sor_canvasses").select("id, number").eq("id", old.id)
        expect(read.error).toBeNull()
        expect(read.data).toEqual([{ id: old.id, number: old.number }])

        const listed = await purchaser.rpc("canvass_list")
        expect(listed.error).toBeNull()
        expect(listed.data.some((row) => row.id === old.id && row.kind === "none")).toBe(true)

        await coverSlots(old.id)
        const won = await purchaser.rpc("canvass_apply_winner", { p_canvass_id: old.id, p_offer_id: offer.id })
        expect(won.error).toBeNull()
    })
})

describe("Create Purchase Request from Canvasses is refused", () => {
    let canvassId

    beforeAll(async () => {
        const old = await asSvc(svc().from("sor_canvasses").insert({ product_name: `${MARKER} for request`, created_by: ids.outsider }).select("id").single(), "Canvass")
        canvassId = old.id
        canvasses.push(old.id)
        const offer = await asSvc(svc().from("sor_canvass_offers").insert({ canvass_id: old.id, supplier_name: "Old Co", currency: "PHP" }).select("id").single(), "Offer")
        await coverSlots(old.id)
        await asSvc(svc().from("sor_canvass_offers").update({ is_winner: true }).eq("id", offer.id), "winner")
    })

    it("canvass_create_purchase_request raises and makes no request", async () => {
        const title = `${MARKER} from canvasses`
        const { error } = await (await clientFor("outsider")).rpc("canvass_create_purchase_request", { p_title: title, p_items: [{ canvass_id: canvassId }] })
        expect(error?.code).toBe(BAD_INPUT)
        const made = await asSvc(svc().from("purchase_requests").select("id").eq("title", title), "requests")
        expect(made).toEqual([])
        const row = await asSvc(svc().from("sor_canvasses").select("request_made_at").eq("id", canvassId).single(), "Canvass")
        expect(row.request_made_at).toBeNull()
    })

    it("canvass_add_to_purchase_request raises too", async () => {
        const opened = await (await clientFor("ordinary")).rpc("purchase_request_open", { p_title: `${MARKER} add target`, p_items: [{ name: `${MARKER} Stapler`, quantity: 1, unit: "pc" }] })
        if (opened.error) throw new Error(`purchase_request_open: ${opened.error.message}`)
        requests.push(opened.data)
        const { error } = await (await clientFor("outsider")).rpc("canvass_add_to_purchase_request", { p_request_id: opened.data, p_items: [{ canvass_id: canvassId }] })
        expect(error?.code).toBe(BAD_INPUT)
        const row = await asSvc(svc().from("sor_canvasses").select("requested_item_id, request_made_at").eq("id", canvassId).single(), "Canvass")
        expect(row).toEqual({ requested_item_id: null, request_made_at: null })
    })
})

describe("a Direct request line is canvassed like a project line", () => {
    it("Purchasing starts a Canvass on a line the requester typed, and the line moves to Still canvassing", async () => {
        const opened = await (await clientFor("ordinary")).rpc("purchase_request_open", {
            p_title: `${MARKER} direct`,
            p_items: [{ name: `${MARKER} Printer toner`, quantity: 2, unit: "pc" }],
        })
        if (opened.error) throw new Error(`purchase_request_open: ${opened.error.message}`)
        requests.push(opened.data)
        const request = await asSvc(svc().from("purchase_requests").select("opportunity_id").eq("id", opened.data).single(), "request")
        expect(request.opportunity_id).toBeNull()
        const item = await asSvc(svc().from("purchase_request_items").select("id").eq("request_id", opened.data).single(), "item")

        const { data, error } = await start("outsider", { p_requested_item_id: item.id })
        expect(error).toBeNull()
        canvasses.push(data.canvass_id)
        const canvass = await asSvc(svc().from("sor_canvasses").select("requested_item_id, component_id").eq("id", data.canvass_id).single(), "Canvass")
        expect(canvass).toEqual({ requested_item_id: item.id, component_id: null })
        const after = await asSvc(svc().from("purchase_request_items").select("status").eq("id", item.id).single(), "status")
        expect(after.status).toBe("still_canvassing")
    })
})
