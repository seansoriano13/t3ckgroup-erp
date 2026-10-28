/**
 * A Canvass is not signed off (#728, spec #718, ADR 0047, replaces 93-canvass-signoff): canvass_sign
 * refuses everyone, the queue / notice / clearing functions are gone, signed_off_by and
 * signed_off_at cannot be written by a client, and a Canvass signed off before keeps its sign-off as
 * read-only history through every later edit.
 *
 * The cast:
 *   outsider     Purchasing access, opens the Canvass (its creator)   -> picks winners, edits Offers
 *   checkByTwo   on the transmittal_check_by list (the old approver)  -> can no longer sign
 *   superAdmin   Super Admin                                           -> cannot sign either
 *   ordinary     nobody
 *
 * Bare Canvasses (no subject, ADR 0034) and Offers are made with the service role, which is also how
 * an "old" sign-off is seeded: nothing at a client can write one. Every call under test runs as a
 * real cast member.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"
import { tryInsert } from "./support/access.js"
import { coverSlots } from "./support/canvassSlots.js"

const svc = () => serviceClient()
const RLS_DENIED = "42501"
const LIST = "transmittal_check_by"
const REASON = "Cheapest quote that meets the load."

const canvasses = []
const addedToList = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

/** A bare Canvass with two Offers (the first the winner), a reason, and its empty slot explained. */
async function freshCanvass({ winner = true, reason = REASON } = {}) {
    const canvass = await asSvc(
        svc().from("sor_canvasses").insert({ product_name: `${MARKER} no signing`, created_by: ids.outsider }).select("id").single(),
        "Canvass",
    )
    canvasses.push(canvass.id)
    const offers = []
    for (let i = 0; i < 2; i++) {
        const offer = await asSvc(
            svc().from("sor_canvass_offers").insert({ canvass_id: canvass.id, supplier_name: `Supplier ${i + 1}`, sort_order: i, is_winner: winner && i === 0 }).select("*").single(),
            "Offer",
        )
        await asSvc(svc().from("sor_canvass_offer_prices").insert({ offer_id: offer.id, unit_price: 1000 + i }), "Offer price")
        offers.push(offer)
    }
    if (reason !== null) await asSvc(svc().from("sor_canvasses").update({ reason }).eq("id", canvass.id), "reason")
    await coverSlots(canvass.id)
    return { id: canvass.id, offers }
}

/** What a Canvass signed off before this change looks like. */
const signOffTheOldWay = async (id) =>
    asSvc(svc().from("sor_canvasses").update({ signed_off_by: ids.checkByTwo, signed_off_at: "2026-10-01T02:00:00Z" }).eq("id", id).select("*").single(), "old sign-off")

const row = async (id) => asSvc(svc().from("sor_canvasses").select("*").eq("id", id).single(), "Canvass row")
const events = async (id) => asSvc(svc().from("sor_canvass_signoff_events").select("*").eq("canvass_id", id).order("created_at"), "events")
const sign = async (who, id) => (await clientFor(who)).rpc("canvass_sign", { p_canvass_id: id })

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
    const present = await asSvc(svc().from("ipas_signer_lists").select("employee_id").eq("list_key", LIST).eq("employee_id", ids.checkByTwo), "list")
    if (present.length === 0) {
        await asSvc(svc().from("ipas_signer_lists").insert({ list_key: LIST, employee_id: ids.checkByTwo }), "list member")
        addedToList.push(ids.checkByTwo)
    }
})

afterAll(async () => {
    if (canvasses.length) await svc().from("sor_canvasses").delete().in("id", canvasses)
    for (const id of addedToList) await svc().from("ipas_signer_lists").delete().eq("list_key", LIST).eq("employee_id", id)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
})

