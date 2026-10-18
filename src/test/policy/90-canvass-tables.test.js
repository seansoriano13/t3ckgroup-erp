/**
 * Canvass tables (#276, spec #275): one subject, one Canvass per subject, the CNV_ number, a rate
 * only on a foreign Offer, who writes, who reads Offers and who reads prices, and the migration's
 * refusal to run over rows.
 *
 * The cast, on one SOR (dealOwner and support are its Deal Team):
 *   outsider          Purchasing access                        -> cost tier, writes
 *   superAdmin                                                 -> closed_book tier, writes
 *   dealOwner         Deal Team                                -> price tier (money), no write
 *   stageParticipant  open Stage Participant window            -> participant tier: Offers, no prices
 *   head              is_head and nothing else                 -> no tier, no write
 *   ordinary          nobody                                   -> reads nothing
 *
 * The matrix and its Component are made with the service role; every assertion about access runs
 * as a real cast member.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, rlsStatus, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { canRead, tryInsert, tryUpdate, tryDelete, RLS_VIOLATION } from "./support/access.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()
const CHECK_VIOLATION = "23514"
const UNIQUE_VIOLATION = "23505"
const MIGRATION = readFileSync("supabase/migrations/20261019100000_canvass_repoint.sql", "utf8")

let saleTypeId, flowId, stageId
let sorId, matrixId, lineId
let compSubject, compNumber, compWrite, compOffer, compRead, compMigration
let requestId, itemId
const sorIds = []
const canvassIds = []

const asSvc = async (query, what) => {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

/** A Canvass on a Component, made with the service role (so number and defaults are the database's own). */
async function makeCanvass(componentId, extra = {}) {
    const row = await asSvc(
        svc().from("sor_canvasses").insert({ component_id: componentId, created_by: ids.outsider, ...extra }).select("*").single(),
        "Canvass",
    )
    canvassIds.push(row.id)
    return row
}

async function makeOffer(canvassId, extra = {}, price = { unit_price: 78000 }) {
    const offer = await asSvc(
        svc().from("sor_canvass_offers").insert({ canvass_id: canvassId, supplier_name: "Redleaf Inc.", ...extra }).select("*").single(),
        "Offer",
    )
    if (price) await asSvc(svc().from("sor_canvass_offer_prices").insert({ offer_id: offer.id, ...price }), "Offer price")
    return offer
}

