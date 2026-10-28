/**
 * Canvass supplier slots (#721, spec #718, ADR 0047): canvass_set_no_other_supplier,
 * canvass_clear_no_other_supplier, and the three-slot refusal in canvass_apply_winner.
 *
 * The cast, on one SOR:
 *   outsider   Purchasing access, opens the Canvasses   -> may mark slots and pick a winner
 *   ordinary   nobody                                    -> may not
 *
 * Canvasses and Offers are made with the service role; every call under test runs as a cast member.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const RLS_DENIED = "42501"
const BAD_INPUT = "22023"

const canvasses = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

/** A bare Canvass (no subject, ADR 0034) with `offers` Offers. */
async function freshCanvass(offers) {
    const canvass = await asSvc(
        svc().from("sor_canvasses").insert({ product_name: `${MARKER} slots`, created_by: ids.outsider }).select("id").single(),
        "Canvass",
    )
    canvasses.push(canvass.id)
    const made = []
    for (let i = 0; i < offers; i++) {
        made.push(
            await asSvc(
                svc().from("sor_canvass_offers").insert({ canvass_id: canvass.id, supplier_name: `Supplier ${i + 1}`, sort_order: i }).select("id").single(),
                "Offer",
            ),
        )
    }
    return { id: canvass.id, offers: made }
}

const mark = async (who, canvassId, slots, reason) =>
    (await clientFor(who)).rpc("canvass_set_no_other_supplier", { p_canvass_id: canvassId, p_slots: slots, p_reason: reason })
const clear = async (who, canvassId, slot) =>
    (await clientFor(who)).rpc("canvass_clear_no_other_supplier", { p_canvass_id: canvassId, p_slot: slot })
const win = async (who, canvassId, offerId) =>
    (await clientFor(who)).rpc("canvass_apply_winner", { p_canvass_id: canvassId, p_offer_id: offerId })
const marks = async (canvassId) =>
    asSvc(svc().from("sor_canvass_no_other_supplier").select("*").eq("canvass_id", canvassId).order("slot"), "marks")
const covered = async (canvassId) => asSvc(svc().rpc("canvass_slots_covered", { p_canvass_id: canvassId }), "covered")

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
})

afterAll(async () => {
    await svc().from("sor_canvasses").delete().in("id", canvasses)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
})

describe("canvass_set_no_other_supplier", () => {
    it("records the slot with its reason, who and when", async () => {
        const c = await freshCanvass(1)
        const { error } = await mark("outsider", c.id, [2], "  Sole distributor  ")
        expect(error).toBeNull()
        const [row] = await marks(c.id)
        expect(row).toMatchObject({ slot: 2, reason: "Sole distributor", actor_id: ids.outsider })
        expect(row.created_at).toBeTruthy()
    })

    it("lets one reason serve both slots 2 and 3", async () => {
        const c = await freshCanvass(1)
        expect((await mark("outsider", c.id, [2, 3], "Only one dealer in the country")).error).toBeNull()
        const rows = await marks(c.id)
        expect(rows.map((r) => [r.slot, r.reason])).toEqual([
            [2, "Only one dealer in the country"],
            [3, "Only one dealer in the country"],
        ])
        expect(await covered(c.id)).toBe(3)
    })

    it("is refused without a reason, and with a blank one", async () => {
        const c = await freshCanvass(1)
        for (const reason of [null, "", "   "]) {
            const { error } = await mark("outsider", c.id, [2], reason)
            expect(error?.code, String(reason)).toBe(BAD_INPUT)
        }
        expect(await marks(c.id)).toHaveLength(0)
    })

    it("is refused for slot 1, a slot outside 2 or 3, and no slot at all", async () => {
        const c = await freshCanvass(0)
        for (const slots of [[1], [4], [2, 4], [], null]) {
            const { error } = await mark("outsider", c.id, slots, "Because")
            expect(error?.code, JSON.stringify(slots)).toBe(BAD_INPUT)
        }
        expect(await marks(c.id)).toHaveLength(0)
    })

    it("is refused for a slot that already has an Offer, and writes nothing for the other slot either", async () => {
        const c = await freshCanvass(2)
        const { error } = await mark("outsider", c.id, [2, 3], "Because")
        expect(error?.code).toBe(BAD_INPUT)
        expect(error.message).toMatch(/slot 2/)
        expect(await marks(c.id)).toHaveLength(0)
    })

    it("re-marking replaces the reason", async () => {
        const c = await freshCanvass(1)
        await mark("outsider", c.id, [3], "First")
        await mark("outsider", c.id, [3], "Second")
        const rows = await marks(c.id)
        expect(rows).toHaveLength(1)
        expect(rows[0].reason).toBe("Second")
    })

    it("is refused to someone without Purchasing access", async () => {
        const c = await freshCanvass(1)
        const { error } = await mark("ordinary", c.id, [2], "Because")
        expect(error?.code).toBe(RLS_DENIED)
        expect(await marks(c.id)).toHaveLength(0)
    })

    it("cannot be written to directly", async () => {
        const c = await freshCanvass(1)
        const { error } = await (await clientFor("outsider"))
            .from("sor_canvass_no_other_supplier")
            .insert({ canvass_id: c.id, slot: 2, reason: "Sneaky" })
        expect(error?.code).toBe(RLS_DENIED)
    })

    it("can be taken back off a slot", async () => {
        const c = await freshCanvass(1)
        await mark("outsider", c.id, [2, 3], "Because")
        expect((await clear("outsider", c.id, 2)).data.cleared).toBe(true)
        expect((await marks(c.id)).map((r) => r.slot)).toEqual([3])
        expect((await clear("ordinary", c.id, 3)).error?.code).toBe(RLS_DENIED)
    })
})

