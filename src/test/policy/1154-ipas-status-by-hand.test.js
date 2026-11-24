/**
 * The IPAS Status, set by hand (#1154, spec #1151, ADR 0054): the database rules.
 *
 * `outsider` holds Purchasing access and raises; `finance` holds Finance access alone; `superAdmin` is a
 * Super Admin with neither flag; `ipasSigner` is a plain employee that a test gives Logistics access;
 * `ordinary` is nobody to the IPAS.
 *
 * Everything runs through the real `ipas_set_status`, `ipas_set_status_date`, `ipas_reopen`, `ipas_cancel`
 * and the lifecycle trigger. Filing is simulated by moving the state, which is what `ipas_sign` does on
 * section 7's Approved.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0

const manilaDay = (offsetDays = 0) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86_400_000))

const copyFor = (po, state = "purchase") => ({
    po: { id: 1154000 + poSeq, name: po, state, company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_154_000 + poSeq, name: "Status Supplier", contact: null },
    lines: [{ line_id: 1154500 + poSeq * 10, product_id: 7710, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null }],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise(source = "import") {
    const po = `P9${String(115400 + (poSeq += 1)).padStart(6, "0")}`
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: source,
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const setStep = (who, ipasId, step, on = null) => rpc(who, "ipas_set_status", { p_ipas_id: ipasId, p_step: step, p_reached_on: on })
const stepsOf = async (ipasId) =>
    (await svc().from("ipas_status_steps").select("step, reached_on").eq("ipas_id", ipasId)).data
        .map((r) => [r.step, r.reached_on])
        .sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))
const stepNames = async (ipasId) => (await stepsOf(ipasId)).map(([step]) => step).sort()
const statusOf = async (ipasId) => (await svc().from("ipas").select("status").eq("id", ipasId).single()).data.status
const events = async (ipasId, kind) =>
    (await svc().from("ipas_events").select("*").eq("ipas_id", ipasId).eq("kind", kind).order("created_at", { ascending: true })).data

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    const logistics = await svc().from("employees").update({ has_logistics_flow: true }).eq("id", ids.ipasSigner)
    if (logistics.error) throw logistics.error
})

afterAll(async () => {
    await svc().from("employees").update({ has_logistics_flow: false }).eq("id", ids.ipasSigner)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("a new IPAS", () => {
    it("starts at Order-Draft, dated its raise day", async () => {
        const ipas = await raise()
        expect(await statusOf(ipas.id)).toBe("order_draft")
        expect(await stepsOf(ipas.id)).toEqual([["order_draft", manilaDay()]])
    })
})

describe("who sets the status", () => {
    it("lets Purchasing, Logistics access and a Super Admin", async () => {
        for (const who of ["outsider", "ipasSigner", "superAdmin"]) {
            const ipas = await raise()
            const { error } = await setStep(who, ipas.id, "ordered")
            expect(error, who).toBeNull()
            expect(await statusOf(ipas.id)).toBe("ordered")
        }
    })

    it("refuses everyone else, Finance alone included", async () => {
        const ipas = await raise()
        for (const who of CAST_KEYS.filter((k) => !["outsider", "ipasSigner", "superAdmin"].includes(k))) {
            const { error } = await setStep(who, ipas.id, "ordered")
            expect(error?.code, `${who} set the status`).toBe("42501")
        }
        expect(await statusOf(ipas.id)).toBe("order_draft")
    })
})

describe("forward, skip and back", () => {
    it("jumps Ordered to In Transit leaving In Production and Shipped blank, and going back deletes In Transit with both moves in history", async () => {
        const ipas = await raise()
        await setStep("outsider", ipas.id, "ordered", manilaDay(-7))
        await setStep("outsider", ipas.id, "in_transit", manilaDay(-2))
        expect(await stepNames(ipas.id)).toEqual(["in_transit", "order_draft", "ordered"])

        const back = await setStep("outsider", ipas.id, "ordered")

        expect(back.error).toBeNull()
        expect(await statusOf(ipas.id)).toBe("ordered")
        expect(await stepNames(ipas.id)).toEqual(["order_draft", "ordered"])
        const moves = await events(ipas.id, "status_changed")
        expect(moves.map((e) => [e.detail.from, e.detail.to])).toEqual([
            ["order_draft", "ordered"],
            ["ordered", "in_transit"],
            ["in_transit", "ordered"],
        ])
        expect(moves.at(-1).detail.cleared).toEqual(["in_transit"])
        expect(moves.at(-1).actor_id).toBe(ids.outsider)
    })

    it("keeps the earlier step's own day when going back, and writes nothing when nothing changes", async () => {
        const ipas = await raise()
        await setStep("outsider", ipas.id, "ordered", manilaDay(-5))
        await setStep("outsider", ipas.id, "shipped", manilaDay(-3))

        await setStep("outsider", ipas.id, "ordered")
        expect((await stepsOf(ipas.id)).find(([step]) => step === "ordered")[1]).toBe(manilaDay(-5))

        const before = (await events(ipas.id, "status_changed")).length
        await setStep("outsider", ipas.id, "ordered")
        expect((await events(ipas.id, "status_changed")).length).toBe(before)
    })
})

describe("the date", () => {
    it("defaults to today, accepts last week and refuses tomorrow", async () => {
        const ipas = await raise()
        expect((await setStep("outsider", ipas.id, "ordered")).error).toBeNull()
        expect((await stepsOf(ipas.id)).find(([step]) => step === "ordered")[1]).toBe(manilaDay())

        const other = await raise()
        expect((await setStep("outsider", other.id, "ordered", manilaDay(-7))).error).toBeNull()
        expect((await setStep("outsider", other.id, "shipped", manilaDay(1))).error?.code).toBe("22023")
    })

    it("allows a day before the previous dated step (the record only warns)", async () => {
        const ipas = await raise()
        await setStep("outsider", ipas.id, "ordered", manilaDay(-3))

        expect((await setStep("outsider", ipas.id, "shipped", manilaDay(-6))).error).toBeNull()
        expect((await setStep("outsider", ipas.id, "payment_approval", manilaDay(-9))).error).toBeNull()
    })

    it("changes the day of a step already reached, even out of order", async () => {
        const ipas = await raise()
        await setStep("outsider", ipas.id, "ordered", manilaDay(-9))
        await setStep("outsider", ipas.id, "shipped", manilaDay(-3))

        const moved = await rpc("outsider", "ipas_set_status_date", { p_ipas_id: ipas.id, p_step: "ordered", p_on: manilaDay(-5) })

        expect(moved.error).toBeNull()
        expect((await stepsOf(ipas.id)).find(([step]) => step === "ordered")[1]).toBe(manilaDay(-5))
        expect((await events(ipas.id, "status_date_changed")).at(-1).detail).toMatchObject({ step: "ordered", to: manilaDay(-5) })
        expect((await rpc("outsider", "ipas_set_status_date", { p_ipas_id: ipas.id, p_step: "ordered", p_on: manilaDay(-1) })).error).toBeNull()
        expect((await rpc("outsider", "ipas_set_status_date", { p_ipas_id: ipas.id, p_step: "in_production", p_on: manilaDay(-4) })).error?.code).toBe("22023")
    })
})

describe("Local and Import steps", () => {
    it("refuses Customs, Arrived at Local Hub and Out for Delivery on a Local IPAS", async () => {
        const ipas = await raise("local")
        for (const step of ["customs", "local_hub", "out_for_delivery"]) {
            expect((await setStep("outsider", ipas.id, step)).error?.code, step).toBe("22023")
        }
        expect(await statusOf(ipas.id)).toBe("order_draft")
    })

    it("offers them on an Import IPAS, and a source change to Local deletes them", async () => {
        const ipas = await raise("import")
        await setStep("outsider", ipas.id, "customs", manilaDay(-1))
        expect(await stepNames(ipas.id)).toContain("customs")

        await sql().query(`update public.ipas set source = 'local' where id = $1`, [ipas.id])

        expect(await stepNames(ipas.id)).not.toContain("customs")
        expect(await statusOf(ipas.id)).toBe("order_draft")
    })
})

describe("Done", () => {
    it("is refused by hand", async () => {
        const ipas = await raise()
        expect((await setStep("outsider", ipas.id, "done")).error?.code).toBe("22023")
    })

    it("comes from filing, and reopening falls back to the furthest dated step before it", async () => {
        const ipas = await raise()
        await setStep("outsider", ipas.id, "in_transit", manilaDay(-2))

        await sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [ipas.id])
        expect(await statusOf(ipas.id)).toBe("done")
        expect(await stepNames(ipas.id)).toContain("done")

        const reopened = await rpc("superAdmin", "ipas_reopen", { p_ipas_id: ipas.id, p_reason: "Wrong bill" })
        expect(reopened.error).toBeNull()
        expect(await statusOf(ipas.id)).toBe("in_transit")
        expect(await stepNames(ipas.id)).not.toContain("done")
    })

    it("is refused on a filed or cancelled IPAS", async () => {
        const filed = await raise()
        await sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [filed.id])
        expect((await setStep("outsider", filed.id, "ordered")).error?.code).toBe("22023")

        const cancelled = await raise()
        expect((await rpc("outsider", "ipas_cancel", { p_ipas_id: cancelled.id, p_reason: "Wrong PO" })).error).toBeNull()
        expect(await statusOf(cancelled.id)).toBeNull()
        expect((await setStep("outsider", cancelled.id, "ordered")).error?.code).toBe("22023")
    })
})

describe("On-Hold", () => {
    it("stays a flag over the step and clearing it leaves the step", async () => {
        const ipas = await raise()
        await setStep("outsider", ipas.id, "in_transit")

        expect((await rpc("outsider", "ipas_set_on_hold", { p_ipas_id: ipas.id, p_on_hold: true, p_note: "Broker" })).error).toBeNull()
        expect(await statusOf(ipas.id)).toBe("in_transit")
        expect((await rpc("outsider", "ipas_set_on_hold", { p_ipas_id: ipas.id, p_on_hold: false, p_note: null })).error).toBeNull()
        expect(await statusOf(ipas.id)).toBe("in_transit")
    })
})

describe("retired writers", () => {
    it("lose their grants", async () => {
        const ipas = await raise()
        const origin = await rpc("outsider", "ipas_set_supplier_origin", { p_ipas_id: ipas.id, p_fields: { shipped_out_on: "2026-10-01" } })
        const typed = await rpc("outsider", "ipas_set_typed_status", { p_ipas_id: ipas.id, p_status: "delivered", p_date: "2026-10-02" })
        expect(origin.error?.code).toBe("42501")
        expect(typed.error?.code).toBe("42501")
    })
})

describe("Logistics waits for Delivered", () => {
    it("asks a Local IPAS for the Delivered step too", async () => {
        const ipas = await raise("local")
        const missing = async () => (await sql().query(`select public._ipas_logistics_missing($1) as m`, [ipas.id])).rows[0].m
        expect(await missing()).toContain("the Delivered status")

        await setStep("outsider", ipas.id, "delivered", manilaDay(-1))

        expect(await missing()).not.toContain("the Delivered status")
    })
})

describe("the switch-over", () => {
    // The migration runs `_ipas_status_switch_over(null)` once for every IPAS. Here it runs for one seeded IPAS at a time,
    // after its rows are cleared back to what an IPAS held before this ticket.
    async function switchedOver({ source = "import", set = null, poState = "pending", prepared = false } = {}) {
        const ipas = await raise(source)
        await sql().query(`delete from public.ipas_status_steps where ipas_id = $1`, [ipas.id])
        await sql().query(`update public.ipas set status = null, odoo_copy = jsonb_set(odoo_copy, '{po,state}', to_jsonb($2::text)) where id = $1`, [ipas.id, poState])
        if (set) await sql().query(`update public.ipas set ${set} where id = $1`, [ipas.id])
        if (prepared) {
            // A sign-off that already existed before this ticket: the documents guard would refuse a fresh one
            // (section 1 needs its Proforma Invoice), so it goes in with triggers off, as the old data was.
            const client = await sql().connect()
            try {
                await client.query("begin")
                await client.query("set local session_replication_role = replica")
                await client.query(
                    `insert into public.ipas_signoffs (ipas_id, section, role, signed_by) values ($1, 1, 'prepared', $2)`,
                    [ipas.id, ids.outsider],
                )
                await client.query("commit")
            } finally {
                client.release()
            }
        }
        await sql().query(`select public._ipas_status_switch_over($1)`, [ipas.id])
        return { id: ipas.id, status: await statusOf(ipas.id), steps: Object.fromEntries(await stepsOf(ipas.id)) }
    }

    it("gives an IPAS with nothing recorded Order-Draft, dated its raise day", async () => {
        const done = await switchedOver()
        expect(done.status).toBe("order_draft")
        expect(done.steps).toEqual({ order_draft: manilaDay() })
    })

    it("maps a confirmed Odoo PO to Ordered and a live section 1 Prepared to Payment Approval", async () => {
        expect((await switchedOver({ poState: "purchase" })).status).toBe("ordered")
        expect((await switchedOver({ prepared: true })).status).toBe("payment_approval")
        const both = await switchedOver({ poState: "done", prepared: true })
        expect(both.status).toBe("ordered")
        expect(Object.keys(both.steps).sort()).toEqual(["order_draft", "ordered", "payment_approval"])
    })

    it("maps the Supplier Origin dates to Shipped, In Transit and Customs, carrying the dates over", async () => {
        const shipped = await switchedOver({ set: `shipped_out_on = '2026-10-01'` })
        expect(shipped.status).toBe("shipped")
        expect(shipped.steps.shipped).toBe("2026-10-01")

        const customs = await switchedOver({ set: `shipped_out_on = '2026-10-01', onboard_on = '2026-10-03', arrived_in_ph_on = '2026-10-09'` })
        expect(customs.status).toBe("customs")
        expect(customs.steps).toMatchObject({ shipped: "2026-10-01", in_transit: "2026-10-03", customs: "2026-10-09" })
    })

    it("maps arrived in Whs. or a typed Delivered to Delivered, and leaves Import Clearance out", async () => {
        const whs = await switchedOver({ set: `arrived_in_whs_on = '2026-10-11', import_clearance_on = '2026-10-10'` })
        expect(whs.status).toBe("delivered")
        expect(whs.steps.delivered).toBe("2026-10-11")
        expect(Object.keys(whs.steps)).not.toContain("import_clearance")

        const local = await switchedOver({ source: "local", set: `delivered_on = '2026-10-12'` })
        expect(local.status).toBe("delivered")
        expect(local.steps.delivered).toBe("2026-10-12")
    })

    it("maps filed to Done and cancelled to nothing, and leaves On-Hold alone", async () => {
        const filed = await raise()
        await sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [filed.id])
        await sql().query(`delete from public.ipas_status_steps where ipas_id = $1`, [filed.id])
        await sql().query(`select public._ipas_status_switch_over($1)`, [filed.id])
        expect(await statusOf(filed.id)).toBe("done")

        const held = await raise()
        await sql().query(`update public.ipas set on_hold = true, on_hold_note = 'Broker' where id = $1`, [held.id])
        await sql().query(`select public._ipas_status_switch_over($1)`, [held.id])
        expect((await svc().from("ipas").select("on_hold, on_hold_note").eq("id", held.id).single()).data).toEqual({ on_hold: true, on_hold_note: "Broker" })

        const cancelled = await raise()
        await rpc("outsider", "ipas_cancel", { p_ipas_id: cancelled.id, p_reason: "Wrong PO" })
        await sql().query(`select public._ipas_status_switch_over($1)`, [cancelled.id])
        expect(await statusOf(cancelled.id)).toBeNull()
    })
})
