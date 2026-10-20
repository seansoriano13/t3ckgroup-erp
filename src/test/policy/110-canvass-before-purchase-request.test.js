/**
 * Canvass before the Purchase Request (ADR 0034, #563 and #564): the first Offer's save starts the
 * Canvass and gives it its number (canvass_start), and a winner can be un-picked
 * (canvass_clear_winner), which unsigns the Canvass and leaves what the winner filled alone.
 *
 * The cast: outsider has Purchasing access; ordinary has nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const RLS_DENIED = "42501"
const BAD_INPUT = "22023"

const created = []
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

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
})

afterAll(async () => {
    if (created.length) await svc().from("sor_canvasses").delete().in("id", created)
})

describe("the first Offer starts the Canvass", () => {
    it("writes nothing until canvass_start: a numberless draft is not a row", async () => {
        const before = (await svc().from("sor_canvasses").select("id", { count: "exact", head: true })).count
        // Opening the panel only reads; no call here writes. The count stays put.
        const after = (await svc().from("sor_canvasses").select("id", { count: "exact", head: true })).count
        expect(after).toBe(before)
    })

    it("creates the Canvass with its number, the default Canvasser and the Offer in one call", async () => {
        const { data, error } = await start("outsider", { p_product_name: `${MARKER} toner` })
        expect(error).toBeNull()
        created.push(data.canvass_id)
        expect(data.number).toMatch(/^CNV_\d{4}$/)

        const canvass = await asSvc(svc().from("sor_canvasses").select("*").eq("id", data.canvass_id).single(), "Canvass")
        expect(canvass.number).toBe(data.number)
        expect(canvass.canvasser_id).toBe(ids.outsider)
        const offers = await asSvc(svc().from("sor_canvass_offers").select("id").eq("canvass_id", data.canvass_id), "Offers")
        expect(offers).toHaveLength(1)
    })

    it("refuses a Canvass with no subject that does not say what is being bought", async () => {
        const { error } = await start("outsider", {})
        expect(error?.code).toBe(BAD_INPUT)
    })

    it("refuses someone without Purchasing access", async () => {
        const { error } = await start("ordinary", { p_product_name: `${MARKER} nothing` })
        expect(error).not.toBeNull()
        expect([RLS_DENIED]).toContain(error.code)
    })
})

describe("un-picking the winner", () => {
    let canvassId, offerId

    beforeAll(async () => {
        const { data, error } = await start("outsider", { p_product_name: `${MARKER} unpick` })
        if (error) throw new Error(error.message)
        canvassId = data.canvass_id
        offerId = data.offer.id
        created.push(canvassId)
        await asSvc(svc().from("sor_canvass_offers").update({ is_winner: true }).eq("id", offerId), "winner")
        await asSvc(svc().from("sor_canvasses").update({ signed_off_at: new Date().toISOString(), signed_off_by: ids.superAdmin }).eq("id", canvassId), "sign-off")
    })

    it("refuses someone without Purchasing access", async () => {
        const { error } = await (await clientFor("ordinary")).rpc("canvass_clear_winner", { p_canvass_id: canvassId })
        expect(error?.code).toBe(RLS_DENIED)
    })

    it("clears the winner and the sign-off", async () => {
        const { data, error } = await (await clientFor("outsider")).rpc("canvass_clear_winner", { p_canvass_id: canvassId })
        expect(error).toBeNull()
        expect(data.cleared).toBe(true)

        const offers = await asSvc(svc().from("sor_canvass_offers").select("is_winner").eq("canvass_id", canvassId), "Offers")
        expect(offers.some((o) => o.is_winner)).toBe(false)
        const canvass = await asSvc(svc().from("sor_canvasses").select("signed_off_at").eq("id", canvassId).single(), "Canvass")
        expect(canvass.signed_off_at).toBeNull()
    })

    it("is quiet when there is no winner to clear", async () => {
        const { data, error } = await (await clientFor("outsider")).rpc("canvass_clear_winner", { p_canvass_id: canvassId })
        expect(error).toBeNull()
        expect(data.cleared).toBe(false)
    })
})
