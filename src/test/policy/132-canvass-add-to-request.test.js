/**
 * Adding Canvasses that already exist to a Purchase Request that already exists
 * (canvass_add_to_purchase_request): each becomes a new Requested Item, or is attached to an item the
 * request already has. The winner's price goes onto the item and the Canvass locks.
 *
 * The cast: outsider has Purchasing access and opens the requests; ordinary has nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const NOT_ALLOWED = "42501"
const BAD_INPUT = "22023"
const CLOSED = "55000"

const canvasses = []
const requests = []
const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

/** A bare Canvass with a winner priced at `price`. */
const canvassWithWinner = async (label, price = 90) => {
    const purchasing = await clientFor("outsider")
    const { data, error } = await purchasing.rpc("canvass_start", {
        p_component_id: null,
        p_requested_item_id: null,
        p_product_name: `${MARKER} ${label}`,
        p_offer: { supplier_name: "Staple Co", currency: "PHP" },
        p_price: { unit_price: price },
    })
    if (error) throw new Error(`canvass_start: ${error.message}`)
    canvasses.push(data.canvass_id)
    const win = await purchasing.rpc("canvass_apply_winner", { p_canvass_id: data.canvass_id, p_offer_id: data.offer.id })
    if (win.error) throw new Error(`canvass_apply_winner: ${win.error.message}`)
    return data.canvass_id
}

/** A request the outsider opened, with one item (Stapler). */
const openRequest = async () => {
    const purchasing = await clientFor("outsider")
    const { data, error } = await purchasing.rpc("purchase_request_open", {
        p_title: `${MARKER} add canvass`,
        p_items: [{ name: `${MARKER} Stapler`, quantity: 3, unit: "pc" }],
    })
    if (error) throw new Error(`purchase_request_open: ${error.message}`)
    requests.push(data)
    const [item] = await asSvc(svc().from("purchase_request_items").select("id, name").eq("request_id", data), "item")
    return { requestId: data, itemId: item.id }
}

const add = async (who, requestId, items) => (await clientFor(who)).rpc("canvass_add_to_purchase_request", { p_request_id: requestId, p_items: items })

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
})

afterAll(async () => {
    if (canvasses.length) await svc().from("sor_canvasses").delete().in("id", canvasses)
    for (const id of requests) await svc().from("purchase_requests").delete().eq("id", id)
})

describe("adding a Canvass as a new Requested Item", () => {
    it("makes the item from the winner, copies the price, and locks the Canvass", async () => {
        const { requestId } = await openRequest()
        const id = await canvassWithWinner("gloves", 120)

        const { data, error } = await add("outsider", requestId, [{ canvass_id: id, quantity: 5, unit: "box" }])
        expect(error).toBeNull()
        const itemId = data.items[0].item_id

        const item = await asSvc(svc().from("purchase_request_items").select("request_id, quantity, unit, status, description").eq("id", itemId).single(), "item")
        expect(item).toMatchObject({ request_id: requestId, quantity: 5, unit: "box", status: "requested" })
        expect(item.description).toContain("From Canvass")
        const price = await asSvc(svc().from("purchase_request_item_prices").select("unit_price, currency").eq("item_id", itemId).single(), "price")
        expect(Number(price.unit_price)).toBe(120)

        const canvass = await asSvc(svc().from("sor_canvasses").select("requested_item_id, request_made_at").eq("id", id).single(), "Canvass")
        expect(canvass.requested_item_id).toBe(itemId)
        expect(canvass.request_made_at).not.toBeNull()
        expect(await asSvc(svc().rpc("canvass_is_locked", { p_canvass_id: id }), "lock")).toBe(true)
    })
})

describe("attaching a Canvass to an item the request already has", () => {
    it("puts the price on that item and adds no new item", async () => {
        const { requestId, itemId } = await openRequest()
        const id = await canvassWithWinner("staplers", 85)

        const { data, error } = await add("outsider", requestId, [{ canvass_id: id, item_id: itemId }])
        expect(error).toBeNull()
        expect(data.items[0].item_id).toBe(itemId)

        const items = await asSvc(svc().from("purchase_request_items").select("id").eq("request_id", requestId), "items")
        expect(items).toHaveLength(1)
        const price = await asSvc(svc().from("purchase_request_item_prices").select("unit_price").eq("item_id", itemId).single(), "price")
        expect(Number(price.unit_price)).toBe(85)
    })

    it("refuses an item that already has a Canvass, and an item of another request", async () => {
        const { requestId, itemId } = await openRequest()
        const first = await canvassWithWinner("first", 10)
        expect((await add("outsider", requestId, [{ canvass_id: first, item_id: itemId }])).error).toBeNull()

        const second = await canvassWithWinner("second", 11)
        const again = await add("outsider", requestId, [{ canvass_id: second, item_id: itemId }])
        expect(again.error?.code).toBe(CLOSED)

        const other = await openRequest()
        const wrong = await add("outsider", requestId, [{ canvass_id: second, item_id: other.itemId }])
        expect(wrong.error?.code).toBe("P0002")
    })
})

describe("an item that is past canvassing", () => {
    it("refuses an Ordered item, which would lock the Canvass at once and overwrite its price", async () => {
        const { requestId, itemId } = await openRequest()
        await asSvc(svc().from("purchase_request_items").update({ status: "ordered" }).eq("id", itemId).select("id"), "order it")
        const id = await canvassWithWinner("late")
        const { error } = await add("outsider", requestId, [{ canvass_id: id, item_id: itemId }])
        expect(error?.code).toBe(CLOSED)
        expect(await asSvc(svc().rpc("canvass_is_locked", { p_canvass_id: id }), "lock")).toBe(false)
    })
})

describe("what it refuses", () => {
    it("a Canvass with no winner, one that already has a subject, and one picked twice", async () => {
        const { requestId } = await openRequest()
        const purchasing = await clientFor("outsider")
        const bare = await purchasing.rpc("canvass_start", {
            p_component_id: null,
            p_requested_item_id: null,
            p_product_name: `${MARKER} no winner`,
            p_offer: { supplier_name: "Nobody", currency: "PHP" },
            p_price: { unit_price: 1 },
        })
        canvasses.push(bare.data.canvass_id)
        expect((await add("outsider", requestId, [{ canvass_id: bare.data.canvass_id }])).error?.code).toBe(BAD_INPUT)

        const done = await canvassWithWinner("done")
        expect((await add("outsider", requestId, [{ canvass_id: done }])).error).toBeNull()
        expect((await add("outsider", requestId, [{ canvass_id: done }])).error?.code).toBe(CLOSED)

        const twice = await canvassWithWinner("twice")
        expect((await add("outsider", requestId, [{ canvass_id: twice }, { canvass_id: twice }])).error?.code).toBe(BAD_INPUT)
        expect((await add("outsider", requestId, [])).error?.code).toBe(BAD_INPUT)
    })

    it("someone who may not add items, and someone without Purchasing access", async () => {
        const { requestId } = await openRequest()
        const id = await canvassWithWinner("nope")
        expect((await add("ordinary", requestId, [{ canvass_id: id }])).error?.code).toBe(NOT_ALLOWED)
    })
})