describe("canvass_sign", () => {
    it("is refused to everyone, even the old approver list on a Canvass that is ready", async () => {
        const { id } = await freshCanvass()
        for (const who of ["checkByTwo", "outsider", "superAdmin", "ordinary"]) {
            const { error } = await sign(who, id)
            expect(error?.code, who).toBe(RLS_DENIED)
            expect(error?.message, who).toMatch(/no longer signed off/)
        }
        const after = await row(id)
        expect(after.signed_off_by).toBeNull()
        expect(after.signed_off_at).toBeNull()
        expect(await events(id)).toEqual([])
    })

    it("is refused on a Canvass with no winner or reason too, and on one already signed the old way", async () => {
        const bare = await freshCanvass({ winner: false, reason: null })
        expect((await sign("checkByTwo", bare.id)).error?.code).toBe(RLS_DENIED)

        const old = await freshCanvass()
        await signOffTheOldWay(old.id)
        expect((await sign("checkByTwo", old.id)).error?.code).toBe(RLS_DENIED)
        expect((await row(old.id)).signed_off_by).toBe(ids.checkByTwo)
    })
})

describe("a winner needs no sign-off", () => {
    it("is picked and stays unsigned, and un-picking it writes no history", async () => {
        const { id, offers } = await freshCanvass({ winner: false })
        const purchaser = await clientFor("outsider")
        const picked = await purchaser.rpc("canvass_apply_winner", { p_canvass_id: id, p_offer_id: offers[0].id })
        expect(picked.error).toBeNull()

        const cleared = await purchaser.rpc("canvass_clear_winner", { p_canvass_id: id })
        expect(cleared.error).toBeNull()
        expect(cleared.data.cleared).toBe(true)

        const after = await row(id)
        expect(after.signed_off_at).toBeNull()
        expect(await events(id)).toEqual([])
    })
})

describe("signed_off_by and signed_off_at", () => {
    it("cannot be written by a client, on update or on insert", async () => {
        const { id } = await freshCanvass()
        const purchaser = await clientFor("outsider")
        const forged = await purchaser.from("sor_canvasses").update({ signed_off_by: ids.checkByTwo, signed_off_at: new Date().toISOString() }).eq("id", id)
        expect(forged.error?.code).toBe(RLS_DENIED)

        const born = await tryInsert(purchaser, "sor_canvasses", { product_name: `${MARKER} born signed`, signed_off_at: new Date().toISOString() })
        expect(born.ok).toBe(false)
        expect((await row(id)).signed_off_at).toBeNull()
    })

    it("cannot be wiped by a client either", async () => {
        const { id } = await freshCanvass()
        await signOffTheOldWay(id)
        const wipe = await (await clientFor("outsider")).from("sor_canvasses").update({ signed_off_by: null, signed_off_at: null }).eq("id", id)
        expect(wipe.error?.code).toBe(RLS_DENIED)
        expect((await row(id)).signed_off_at).toBeTruthy()
    })
})

describe("an old sign-off is read-only history", () => {
    it("survives an Offer added, changed or removed, a price, the winner and the reason changing", async () => {
        const { id, offers } = await freshCanvass()
        await signOffTheOldWay(id)
        const purchaser = await clientFor("outsider")
        const stillSigned = async (what) => {
            const now = await row(id)
            expect(now.signed_off_by, what).toBe(ids.checkByTwo)
            expect(now.signed_off_at, what).toBeTruthy()
        }

        const added = await purchaser.from("sor_canvass_offers").insert({ canvass_id: id, supplier_name: "Late quote" }).select("id").single()
        expect(added.error).toBeNull()
        await stillSigned("an Offer was added")

        const edited = await purchaser.from("sor_canvass_offers").update({ brand: "Other" }).eq("id", offers[1].id).select("id")
        expect(edited.error).toBeNull()
        await stillSigned("an Offer was changed")

        const priced = await purchaser.from("sor_canvass_offer_prices").update({ unit_price: 999 }).eq("offer_id", offers[0].id).select("offer_id")
        expect(priced.error).toBeNull()
        await stillSigned("a price changed")

        const reason = await purchaser.from("sor_canvasses").update({ reason: "A better reason." }).eq("id", id).select("id")
        expect(reason.error).toBeNull()
        await stillSigned("the reason changed")

        const repick = await purchaser.rpc("canvass_apply_winner", { p_canvass_id: id, p_offer_id: offers[1].id })
        expect(repick.error).toBeNull()
        await stillSigned("the winner changed")

        const unpick = await purchaser.rpc("canvass_clear_winner", { p_canvass_id: id })
        expect(unpick.error).toBeNull()
        await stillSigned("the winner was un-picked")

        const removed = await purchaser.from("sor_canvass_offers").delete().eq("id", added.data.id).select("id")
        expect(removed.error).toBeNull()
        await stillSigned("an Offer was removed")

        // No "cleared" row was written by any of it.
        expect(await events(id)).toEqual([])
    })

    it("is still on the Canvass row for the screen and the print, with who signed", async () => {
        const { id } = await freshCanvass()
        await signOffTheOldWay(id)
        const read = await (await clientFor("outsider")).from("sor_canvasses").select("signed_off_by, signed_off_at, signer:employees!sor_canvasses_signed_off_by_fkey(id)").eq("id", id).single()
        expect(read.error).toBeNull()
        expect(read.data.signed_off_by).toBe(ids.checkByTwo)
        expect(read.data.signed_off_at).toBeTruthy()
    })
})