beforeAll(async () => {
    await ensureCastLoaded()
    await asSvc(svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider), "purchasing flag")

    saleTypeId = (await asSvc(svc().from("sale_types").insert({ name: `${MARKER} Canvass` }).select("id").single(), "sale type")).id
    flowId = (await asSvc(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single(), "flow")).id
    stageId = (
        await asSvc(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Canvass Stage`, sort_order: 10 }).select("id").single(), "stage")
    ).id

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, supportSales1Id: ids.support, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)

    const visit = await asSvc(svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).single(), "visit")
    await asSvc(
        svc().from("sor_stage_participants").insert({
            opportunity_id: sorId,
            employee_id: ids.stageParticipant,
            source: "action",
            opened_visit_id: visit.id,
            until_rule: "stage_left",
        }),
        "participant window",
    )

    const opened = await svc().rpc("costing_open_matrix", { p_opportunity_id: sorId })
    if (opened.error) throw new Error(`costing_open_matrix: ${opened.error.message}`)
    matrixId = opened.data
    lineId = (
        await asSvc(svc().from("costing_tender_lines").insert({ matrix_id: matrixId, position: 1, tender_specification: "Stretcher", quantity: 1 }).select("id").single(), "Tender Line")
    ).id
    const component = async (position) =>
        (await asSvc(svc().from("costing_components").insert({ tender_line_id: lineId, position, name: `Component ${position}`, quantity: 1 }).select("id").single(), "Component")).id
    // One Component per group of tests, so a Canvass left by one never meets another (one per Component).
    compSubject = await component(1)
    compNumber = await component(2)
    compWrite = await component(3)
    compOffer = await component(4)
    compRead = await component(5)
    compMigration = await component(6)

    // A Requested Item that names no Component, for the "both subjects" and "neither" checks.
    requestId = (
        await asSvc(svc().from("purchase_requests").insert({ opportunity_id: sorId, created_by: ids.dealOwner }).select("id").single(), "request")
    ).id
    itemId = (
        await asSvc(
            svc().from("purchase_request_items").insert({ request_id: requestId, name: "Spine board", quantity: 1, source: "new", requested_by: ids.dealOwner }).select("id").single(),
            "Requested Item",
        )
    ).id
})

afterAll(async () => {
    await svc().from("sor_canvasses").delete().in("component_id", [compSubject, compNumber, compWrite, compOffer, compRead, compMigration].filter(Boolean))
    await svc().from("sor_canvasses").delete().eq("requested_item_id", itemId ?? "00000000-0000-0000-0000-000000000000")
    await svc().from("purchase_request_items").delete().eq("request_id", requestId)
    await svc().from("purchase_requests").delete().eq("id", requestId)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("the tables", () => {
    it("keep row level security on", async () => {
        for (const table of ["sor_canvasses", "sor_canvass_offers", "sor_canvass_offer_prices"]) {
            expect(await rlsStatus(table)).toMatchObject({ enabled: true })
        }
    })
})

describe("one subject", () => {
    it("refuses a Canvass with neither a Component nor a Requested Item", async () => {
        const { error } = await svc().from("sor_canvasses").insert({ created_by: ids.outsider })
        expect(error.code).toBe(CHECK_VIOLATION)
    })

    it("refuses a Canvass with both", async () => {
        const { error } = await svc().from("sor_canvasses").insert({ component_id: compSubject, requested_item_id: itemId })
        expect(error.code).toBe(CHECK_VIOLATION)
    })

    it("takes a Canvass on a Requested Item", async () => {
        const { data, error } = await svc().from("sor_canvasses").insert({ requested_item_id: itemId }).select("*").single()
        expect(error).toBeNull()
        expect(data.number).toMatch(/^CNV_\d{4}$/)
        await svc().from("sor_canvasses").delete().eq("id", data.id)
    })

    it("refuses a second Canvass on one Component, and a second on one Requested Item", async () => {
        const first = await makeCanvass(compSubject)
        const again = await svc().from("sor_canvasses").insert({ component_id: compSubject })
        expect(again.error.code).toBe(UNIQUE_VIOLATION)

        const one = await svc().from("sor_canvasses").insert({ requested_item_id: itemId }).select("id").single()
        expect(one.error).toBeNull()
        const two = await svc().from("sor_canvasses").insert({ requested_item_id: itemId })
        expect(two.error.code).toBe(UNIQUE_VIOLATION)
        await svc().from("sor_canvasses").delete().eq("id", one.data.id)
        await svc().from("sor_canvasses").delete().eq("id", first.id)
    })
})

describe("the number", () => {
    it("is CNV_ and four digits, assigned by the database whatever the caller sends", async () => {
        const canvass = await makeCanvass(compNumber, { number: "CNV_9999" })
        expect(canvass.number).toMatch(/^CNV_\d{4}$/)
        expect(canvass.number).not.toBe("CNV_9999")
        await svc().from("sor_canvasses").delete().eq("id", canvass.id)
    })

    it("is never reused, and never changed", async () => {
        const first = await makeCanvass(compNumber)
        const edit = await svc().from("sor_canvasses").update({ number: "CNV_0001" }).eq("id", first.id)
        expect(edit.error.code).toBe(RLS_VIOLATION)

        await svc().from("sor_canvasses").delete().eq("id", first.id)
        const second = await makeCanvass(compNumber)
        expect(Number(second.number.slice(4))).toBeGreaterThan(Number(first.number.slice(4)))
        await svc().from("sor_canvasses").delete().eq("id", second.id)
    })
})

describe("an Offer", () => {
    let canvass

    beforeAll(async () => {
        canvass = await makeCanvass(compOffer)
    })

    it("defaults to PHP and refuses a currency that is not three capital letters", async () => {
        const offer = await makeOffer(canvass.id)
        expect(offer.currency).toBe("PHP")
        const bad = await svc().from("sor_canvass_offers").update({ currency: "usd" }).eq("id", offer.id)
        expect(bad.error.code).toBe(CHECK_VIOLATION)
    })

    it("refuses a comparison rate on a PHP Offer, and takes one on a foreign Offer", async () => {
        const php = await makeOffer(canvass.id)
        const refused = await svc().from("sor_canvass_offer_prices").update({ comparison_rate: 56.5 }).eq("offer_id", php.id)
        expect(refused.error.code).toBe(CHECK_VIOLATION)

        const usd = await makeOffer(canvass.id, { currency: "USD", supplier_name: "Hong Kong" }, { unit_price: 1280 })
        const ok = await svc().from("sor_canvass_offer_prices").update({ comparison_rate: 56.5625 }).eq("offer_id", usd.id)
        expect(ok.error).toBeNull()

        // Turning it back to PHP while the rate stands is refused; clearing the rate first works.
        const back = await svc().from("sor_canvass_offers").update({ currency: "PHP" }).eq("id", usd.id)
        expect(back.error.code).toBe(CHECK_VIOLATION)
        await asSvc(svc().from("sor_canvass_offer_prices").update({ comparison_rate: null }).eq("offer_id", usd.id), "clear rate")
        const again = await svc().from("sor_canvass_offers").update({ currency: "PHP" }).eq("id", usd.id)
        expect(again.error).toBeNull()
    })

    it("refuses a rate of zero or less", async () => {
        const usd = await makeOffer(canvass.id, { currency: "EUR", supplier_name: "Berlin" }, { unit_price: 10 })
        const zero = await svc().from("sor_canvass_offer_prices").update({ comparison_rate: 0 }).eq("offer_id", usd.id)
        expect(zero.error.code).toBe(CHECK_VIOLATION)
    })

    it("allows one winner at a time", async () => {
        const a = await makeOffer(canvass.id, { supplier_name: "A" }, null)
        const b = await makeOffer(canvass.id, { supplier_name: "B" }, null)
        await asSvc(svc().from("sor_canvass_offers").update({ is_winner: true }).eq("id", a.id), "first winner")
        const second = await svc().from("sor_canvass_offers").update({ is_winner: true }).eq("id", b.id)
        expect(second.error.code).toBe(UNIQUE_VIOLATION)
        await svc().from("sor_canvass_offers").update({ is_winner: false }).eq("id", a.id)
    })
})

describe("who writes", () => {
    it("lets Purchasing access and a Super Admin open a Canvass, add an Offer and its price", async () => {
        for (const [who, component] of [["outsider", compWrite], ["superAdmin", compWrite]]) {
            const client = await clientFor(who)
            const opened = await tryInsert(client, "sor_canvasses", { component_id: component, created_by: ids[who] })
            expect(opened.ok, `${who} opens`).toBe(true)
            canvassIds.push(opened.id)
            const offer = await tryInsert(client, "sor_canvass_offers", { canvass_id: opened.id, supplier_name: "Redleaf Inc.", currency: "USD" })
            expect(offer.ok, `${who} adds an Offer`).toBe(true)
            const price = await client.from("sor_canvass_offer_prices").insert({ offer_id: offer.id, unit_price: 1280, comparison_rate: 56.5 })
            expect(price.error, `${who} prices it`).toBeNull()
            expect(await tryUpdate(client, "sor_canvasses", opened.id, { reason: "Holds stock" })).toEqual({ ok: true, affected: 1 })
            const edit = await client.from("sor_canvass_offer_prices").update({ unit_price: 1300 }).eq("offer_id", offer.id).select("offer_id")
            expect(edit.data).toHaveLength(1)
            expect(await tryDelete(client, "sor_canvass_offers", offer.id)).toEqual({ ok: true, affected: 1 })
            expect(await tryDelete(client, "sor_canvasses", opened.id)).toEqual({ ok: true, affected: 1 })
        }
    })

    it("stamps the creator as the caller, whatever the row says", async () => {
        const opened = await tryInsert(await clientFor("outsider"), "sor_canvasses", { component_id: compWrite, created_by: ids.dealOwner })
        expect(opened.ok).toBe(true)
        const [row] = await asSvc(svc().from("sor_canvasses").select("created_by").eq("id", opened.id), "row")
        expect(row.created_by).toBe(ids.outsider)
        await svc().from("sor_canvasses").delete().eq("id", opened.id)
    })

    it("refuses the Deal Team, a Stage Participant, is_head alone and an outsider", async () => {
        const canvass = await makeCanvass(compWrite)
        const offer = await makeOffer(canvass.id)
        for (const who of ["dealOwner", "support", "stageParticipant", "head", "ordinary"]) {
            const client = await clientFor(who)
            const open = await tryInsert(client, "sor_canvasses", { component_id: compWrite })
            expect(open, `${who} opens`).toMatchObject({ ok: false, code: RLS_VIOLATION })
            const add = await tryInsert(client, "sor_canvass_offers", { canvass_id: canvass.id, supplier_name: "Sneak" })
            expect(add, `${who} adds an Offer`).toMatchObject({ ok: false, code: RLS_VIOLATION })
            const price = await client.from("sor_canvass_offer_prices").insert({ offer_id: offer.id, unit_price: 1 })
            expect(price.error?.code, `${who} prices`).toBe(RLS_VIOLATION)

            expect((await tryUpdate(client, "sor_canvasses", canvass.id, { reason: "x" })).affected, `${who} edits`).toBe(0)
            expect((await tryUpdate(client, "sor_canvass_offers", offer.id, { supplier_name: "x" })).affected, `${who} edits an Offer`).toBe(0)
            const reprice = await client.from("sor_canvass_offer_prices").update({ unit_price: 1 }).eq("offer_id", offer.id).select("offer_id")
            expect(reprice.data ?? [], `${who} reprices`).toHaveLength(0)
            expect((await tryDelete(client, "sor_canvass_offers", offer.id)).affected, `${who} deletes`).toBe(0)
        }
        const [kept] = await asSvc(svc().from("sor_canvasses").select("reason").eq("id", canvass.id), "row")
        expect(kept.reason).toBeNull()
        await svc().from("sor_canvasses").delete().eq("id", canvass.id)
    })
})

describe("who reads", () => {
    let canvass, offer

    beforeAll(async () => {
        canvass = await makeCanvass(compRead)
        offer = await makeOffer(canvass.id, { currency: "USD", supplier_name: "Hong Kong" }, { unit_price: 1280, comparison_rate: 56.5625 })
    })

    it("shows Purchasing, a Super Admin and the Deal Team the Canvass, its Offers and the prices", async () => {
        for (const who of ["outsider", "superAdmin", "dealOwner", "support"]) {
            const client = await clientFor(who)
            expect(await canRead(client, "sor_canvasses", canvass.id), `${who} reads the Canvass`).toBe(true)
            expect(await canRead(client, "sor_canvass_offers", offer.id), `${who} reads the Offer`).toBe(true)
            const { data } = await client.from("sor_canvass_offer_prices").select("*").eq("offer_id", offer.id)
            expect(data, `${who} reads the price`).toEqual([expect.objectContaining({ unit_price: 1280, comparison_rate: 56.5625 })])
            const money = await client.rpc("canvass_subject_can_read_money", { p_component_id: compRead, p_requested_item_id: null })
            expect(money.data, `${who} money`).toBe(true)
        }
    })

    it("shows a Stage Participant the Offers and not the prices", async () => {
        const client = await clientFor("stageParticipant")
        expect(await canRead(client, "sor_canvasses", canvass.id)).toBe(true)
        expect(await canRead(client, "sor_canvass_offers", offer.id)).toBe(true)
        const { data, error } = await client.from("sor_canvass_offer_prices").select("*").eq("offer_id", offer.id)
        expect(error).toBeNull()
        expect(data).toEqual([])
        const money = await client.rpc("canvass_subject_can_read_money", { p_component_id: compRead, p_requested_item_id: null })
        expect(money.data).toBe(false)
    })

    it("shows nothing to someone with no part in the SOR", async () => {
        for (const who of ["ordinary", "head"]) {
            const client = await clientFor(who)
            expect(await canRead(client, "sor_canvasses", canvass.id), `${who} Canvass`).toBe(false)
            expect(await canRead(client, "sor_canvass_offers", offer.id), `${who} Offer`).toBe(false)
            const { data } = await client.from("sor_canvass_offer_prices").select("*").eq("offer_id", offer.id)
            expect(data, `${who} price`).toEqual([])
        }
    })
})

describe("the migration", () => {
    it("raises when a Canvass table holds a row, and changes nothing", async () => {
        const client = await sql().connect()
        try {
            await client.query("begin")
            // Put the database back to what the migration expects to find, with a row in it.
            await client.query("alter table public.sor_canvasses add column procurement_request_id uuid")
            await client.query("insert into public.sor_canvasses (component_id) values ($1)", [compMigration])
            await expect(client.query(MIGRATION)).rejects.toThrow(/refusing to re-point/)
        } finally {
            await client.query("rollback").catch(() => {})
            client.release()
        }
        const { data } = await svc().from("sor_canvasses").select("id").eq("component_id", compMigration)
        expect(data).toEqual([])
    })

    it("runs again over empty tables without complaint", async () => {
        const client = await sql().connect()
        try {
            await client.query("begin")
            await client.query(MIGRATION)
        } finally {
            await client.query("rollback").catch(() => {})
            client.release()
        }
    })
})
