/**
 * On-Hold and the facts behind the IPAS Status (#597, spec #595): the database rules.
 *
 * `outsider` holds Purchasing access and raises the IPAS; `finance` holds Finance
 * access alone; `ipasSigner`, `superAdmin` (no flag), `ordinary` and `dealOwner` hold
 * neither. `ipas_set_on_hold` is the one function that sets and clears the flag. It
 * needs Purchasing or Finance access, works on an OPEN IPAS only, writes a history
 * event per change, and filing clears the flag. `ipas_worked_on` is the "changed since
 * raising" fact the status reads.
 *
 * The status itself is never stored and is proven in the unit tier (utils/ipasFigures.test.js).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P9${String(98000 + (poSeq += 1)).padStart(6, "0")}`

const copyFor = (po) => ({
    po: { id: 873000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_830_000 + poSeq, name: "On-Hold Supplier", contact: null },
    lines: [
        { line_id: 883000 + poSeq * 10, product_id: 7800, name: "Item 1", quantity: 1, unit: "Unit", price_unit: 100, price_subtotal: 100, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise() {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po),
    })
    if (error) throw new Error(`ipas raise ${po}: ${error.message}`)
    return data
}

const hold = (who, ipasId, onHold, note) =>
    rpc(who, "ipas_set_on_hold", { p_ipas_id: ipasId, p_on_hold: onHold, p_note: note ?? null })

const rowOf = async (id) => (await svc().from("ipas").select("*").eq("id", id).single()).data
const holdEvents = async (id) => {
    const { data, error } = await svc()
        .from("ipas_events")
        .select("kind, actor_id, detail")
        .eq("ipas_id", id)
        .like("kind", "on_hold_%")
        .order("created_at")
    if (error) throw error
    return data
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("who may put an IPAS On-Hold", () => {
    it("lets Purchasing access and Finance access set and clear it", async () => {
        for (const who of ["outsider", "finance"]) {
            const ipas = await raise()
            const set = await hold(who, ipas.id, true, `held by ${who}`)
            expect(set.error, `${who} was refused`).toBeNull()
            expect(set.data).toMatchObject({ on_hold: true, on_hold_note: `held by ${who}` })
            expect(await rowOf(ipas.id)).toMatchObject({ on_hold: true, on_hold_note: `held by ${who}` })

            const cleared = await hold(who, ipas.id, false)
            expect(cleared.error, `${who} could not clear it`).toBeNull()
            expect(await rowOf(ipas.id)).toMatchObject({ on_hold: false, on_hold_note: null })
        }
    })

    it("refuses everyone else with 42501, and changes nothing", async () => {
        const ipas = await raise()
        for (const who of ["ipasSigner", "superAdmin", "ordinary", "dealOwner"]) {
            const { data, error } = await hold(who, ipas.id, true, "nope")
            expect(data ?? null, `${who} put it on hold`).toBeNull()
            expect(error?.code, `${who} was not refused with 42501`).toBe("42501")
        }
        const anon = await anonymousClient().rpc("ipas_set_on_hold", { p_ipas_id: ipas.id, p_on_hold: true, p_note: null })
        expect(anon.error).toBeTruthy()
        expect((await rowOf(ipas.id)).on_hold).toBe(false)
        expect(await holdEvents(ipas.id)).toEqual([])
    })

    it("refuses clearing it too, for someone without access", async () => {
        const ipas = await raise()
        expect((await hold("outsider", ipas.id, true, "supplier issue")).error).toBeNull()
        const refused = await hold("ordinary", ipas.id, false)
        expect(refused.error?.code).toBe("42501")
        expect((await rowOf(ipas.id)).on_hold).toBe(true)
    })

    it("cannot be flipped by a direct table write", async () => {
        const ipas = await raise()
        const { data } = await (await clientFor("outsider")).from("ipas").update({ on_hold: true }).eq("id", ipas.id).select("id")
        expect(data ?? []).toEqual([])
        expect((await rowOf(ipas.id)).on_hold).toBe(false)
    })
})

describe("open IPAS only", () => {
    it("refuses a cancelled IPAS", async () => {
        const ipas = await raise()
        expect((await rpc("outsider", "ipas_cancel", { p_ipas_id: ipas.id, p_reason: "Raised in error" })).error).toBeNull()
        const { error } = await hold("outsider", ipas.id, true, "too late")
        expect(error?.code).toBe("22023")
        expect((await rowOf(ipas.id)).on_hold).toBe(false)
    })

    it("refuses a filed IPAS", async () => {
        const ipas = await raise()
        // Filed directly: the freeze guard only protects a row that is already filed.
        const filed = await svc().from("ipas").update({ state: "filed", filed_at: new Date().toISOString() }).eq("id", ipas.id)
        expect(filed.error).toBeNull()
        const { error } = await hold("outsider", ipas.id, true, "too late")
        expect(error?.code).toBe("22023")
        expect((await rowOf(ipas.id)).on_hold).toBe(false)
    })

    it("refuses an IPAS that is not there", async () => {
        const { error } = await hold("outsider", "00000000-0000-4000-8000-000000000597", true, null)
        expect(error?.code).toBe("22023")
    })
})

describe("history", () => {
    it("writes an event for each change, with who and the note", async () => {
        const ipas = await raise()
        expect((await hold("outsider", ipas.id, true, "waiting on the client")).error).toBeNull()
        expect((await hold("finance", ipas.id, true, "supplier issue")).error).toBeNull()
        expect((await hold("finance", ipas.id, false)).error).toBeNull()

        const events = await holdEvents(ipas.id)
        expect(events.map((e) => e.kind)).toEqual(["on_hold_set", "on_hold_changed", "on_hold_cleared"])
        expect(events.map((e) => e.actor_id)).toEqual([ids.outsider, ids.finance, ids.finance])
        expect(events[0].detail).toMatchObject({ note: "waiting on the client", previous_note: null })
        expect(events[1].detail).toMatchObject({ note: "supplier issue", previous_note: "waiting on the client" })
        expect(events[2].detail).toMatchObject({ note: null, previous_note: "supplier issue" })
    })

    it("treats a blank note as no note, and writes nothing when nothing changes", async () => {
        const ipas = await raise()
        expect((await hold("outsider", ipas.id, true, "   ")).data).toMatchObject({ on_hold: true, on_hold_note: null })
        expect((await hold("outsider", ipas.id, true, null)).error).toBeNull()
        expect((await hold("outsider", ipas.id, false)).error).toBeNull()
        expect((await hold("outsider", ipas.id, false)).error).toBeNull()
        expect((await holdEvents(ipas.id)).map((e) => e.kind)).toEqual(["on_hold_set", "on_hold_cleared"])
    })

    it("does not count its own events as the IPAS having been worked on", async () => {
        const ipas = await raise()
        expect((await hold("outsider", ipas.id, true, "x")).error).toBeNull()
        const { data, error } = await rpc("outsider", "ipas_worked_on", { p_ipas_ids: [ipas.id] })
        expect(error).toBeNull()
        expect(data).toEqual([])
    })
})

describe("filing clears On-Hold", () => {
    it("drops the flag and the note and writes a cleared event", async () => {
        const ipas = await raise()
        expect((await hold("outsider", ipas.id, true, "supplier issue")).error).toBeNull()

        const filed = await svc().from("ipas").update({ state: "filed", filed_at: new Date().toISOString() }).eq("id", ipas.id)
        expect(filed.error).toBeNull()

        expect(await rowOf(ipas.id)).toMatchObject({ state: "filed", on_hold: false, on_hold_note: null })
        const events = await holdEvents(ipas.id)
        expect(events.map((e) => e.kind)).toEqual(["on_hold_set", "on_hold_cleared"])
        expect(events[1].detail).toMatchObject({ reason: "filed", previous_note: "supplier issue" })
    })

    it("writes nothing when the IPAS was not on hold", async () => {
        const ipas = await raise()
        const filed = await svc().from("ipas").update({ state: "filed", filed_at: new Date().toISOString() }).eq("id", ipas.id)
        expect(filed.error).toBeNull()
        expect(await holdEvents(ipas.id)).toEqual([])
    })
})

describe("worked on since it was raised (ipas_worked_on)", () => {
    it("is false for a fresh IPAS and true once something other than the system's entries is in its history", async () => {
        const fresh = await raise()
        const touched = await raise()
        expect((await rpc("outsider", "ipas_set_header", { p_ipas_id: touched.id, p_fields: { computation_status: "encoded" } })).error).toBeNull()

        const { data, error } = await rpc("outsider", "ipas_worked_on", { p_ipas_ids: [fresh.id, touched.id] })
        expect(error).toBeNull()
        expect(data).toEqual([touched.id])
    })

    it("answers nothing for an IPAS the caller cannot read", async () => {
        const touched = await raise()
        expect((await rpc("outsider", "ipas_set_header", { p_ipas_id: touched.id, p_fields: { computation_status: "encoded" } })).error).toBeNull()
        const { data } = await rpc("ordinary", "ipas_worked_on", { p_ipas_ids: [touched.id] })
        expect(data ?? []).toEqual([])
    })
})
