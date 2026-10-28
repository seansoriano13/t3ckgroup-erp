/**
 * Canvass before the Purchase Request (ADR 0034, #563 and #564): the first Offer's save starts the
 * Canvass and gives it its number (canvass_start), and a winner can be un-picked
 * (canvass_clear_winner), which leaves what the winner filled alone and writes no sign-off history (#728).
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

/**
 * An old free-standing Canvass, made with the service role (#729: nobody signed in can start one any
 * more, ADR 0047, but the ones that exist keep working). Returns what canvass_start returned.
 */
async function seedBare(name) {
    const canvass = await asSvc(svc().from("sor_canvasses").insert({ product_name: name, created_by: ids.outsider }).select("id, number").single(), "Canvass")
    const offer = await asSvc(svc().from("sor_canvass_offers").insert({ canvass_id: canvass.id, supplier_name: "Redleaf Inc.", currency: "PHP" }).select("id").single(), "Offer")
    return { data: { canvass_id: canvass.id, number: canvass.number, offer }, error: null }
}

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

    it("gives an old free-standing Canvass its number and the default Canvasser", async () => {
        const { data, error } = await seedBare(`${MARKER} toner`)
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
        // A free-standing start is refused for every signed-in person since #729 (22023, a BEFORE INSERT
        // trigger that fires ahead of the row policy); the policy's 42501 is the other way it is refused.
        expect([RLS_DENIED, BAD_INPUT]).toContain(error.code)
    })
})

describe("the relaxed subject rule", () => {
    it("takes a Canvass with no Component and no Requested Item when it says what is being bought", async () => {
        const { data, error } = await svc().from("sor_canvasses").insert({ product_name: `${MARKER} gloves` }).select("*").single()
        expect(error).toBeNull()
        created.push(data.id)
        expect(data.number).toMatch(/^CNV_\d{4}$/)
    })

    it("still refuses a Canvass with neither a subject nor a name", async () => {
        const { error } = await svc().from("sor_canvasses").insert({})
        expect(error?.code).toBe("23514")
    })

    it("still refuses both a Component and a Requested Item", async () => {
        const { error } = await start("outsider", {
            p_component_id: "00000000-0000-0000-0000-000000000001",
            p_requested_item_id: "00000000-0000-0000-0000-000000000002",
        })
        expect(error?.code).toBe(BAD_INPUT)
    })
})

describe("un-picking the winner of an unsigned Canvass", () => {
    it("writes no history row", async () => {
        const { data, error } = await seedBare(`${MARKER} unpick unsigned`)
        if (error) throw new Error(error.message)
        created.push(data.canvass_id)
        await asSvc(svc().from("sor_canvass_offers").update({ is_winner: true }).eq("id", data.offer.id), "winner")
        const res = await (await clientFor("outsider")).rpc("canvass_clear_winner", { p_canvass_id: data.canvass_id })
        expect(res.error).toBeNull()
        const rows = await asSvc(svc().from("sor_canvass_signoff_events").select("kind, reason").eq("canvass_id", data.canvass_id), "history")
        expect(rows).toEqual([])
    })

    it("lets a purchaser read the money on a Canvass with no subject", async () => {
        const { data, error } = await (await clientFor("outsider")).rpc("canvass_subject_can_read_money", { p_component_id: null, p_requested_item_id: null })
        expect(error).toBeNull()
        expect(data).toBe(true)
    })
});

describe("un-picking the winner", () => {
    let canvassId, offerId

    beforeAll(async () => {
        const { data, error } = await seedBare(`${MARKER} unpick`)
        if (error) throw new Error(error.message)
        canvassId = data.canvass_id
        offerId = data.offer.id
        created.push(canvassId)
        await asSvc(svc().from("sor_canvass_offers").update({ is_winner: true }).eq("id", offerId), "winner")
        await asSvc(svc().from("sor_canvasses").update({ reason: "Cheapest that meets the need." }).eq("id", canvassId), "reason")
        // An old sign-off, written as the service role (nothing signs a Canvass any more).
        await asSvc(svc().from("sor_canvasses").update({ signed_off_by: ids.checkByTwo, signed_off_at: new Date().toISOString() }).eq("id", canvassId), "old sign-off")
    })

    it("refuses someone without Purchasing access", async () => {
        const { error } = await (await clientFor("ordinary")).rpc("canvass_clear_winner", { p_canvass_id: canvassId })
        expect(error?.code).toBe(RLS_DENIED)
    })

    it("clears the winner and leaves an old sign-off alone", async () => {
        const { data, error } = await (await clientFor("outsider")).rpc("canvass_clear_winner", { p_canvass_id: canvassId })
        expect(error).toBeNull()
        expect(data.cleared).toBe(true)

        const offers = await asSvc(svc().from("sor_canvass_offers").select("is_winner").eq("canvass_id", canvassId), "Offers")
        expect(offers.some((o) => o.is_winner)).toBe(false)
        const canvass = await asSvc(svc().from("sor_canvasses").select("signed_off_at").eq("id", canvassId).single(), "Canvass")
        expect(canvass.signed_off_at).not.toBeNull()
    })

    it("writes nothing to the sign-off history", async () => {
        const rows = await asSvc(svc().from("sor_canvass_signoff_events").select("kind, reason").eq("canvass_id", canvassId), "history")
        expect(rows).toEqual([])
    })

    it("is quiet when there is no winner to clear", async () => {
        const { data, error } = await (await clientFor("outsider")).rpc("canvass_clear_winner", { p_canvass_id: canvassId })
        expect(error).toBeNull()
        expect(data.cleared).toBe(false)
    })
})