describe("canvass_apply_winner needs three slots covered", () => {
    it("refuses a winner on one Offer, and on two", async () => {
        for (const n of [1, 2]) {
            const c = await freshCanvass(n)
            const { error } = await win("outsider", c.id, c.offers[0].id)
            expect(error?.code, `${n} offers`).toBe(BAD_INPUT)
            expect(error.message).toMatch(/three supplier slots/)
            const winners = await asSvc(svc().from("sor_canvass_offers").select("id").eq("canvass_id", c.id).eq("is_winner", true), "winners")
            expect(winners).toHaveLength(0)
        }
    })

    it("allows a winner on two Offers and slot 3 explained", async () => {
        const c = await freshCanvass(2)
        await mark("outsider", c.id, [3], "No third dealer")
        expect((await win("outsider", c.id, c.offers[0].id)).error).toBeNull()
    })

    it("allows a winner on one Offer and slots 2 and 3 explained by one reason", async () => {
        const c = await freshCanvass(1)
        await mark("outsider", c.id, [2, 3], "Sole importer")
        expect((await win("outsider", c.id, c.offers[0].id)).error).toBeNull()
    })

    it("refuses a winner with one slot explained and one still open", async () => {
        const c = await freshCanvass(1)
        await mark("outsider", c.id, [3], "No third dealer")
        expect((await win("outsider", c.id, c.offers[0].id)).error?.code).toBe(BAD_INPUT)
    })

    it("allows a winner on three Offers, and on more than three", async () => {
        for (const n of [3, 4, 5]) {
            const c = await freshCanvass(n)
            expect((await win("outsider", c.id, c.offers[n - 1].id)).error, `${n} offers`).toBeNull()
        }
    })

    it("stops counting a mark once its slot gets an Offer", async () => {
        const c = await freshCanvass(1)
        await mark("outsider", c.id, [2, 3], "Sole importer")
        expect(await covered(c.id)).toBe(3)
        // Offers 2 and 3 arrive: the marks no longer count, so nothing is counted twice.
        for (const i of [2, 3]) {
            await asSvc(svc().from("sor_canvass_offers").insert({ canvass_id: c.id, supplier_name: `Late ${i}`, sort_order: i }), "Offer")
        }
        expect(await covered(c.id)).toBe(3)
        // And with one Offer removed again, the stale mark on slot 3 counts for slot 3 only.
        const [late] = await asSvc(svc().from("sor_canvass_offers").select("id").eq("canvass_id", c.id).eq("supplier_name", "Late 3"), "late")
        await asSvc(svc().from("sor_canvass_offers").delete().eq("id", late.id), "remove")
        expect(await covered(c.id)).toBe(3)
    })

    it("is refused to someone without Purchasing access, whatever the slots", async () => {
        const c = await freshCanvass(3)
        expect((await win("ordinary", c.id, c.offers[0].id)).error?.code).toBe(RLS_DENIED)
    })
})
