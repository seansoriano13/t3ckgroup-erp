/**
 * Canvass sign-off (#279, spec #275): canvass_sign, the clearing triggers, the append-only history,
 * the guard on signed_off_by / signed_off_at, and the Approval Center's queue and audience RPCs.
 *
 * The cast, on one SOR:
 *   outsider     Purchasing access, opens the Canvass (its creator)          -> cannot sign
 *   checkByTwo   on the transmittal_check_by list (the approver)             -> signs
 *   superAdmin   Super Admin, off the list                                   -> cannot sign
 *   ordinary     nobody                                                      -> cannot sign
 *
 * The matrix, Component, Canvass and Offers are made with the service role; every call under test
 * runs as a real cast member.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { tryInsert } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()
const RLS_DENIED = "42501"
const BAD_INPUT = "22023"
const WRONG_STATE = "55000"
const LIST = "transmittal_check_by"

let saleTypeId, flowId, stageId
let sorId, matrixId, lineId
const sorIds = []
const addedToList = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

let position = 0
async function freshCanvass({ reason = "Cheapest quote that meets the load.", winner = true, offers = 2 } = {}) {
    position += 1
    const componentId = (
        await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position, name: `Component ${position}`, quantity: 1 }).select("id").single(), "Component")
    ).id
    const canvass = await asSvc(svc().from("sor_canvasses").insert({ component_id: componentId, created_by: ids.outsider }).select("*").single(), "Canvass")
    const made = []
    for (let i = 0; i < offers; i++) {
        const offer = await asSvc(svc().from("sor_canvass_offers").insert({ canvass_id: canvass.id, supplier_name: `Supplier ${i}`, is_winner: winner && i === 0 }).select("*").single(), "Offer")
        await asSvc(svc().from("sor_canvass_offer_prices").insert({ offer_id: offer.id, unit_price: 1000 + i }), "Offer price")
        made.push(offer)
    }
    if (reason !== null) await asSvc(svc().from("sor_canvasses").update({ reason }).eq("id", canvass.id), "reason")
    return { canvass, offers: made, componentId }
}

const sign = async (who, canvassId) => (await clientFor(who)).rpc("canvass_sign", { p_canvass_id: canvassId })
const row = async (id) => asSvc(svc().from("sor_canvasses").select("*").eq("id", id).single(), "Canvass row")
const events = async (id) => asSvc(svc().from("sor_canvass_signoff_events").select("*").eq("canvass_id", id).order("created_at"), "events")

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    const present = await asSvc(svc().from("ipas_signer_lists").select("employee_id").eq("list_key", LIST).eq("employee_id", ids.checkByTwo), "list")
    if (present.length === 0) {
        await asSvc(svc().from("ipas_signer_lists").insert({ list_key: LIST, employee_id: ids.checkByTwo }), "list member")
        addedToList.push(ids.checkByTwo)
    }

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Signoff` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (
        await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Signoff Stage`, sort_order: 10 }).select("id").single(), "stage")
    ).id
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, supportSales1Id: ids.support, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data
    lineId = (
        await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Stretcher", quantity: 1 }).select("id").single(), "Tender Line")
    ).id
})

afterAll(async () => {
    await purgeCostingForSors(sorIds)
    for (const id of addedToList) await svc().from("ipas_signer_lists").delete().eq("list_key", LIST).eq("employee_id", id)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("canvass_sign", () => {
    it("is refused to someone off the list, a Purchasing member, and a Super Admin off the list", async () => {
        const { canvass } = await freshCanvass()
        for (const who of ["ordinary", "outsider", "superAdmin"]) {
            const { error } = await sign(who, canvass.id)
            expect(error?.code, who).toBe(RLS_DENIED)
        }
        expect((await row(canvass.id)).signed_off_at).toBeNull()
    })

    it("is refused to the person who opened the Canvass, even on the list", async () => {
        const { canvass } = await freshCanvass()
        await asSvc(svc().from("ipas_signer_lists").insert({ list_key: LIST, employee_id: ids.outsider }), "creator on list")
        try {
            const { error } = await sign("outsider", canvass.id)
            expect(error.code).toBe(RLS_DENIED)
            expect(error.message).toMatch(/opened/)
        } finally {
            await svc().from("ipas_signer_lists").delete().eq("list_key", LIST).eq("employee_id", ids.outsider)
        }
    })

    it("is refused without a winner, and without a reason", async () => {
        const noWinner = await freshCanvass({ winner: false })
        expect((await sign("checkByTwo", noWinner.canvass.id)).error.code).toBe(BAD_INPUT)

        const noReason = await freshCanvass({ reason: null })
        expect((await sign("checkByTwo", noReason.canvass.id)).error.code).toBe(BAD_INPUT)

        const blankReason = await freshCanvass({ reason: "   " })
        expect((await sign("checkByTwo", blankReason.canvass.id)).error.code).toBe(BAD_INPUT)
    })

    it("signs for the list, recording the Offer count even below three, and once only", async () => {
        const { canvass } = await freshCanvass({ offers: 2 })
        const { data, error } = await sign("checkByTwo", canvass.id)
        expect(error).toBeNull()
        expect(data.offer_count).toBe(2)

        const signed = await row(canvass.id)
        expect(signed.signed_off_by).toBe(ids.checkByTwo)
        expect(signed.signed_off_at).toBeTruthy()

        const history = await events(canvass.id)
        expect(history).toHaveLength(1)
        expect(history[0]).toMatchObject({ kind: "signed", actor_id: ids.checkByTwo, offer_count: 2, reason: "Cheapest quote that meets the load." })

        expect((await sign("checkByTwo", canvass.id)).error.code).toBe(WRONG_STATE)
    })
})

describe("a signed Canvass is cleared by a change", () => {
    const signed = async () => {
        const made = await freshCanvass()
        expect((await sign("checkByTwo", made.canvass.id)).error).toBeNull()
        return made
    }
    const lastEvent = async (id) => (await events(id)).at(-1)

    it("when an Offer is added", async () => {
        const { canvass } = await signed()
        await asSvc(svc().from("sor_canvass_offers").insert({ canvass_id: canvass.id, supplier_name: "Late quote" }), "Offer")
        expect((await row(canvass.id)).signed_off_at).toBeNull()
        expect(await lastEvent(canvass.id)).toMatchObject({ kind: "cleared", reason: "An Offer was added", offer_count: 3 })
    })

    it("when an Offer changes or goes", async () => {
        const { canvass, offers } = await signed()
        await asSvc(svc().from("sor_canvass_offers").update({ brand: "Other" }).eq("id", offers[1].id), "edit")
        expect(await lastEvent(canvass.id)).toMatchObject({ kind: "cleared", reason: "An Offer was changed" })

        await sign("checkByTwo", canvass.id)
        await asSvc(svc().from("sor_canvass_offers").delete().eq("id", offers[1].id), "delete")
        expect(await lastEvent(canvass.id)).toMatchObject({ kind: "cleared", reason: "An Offer was removed" })
    })

    it("when a price changes", async () => {
        const { canvass, offers } = await signed()
        await asSvc(svc().from("sor_canvass_offer_prices").update({ unit_price: 999 }).eq("offer_id", offers[0].id), "price")
        expect((await row(canvass.id)).signed_off_at).toBeNull()
        expect(await lastEvent(canvass.id)).toMatchObject({ kind: "cleared", reason: "A price changed" })
    })

    it("when the winner changes, and when the reason changes", async () => {
        const { canvass, offers } = await signed()
        await asSvc(svc().from("sor_canvass_offers").update({ is_winner: false }).eq("id", offers[0].id), "unwin")
        await asSvc(svc().from("sor_canvass_offers").update({ is_winner: true }).eq("id", offers[1].id), "win")
        expect(await lastEvent(canvass.id)).toMatchObject({ kind: "cleared" })
        expect((await row(canvass.id)).signed_off_at).toBeNull()

        await sign("checkByTwo", canvass.id)
        await asSvc(svc().from("sor_canvasses").update({ reason: "A better reason." }).eq("id", canvass.id), "reason")
        expect(await lastEvent(canvass.id)).toMatchObject({ kind: "cleared", reason: "The reason changed" })
    })

    it("but not by a plain re-ordering, and nothing locks while signed", async () => {
        const { canvass, offers } = await signed()
        await asSvc(svc().from("sor_canvass_offers").update({ sort_order: 5 }).eq("id", offers[0].id), "reorder")
        expect((await row(canvass.id)).signed_off_at).toBeTruthy()

        const purchaser = await clientFor("outsider")
        const edit = await purchaser.from("sor_canvass_offers").update({ remarks: "Late note" }).eq("id", offers[1].id).select("id")
        expect(edit.error).toBeNull()
        expect(edit.data).toHaveLength(1)
        expect((await row(canvass.id)).signed_off_at).toBeNull()
    })
})

describe("signed_off_by and signed_off_at", () => {
    it("are written only by the functions, not by Purchasing or the service role", async () => {
        const { canvass } = await freshCanvass()
        const purchaser = await clientFor("outsider")
        const forged = await purchaser.from("sor_canvasses").update({ signed_off_by: ids.checkByTwo, signed_off_at: new Date().toISOString() }).eq("id", canvass.id)
        expect(forged.error?.code).toBe(RLS_DENIED)

        const direct = await svc().from("sor_canvasses").update({ signed_off_at: new Date().toISOString() }).eq("id", canvass.id)
        expect(direct.error?.code).toBe(RLS_DENIED)

        const born = await purchaser.from("sor_canvasses").insert({ component_id: (await freshCanvass()).componentId, signed_off_at: new Date().toISOString() })
        expect(born.error).not.toBeNull()
        expect((await row(canvass.id)).signed_off_at).toBeNull()
    })

    it("cannot be cleared by hand either", async () => {
        const { canvass } = await freshCanvass()
        await sign("checkByTwo", canvass.id)
        const purchaser = await clientFor("outsider")
        const wipe = await purchaser.from("sor_canvasses").update({ signed_off_by: null, signed_off_at: null }).eq("id", canvass.id)
        expect(wipe.error?.code).toBe(RLS_DENIED)
        expect((await row(canvass.id)).signed_off_at).toBeTruthy()
    })

    it("canvass_clear_signoff has no client grant", async () => {
        const { canvass } = await freshCanvass()
        const { error } = await (await clientFor("outsider")).rpc("canvass_clear_signoff", { p_canvass_id: canvass.id, p_reason: "x" })
        expect(error).not.toBeNull()
    })
})

describe("the history", () => {
    it("can be read where the Canvass can be read, and nowhere else", async () => {
        const { canvass } = await freshCanvass()
        await sign("checkByTwo", canvass.id)
        const seen = await (await clientFor("outsider")).from("sor_canvass_signoff_events").select("id").eq("canvass_id", canvass.id)
        expect(seen.data).toHaveLength(1)
        const hidden = await (await clientFor("ordinary")).from("sor_canvass_signoff_events").select("id").eq("canvass_id", canvass.id)
        expect(hidden.data).toHaveLength(0)
    })

    it("can't be updated or deleted, by anyone", async () => {
        const { canvass } = await freshCanvass()
        await sign("checkByTwo", canvass.id)
        const [event] = await events(canvass.id)

        const update = await svc().from("sor_canvass_signoff_events").update({ reason: "Rewritten" }).eq("id", event.id)
        expect(update.error?.code).toBe(RLS_DENIED)
        const remove = await svc().from("sor_canvass_signoff_events").delete().eq("id", event.id)
        expect(remove.error?.code).toBe(RLS_DENIED)

        const asPurchaser = await clientFor("outsider")
        const viaClient = await asPurchaser.from("sor_canvass_signoff_events").update({ reason: "Rewritten" }).eq("id", event.id).select("id")
        expect(viaClient.data ?? []).toHaveLength(0)
        expect((await events(canvass.id))[0].reason).toBe("Cheapest quote that meets the load.")
    })

    it("can't be written to directly by a client", async () => {
        const { canvass } = await freshCanvass()
        const result = await tryInsert(await clientFor("outsider"), "sor_canvass_signoff_events", { canvass_id: canvass.id, kind: "signed", actor_id: ids.outsider })
        expect(result.ok).toBe(false)
    })

    it("goes with its Canvass", async () => {
        const { canvass } = await freshCanvass()
        await sign("checkByTwo", canvass.id)
        await asSvc(svc().from("sor_canvasses").delete().eq("id", canvass.id), "delete Canvass")
        expect(await events(canvass.id)).toHaveLength(0)
    })
})

describe("the Approval Center queue and the audience", () => {
    it("lists a ready, unsigned Canvass for a list member and nobody else", async () => {
        const { canvass } = await freshCanvass()
        const mine = await (await clientFor("checkByTwo")).rpc("canvass_pending_signoffs")
        expect(mine.error).toBeNull()
        expect(mine.data.map((r) => r.canvass_id)).toContain(canvass.id)
        const listed = mine.data.find((r) => r.canvass_id === canvass.id)
        expect(listed).toMatchObject({ number: canvass.number, offer_count: 2, creator_id: ids.outsider, opportunity_id: sorId })

        for (const who of ["outsider", "superAdmin", "ordinary"]) {
            const theirs = await (await clientFor(who)).rpc("canvass_pending_signoffs")
            expect(theirs.data, who).toEqual([])
        }
    })

    it("leaves out a Canvass with no winner or no reason, and one already signed", async () => {
        const noReason = await freshCanvass({ reason: null })
        const noWinner = await freshCanvass({ winner: false })
        const done = await freshCanvass()
        await sign("checkByTwo", done.canvass.id)

        const { data } = await (await clientFor("checkByTwo")).rpc("canvass_pending_signoffs")
        const listed = data.map((r) => r.canvass_id)
        for (const made of [noReason, noWinner, done]) expect(listed).not.toContain(made.canvass.id)
    })

    it("names the list to tell only when the Canvass is ready, never the creator", async () => {
        const ready = await freshCanvass()
        const purchaser = await clientFor("outsider")
        const told = await purchaser.rpc("canvass_signoff_audience", { p_canvass_id: ready.canvass.id })
        expect(told.error).toBeNull()
        expect(told.data).toMatchObject({ ready: true, number: ready.canvass.number })
        expect(told.data.notify_ids).toContain(ids.checkByTwo)
        expect(told.data.notify_ids).not.toContain(ids.outsider)

        const notReady = await freshCanvass({ reason: null })
        const quiet = await purchaser.rpc("canvass_signoff_audience", { p_canvass_id: notReady.canvass.id })
        expect(quiet.data).toMatchObject({ ready: false, notify_ids: [] })

        const stranger = await (await clientFor("ordinary")).rpc("canvass_signoff_audience", { p_canvass_id: ready.canvass.id })
        expect(stranger.data).toMatchObject({ ready: false, notify_ids: [] })
    })
})
