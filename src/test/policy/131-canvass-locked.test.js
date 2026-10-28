/**
 * A Canvass is locked once a Purchase Request was made from it (canvass_is_locked): its Offers,
 * prices, winner, reason and product name refuse to change, and only
 * a Super Admin can release the lock (canvass_unlock), always with a reason kept in the history.
 *
 * The cast: outsider has Purchasing access; superAdmin is a Super Admin.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

const svc = () => serviceClient()
const LOCKED = "55000"
const RLS_DENIED = "42501"
const BAD_INPUT = "22023"

const created = []
const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

/** An old free-standing Canvass with two Offers (service role: nobody signed in can start one, #729). */
const makeCanvass = async (label) => {
    const canvass = await asSvc(
        svc().from("sor_canvasses").insert({ product_name: `${MARKER} ${label}`, created_by: ids.outsider }).select("id").single(),
        "Canvass",
    )
    created.push(canvass.id)
    for (const supplier of ["Redleaf Inc.", "Ream Co"]) {
        await asSvc(svc().from("sor_canvass_offers").insert({ canvass_id: canvass.id, supplier_name: supplier, currency: "PHP", created_by: ids.outsider }).select("id").single(), "Offer")
    }
    return canvass.id
}

const isLocked = async (id) => asSvc(svc().rpc("canvass_is_locked", { p_canvass_id: id }), "canvass_is_locked")

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")
})

afterAll(async () => {
    if (created.length) await svc().from("sor_canvasses").delete().in("id", created)
})

describe("a Canvass a Purchase Request was made from", () => {
    it("is open until it is stamped, then refuses its Offers, winner, reason and product name", async () => {
        const id = await makeCanvass("paper")
        expect(await isLocked(id)).toBe(false)
        const [offer] = await asSvc(svc().from("sor_canvass_offers").select("id").eq("canvass_id", id), "Offers")
        await asSvc(svc().from("sor_canvass_offers").update({ remarks: "open" }).eq("id", offer.id).select("id"), "edit while open")

        await asSvc(svc().from("sor_canvasses").update({ request_made_at: new Date().toISOString() }).eq("id", id).select("id"), "stamp")
        expect(await isLocked(id)).toBe(true)

        const edit = await svc().from("sor_canvass_offers").update({ remarks: "locked" }).eq("id", offer.id)
        expect(edit.error?.code).toBe(LOCKED)
        const add = await svc().from("sor_canvass_offers").insert({ canvass_id: id, supplier_name: "Late Co", currency: "PHP" })
        expect(add.error?.code).toBe(LOCKED)
        const remove = await svc().from("sor_canvass_offers").delete().eq("id", offer.id)
        expect(remove.error?.code).toBe(LOCKED)
        const price = await svc().from("sor_canvass_offer_prices").update({ unit_price: 1 }).eq("offer_id", offer.id)
        expect(price.error?.code).toBe(LOCKED)
        const reason = await svc().from("sor_canvasses").update({ reason: "changed my mind" }).eq("id", id)
        expect(reason.error?.code).toBe(LOCKED)
        const name = await svc().from("sor_canvasses").update({ product_name: "something else" }).eq("id", id)
        expect(name.error?.code).toBe(LOCKED)
    })

    it("only a Super Admin can unlock it, and only with a reason, which goes into the history", async () => {
        const id = await makeCanvass("toner")
        await asSvc(svc().from("sor_canvasses").update({ request_made_at: new Date().toISOString() }).eq("id", id).select("id"), "stamp")

        const purchasing = await (await clientFor("outsider")).rpc("canvass_unlock", { p_canvass_id: id, p_reason: "my mistake" })
        expect(purchasing.error?.code).toBe(RLS_DENIED)
        expect(await isLocked(id)).toBe(true)

        const admin = await clientFor("superAdmin")
        const blank = await admin.rpc("canvass_unlock", { p_canvass_id: id, p_reason: "   " })
        expect(blank.error?.code).toBe(BAD_INPUT)

        const { data, error } = await admin.rpc("canvass_unlock", { p_canvass_id: id, p_reason: "Wrong winner picked" })
        expect(error).toBeNull()
        expect(data.unlocked).toBe(true)
        expect(await isLocked(id)).toBe(false)

        const history = await asSvc(svc().from("sor_canvass_signoff_events").select("kind, reason, actor_id").eq("canvass_id", id), "history")
        expect(history).toContainEqual({ kind: "unlocked", reason: "Wrong winner picked", actor_id: ids.superAdmin })

        // Released stays released, and its Offers change again.
        await asSvc(svc().from("sor_canvass_offers").update({ remarks: "fixed" }).eq("canvass_id", id).select("id"), "edit after unlock")
    })
})