describe("the sign-off history", () => {
    const seedEvent = async (id) =>
        asSvc(svc().from("sor_canvass_signoff_events").insert({ canvass_id: id, kind: "signed", actor_id: ids.checkByTwo, reason: REASON, offer_count: 2 }).select("*").single(), "event")

    it("can still be read where the Canvass can be read, and nowhere else", async () => {
        const { id } = await freshCanvass()
        await seedEvent(id)
        const seen = await (await clientFor("outsider")).from("sor_canvass_signoff_events").select("id").eq("canvass_id", id)
        expect(seen.data).toHaveLength(1)
        const hidden = await (await clientFor("ordinary")).from("sor_canvass_signoff_events").select("id").eq("canvass_id", id)
        expect(hidden.data).toHaveLength(0)
    })

    it("still can't be updated or deleted, by anyone", async () => {
        const { id } = await freshCanvass()
        const event = await seedEvent(id)
        expect((await svc().from("sor_canvass_signoff_events").update({ reason: "Rewritten" }).eq("id", event.id)).error?.code).toBe(RLS_DENIED)
        expect((await svc().from("sor_canvass_signoff_events").delete().eq("id", event.id)).error?.code).toBe(RLS_DENIED)
        const viaClient = await (await clientFor("outsider")).from("sor_canvass_signoff_events").update({ reason: "Rewritten" }).eq("id", event.id).select("id")
        expect(viaClient.data ?? []).toHaveLength(0)
        expect((await events(id))[0].reason).toBe(REASON)
    })

    it("can't be written to directly by a client", async () => {
        const { id } = await freshCanvass()
        const result = await tryInsert(await clientFor("outsider"), "sor_canvass_signoff_events", { canvass_id: id, kind: "signed", actor_id: ids.outsider })
        expect(result.ok).toBe(false)
    })
})

describe("the queue, the notice and the clearing functions are gone", () => {
    it("canvass_pending_signoffs and canvass_signoff_audience no longer answer, even for the old approver list", async () => {
        const { id } = await freshCanvass()
        const approver = await clientFor("checkByTwo")
        expect((await approver.rpc("canvass_pending_signoffs")).error).not.toBeNull()
        expect((await approver.rpc("canvass_signoff_audience", { p_canvass_id: id })).error).not.toBeNull()
    })

    it("canvass_clear_signoff and canvass_is_ready are gone, for a client and for the service role", async () => {
        const { id } = await freshCanvass()
        expect((await (await clientFor("outsider")).rpc("canvass_clear_signoff", { p_canvass_id: id, p_reason: "x" })).error).not.toBeNull()
        expect((await svc().rpc("canvass_clear_signoff", { p_canvass_id: id, p_reason: "x" })).error).not.toBeNull()
        expect((await svc().rpc("canvass_is_ready", { p_canvass_id: id })).error).not.toBeNull()
    })
})
