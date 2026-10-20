/**
 * Raise, list and cancel an IPAS (#242, spec #241): the database rules.
 *
 * `outsider` is given Purchasing access for the file and is the purchaser;
 * `finance` holds Finance access alone; `ipasSigner` is a plain employee put on
 * the `s1_approved` sign-off list; `ordinary` is nobody to the IPAS.
 *
 * Every IPAS here is raised through the real `ipas_create`, or through the
 * service role where a test needs a row the RPC would refuse. A Project IPAS
 * can't be inserted in a single service-role statement (the deferred SOR rule
 * commits per statement), so those are built inside one pg transaction.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql, rlsStatus } from "./support/stack.js"
import { makeSor } from "./support/rows.js"
import { purgeFixtureIpas, raiseAsPurchaser, raiseIpas } from "./support/ipas.js"
import { canRead, tryInsert, tryUpdate, tryDelete, RLS_VIOLATION } from "./support/access.js"

const svc = () => serviceClient()

let poSeq = 0
/** A PO number nothing else in the tier uses. */
const nextPo = () => `P9${String(70000 + (poSeq += 1)).padStart(6, "0")}`

const odooCopy = (po, { lines } = {}) => ({
    po: { id: 880000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 553, name: "Scorpe Technologies", contact: null },
    lines: lines ?? [
        { line_id: 900001 + poSeq * 10, product_id: 5350, name: "Cutter", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [], brand: "SCORPE" },
        { line_id: 900002 + poSeq * 10, product_id: 5351, name: "Blade", quantity: 1, unit: "Unit", price_unit: 80, price_subtotal: 80, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const ARGS = (po, over = {}) => ({
    p_po_number: po,
    p_priority: "high",
    p_source: "local",
    p_purpose: "inventory",
    p_sor_ids: [],
    p_remarks: null,
    p_odoo_copy: odooCopy(po),
    ...over,
})

const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

/** Raises an IPAS as the purchaser, failing the test loudly if it can't. */
async function raise(over = {}, po = nextPo()) {
    const { data, error } = await raiseAsPurchaser(ARGS(po, over))
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const numberOf = (ipas) => Number(String(ipas.number).replace(/\D/g, ""))

async function readRow(table, id) {
    const { data, error } = await svc().from(table).select("*").eq("id", id).maybeSingle()
    if (error) throw error
    return data
}

let sorA, sorB
let refA

async function seedSor(ref) {
    const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    const { error } = await svc().from("sales_opportunities").update({ sales_reference: ref }).eq("id", id)
    if (error) throw new Error(`Seeding a Sales Reference: ${error.message}`)
    return id
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    const member = await svc().from("ipas_signer_lists").insert({ list_key: "s1_approved", employee_id: ids.ipasSigner })
    if (member.error) throw member.error

    refA = `S9${String(Date.now()).slice(-6)}`
    sorA = await seedSor(refA)
    sorB = await seedSor(`S8${String(Date.now()).slice(-6)}`)
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await svc().from("ipas_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    await svc().from("sales_opportunities").delete().in("id", [sorA, sorB].filter(Boolean))
})

describe("the IPAS tables are protected", () => {
    it.each([["ipas"], ["ipas_sors"], ["ipas_events"], ["ipas_signer_lists"]])(
        "has row level security on and a policy: %s",
        async (table) => {
            const { enabled, policies } = await rlsStatus(table)
            expect(enabled, `${table} has RLS switched off`).toBe(true)
            expect(policies, `${table} has no policy`).toBeGreaterThan(0)
        },
    )
})

describe("raising an IPAS", () => {
    it("numbers it TGIPAS_ plus a zero-padded sequence value, from 49 on", async () => {
        const ipas = await raise()
        expect(ipas.number).toMatch(/^TGIPAS_\d{3,}$/)
        expect(numberOf(ipas)).toBeGreaterThanOrEqual(49)
        expect(ipas).toMatchObject({ state: "open", created_by: ids.outsider, purpose: "inventory", priority: "high", source: "local" })
        expect(ipas.odoo_fetched_at).toBeTruthy()
        expect(ipas.odoo_copy.lines).toHaveLength(2)
    })

    it("normalises the PO number and takes the Odoo id from the copy", async () => {
        const po = nextPo()
        const ipas = await raise({ p_po_number: ` ${po.toLowerCase()} `, p_odoo_copy: odooCopy(po) }, po)
        expect(ipas.po_number).toBe(po)
        expect(ipas.odoo_po_id).toBe(odooCopy(po).po.id)
    })

    it("writes a 'created' event naming the actor", async () => {
        const ipas = await raise({ p_remarks: "  Stock  " })
        expect(ipas.remarks).toBe("Stock")
        const { data } = await svc().from("ipas_events").select("*").eq("ipas_id", ipas.id)
        expect(data).toEqual([
            expect.objectContaining({ kind: "created", actor_id: ids.outsider, detail: expect.objectContaining({ number: ipas.number }) }),
        ])
    })

    it.each([
        ["a PO number that isn't Odoo's", { p_po_number: "PO-12", p_odoo_copy: odooCopy("PO-12") }],
        ["a Priority that isn't one", { p_priority: "urgent" }],
        ["a Source that isn't one", { p_source: "air" }],
        ["a Purpose that isn't one", { p_purpose: "gift" }],
        ["no Odoo copy", { p_odoo_copy: null }],
        ["an Odoo copy with no lines", { p_odoo_copy: { po: { name: "P1" } } }],
    ])("refuses %s", async (_, over) => {
        const { error } = await raiseAsPurchaser(ARGS(nextPo(), over))
        expect(error?.code).toBe("22023")
    })

    it("refuses an Odoo copy that is for a different PO", async () => {
        const po = nextPo()
        const { error } = await raiseAsPurchaser(ARGS(po, { p_odoo_copy: odooCopy(nextPo()) }))
        expect(error?.code).toBe("22023")
        expect(error?.message).toMatch(/not P9/)
    })
})

describe("one live IPAS per PO", () => {
    it("refuses a second live IPAS for the same PO, naming the first", async () => {
        const po = nextPo()
        const first = await raise({}, po)
        const { error } = await raiseAsPurchaser(ARGS(po))
        expect(error?.code).toBe("23505")
        expect(error?.message).toContain(first.number)
    })

    it("holds even when the row is inserted straight past the RPC", async () => {
        const po = nextPo()
        await raise({}, po)
        const { error } = await svc().from("ipas").insert({
            po_number: po,
            priority: "high",
            source: "local",
            purpose: "inventory",
            odoo_copy: odooCopy(po),
            created_by: ids.outsider,
        })
        expect(error?.code).toBe("23505")
        expect(error?.message).toMatch(/ipas_live_po_number_key/)
    })

    it("allows a new IPAS once the first is cancelled, and keeps the cancelled one", async () => {
        const po = nextPo()
        const first = await raise({}, po)
        expect((await rpc("outsider", "ipas_cancel", { p_ipas_id: first.id, p_reason: "Wrong PO" })).error).toBeNull()

        const second = await raise({}, po)
        expect(second.id).not.toBe(first.id)
        expect(second.state).toBe("open")
        expect((await readRow("ipas", first.id)).state).toBe("cancelled")

        // And the second is live again.
        expect((await raiseAsPurchaser(ARGS(po))).error?.code).toBe("23505")
    })

    it("never changes a PO number after insert", async () => {
        const ipas = await raise()
        const { error } = await svc().from("ipas").update({ po_number: nextPo() }).eq("id", ipas.id)
        expect(error?.code).toBe("42501")
        expect(error?.message).toMatch(/cancel it and raise a new IPAS/)
        expect((await readRow("ipas", ipas.id)).po_number).toBe(ipas.po_number)
    })
})

describe("numbers are never reused", () => {
    it("gives the next IPAS a higher number after the newest is cancelled", async () => {
        const newest = await raise()
        const cancelled = await rpc("outsider", "ipas_cancel", { p_ipas_id: newest.id, p_reason: "Dropped" })
        expect(cancelled.error).toBeNull()

        const another = await raise()
        expect(numberOf(another)).toBeGreaterThan(numberOf(newest))
        expect(another.number).not.toBe(newest.number)
        // The cancelled number is still on its row.
        expect((await readRow("ipas", newest.id)).number).toBe(newest.number)
    })

    it("never changes a number after insert", async () => {
        const ipas = await raise()
        const { error } = await svc().from("ipas").update({ number: "TGIPAS_001" }).eq("id", ipas.id)
        expect(error?.code).toBe("42501")
    })
})

describe("a Project needs an SOR; no other Purpose may have one", () => {
    it("raises a Project with an SOR and records it", async () => {
        const ipas = await raise({ p_purpose: "project", p_sor_ids: [sorA] })
        const { data } = await svc().from("ipas_sors").select("opportunity_id").eq("ipas_id", ipas.id)
        expect(data).toEqual([{ opportunity_id: sorA }])
    })

    it("refuses a Project with no SOR, and a non-Project with one", async () => {
        const project = await raiseAsPurchaser(ARGS(nextPo(), { p_purpose: "project", p_sor_ids: [] }))
        expect(project.error?.code).toBe("22023")
        for (const purpose of ["inventory", "supplies", "events"]) {
            const other = await raiseAsPurchaser(ARGS(nextPo(), { p_purpose: purpose, p_sor_ids: [sorA] }))
            expect(other.error?.code, purpose).toBe("22023")
        }
    })

    it("refuses an SOR that doesn't exist", async () => {
        const { error } = await raiseAsPurchaser(ARGS(nextPo(), {
            p_purpose: "project",
            p_sor_ids: ["00000000-0000-0000-0000-000000000000"],
        }))
        expect(error?.code).toBe("P0002")
    })

    it("refuses to commit a Project IPAS with no SOR, however it is written", async () => {
        const po = nextPo()
        const { error } = await svc().from("ipas").insert({
            po_number: po,
            priority: "high",
            source: "local",
            purpose: "project",
            odoo_copy: odooCopy(po),
            created_by: ids.outsider,
        })
        expect(error?.code).toBe("23514")
        expect(error?.message).toMatch(/needs at least one SOR/)
        const { data } = await svc().from("ipas").select("id").eq("po_number", po)
        expect(data).toEqual([])
    })

    it("refuses to commit a non-Project IPAS that names an SOR", async () => {
        const po = nextPo()
        const client = await sql().connect()
        try {
            await client.query("begin")
            const { rows } = await client.query(
                `insert into public.ipas (po_number, priority, source, purpose, odoo_copy, created_by)
                 values ($1, 'high', 'local', 'supplies', $2, $3) returning id`,
                [po, odooCopy(po), ids.outsider],
            )
            await client.query(`insert into public.ipas_sors (ipas_id, opportunity_id) values ($1, $2)`, [rows[0].id, sorA])
            await expect(client.query("commit")).rejects.toMatchObject({ code: "23514" })
        } finally {
            await client.query("rollback").catch(() => {})
            client.release()
        }
        const { data } = await svc().from("ipas").select("id").eq("po_number", po)
        expect(data).toEqual([])
    })

    it("refuses to commit a Project IPAS whose last SOR is removed", async () => {
        const ipas = await raise({ p_purpose: "project", p_sor_ids: [sorA] })
        const { error } = await svc().from("ipas_sors").delete().eq("ipas_id", ipas.id)
        expect(error?.code).toBe("23514")
        const { data } = await svc().from("ipas_sors").select("id").eq("ipas_id", ipas.id)
        expect(data).toHaveLength(1)
    })

    it("lets Purpose and SORs change together until Filing, with history", async () => {
        const ipas = await raise({ p_purpose: "project", p_sor_ids: [sorA] })

        const widened = await rpc("outsider", "ipas_set_purpose_and_sors", {
            p_ipas_id: ipas.id,
            p_purpose: "project",
            p_sor_ids: [sorA, sorB],
        })
        expect(widened.error).toBeNull()
        expect((await svc().from("ipas_sors").select("id").eq("ipas_id", ipas.id)).data).toHaveLength(2)

        const supplies = await rpc("outsider", "ipas_set_purpose_and_sors", {
            p_ipas_id: ipas.id,
            p_purpose: "supplies",
            p_sor_ids: [],
        })
        expect(supplies.error).toBeNull()
        expect(supplies.data.purpose).toBe("supplies")
        expect((await svc().from("ipas_sors").select("id").eq("ipas_id", ipas.id)).data).toEqual([])

        const back = await rpc("outsider", "ipas_set_purpose_and_sors", {
            p_ipas_id: ipas.id,
            p_purpose: "project",
            p_sor_ids: [sorB],
        })
        expect(back.error).toBeNull()

        const { data: events } = await svc()
            .from("ipas_events")
            .select("kind")
            .eq("ipas_id", ipas.id)
            .order("created_at")
        expect(events.map((e) => e.kind)).toEqual([
            "created",
            "purpose_sors_changed",
            "purpose_sors_changed",
            "purpose_sors_changed",
        ])
    })

    it("refuses a Purpose change that breaks the rule, leaving the IPAS as it was", async () => {
        const ipas = await raise({ p_purpose: "project", p_sor_ids: [sorA] })
        const noSor = await rpc("outsider", "ipas_set_purpose_and_sors", {
            p_ipas_id: ipas.id,
            p_purpose: "project",
            p_sor_ids: [],
        })
        expect(noSor.error?.code).toBe("22023")
        const stillSor = await rpc("outsider", "ipas_set_purpose_and_sors", {
            p_ipas_id: ipas.id,
            p_purpose: "events",
            p_sor_ids: [sorA],
        })
        expect(stillSor.error?.code).toBe("22023")
        expect((await readRow("ipas", ipas.id)).purpose).toBe("project")
        expect((await svc().from("ipas_sors").select("id").eq("ipas_id", ipas.id)).data).toHaveLength(1)
    })

    it("writes no event when nothing changed", async () => {
        const ipas = await raise({ p_purpose: "project", p_sor_ids: [sorA] })
        await rpc("outsider", "ipas_set_purpose_and_sors", { p_ipas_id: ipas.id, p_purpose: "project", p_sor_ids: [sorA] })
        const { data } = await svc().from("ipas_events").select("id").eq("ipas_id", ipas.id)
        expect(data).toHaveLength(1)
    })

    it("refuses a change to a filed or cancelled IPAS", async () => {
        const filed = await raise()
        await sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [filed.id])
        const onFiled = await rpc("outsider", "ipas_set_purpose_and_sors", {
            p_ipas_id: filed.id,
            p_purpose: "events",
            p_sor_ids: [],
        })
        expect(onFiled.error?.code).toBe("55000")
        expect((await readRow("ipas", filed.id)).purpose).toBe("inventory")

        const cancelled = await raise()
        await rpc("outsider", "ipas_cancel", { p_ipas_id: cancelled.id, p_reason: "Dropped" })
        const onCancelled = await rpc("outsider", "ipas_set_purpose_and_sors", {
            p_ipas_id: cancelled.id,
            p_purpose: "events",
            p_sor_ids: [],
        })
        expect(onCancelled.error?.code).toBe("55000")
    })
})

describe("cancelling", () => {
    it("needs a reason, keeps the number and leaves the IPAS readable", async () => {
        const ipas = await raise()
        const noReason = await rpc("outsider", "ipas_cancel", { p_ipas_id: ipas.id, p_reason: "   " })
        expect(noReason.error?.code).toBe("22023")
        expect((await readRow("ipas", ipas.id)).state).toBe("open")

        const { data, error } = await rpc("outsider", "ipas_cancel", { p_ipas_id: ipas.id, p_reason: " Supplier withdrew " })
        expect(error).toBeNull()
        expect(data).toMatchObject({
            number: ipas.number,
            state: "cancelled",
            cancel_reason: "Supplier withdrew",
            cancelled_by: ids.outsider,
        })
        expect(data.cancelled_at).toBeTruthy()

        // Still there, and still readable by the people who read IPAS.
        for (const who of ["outsider", "finance", "superAdmin", "ipasSigner"]) {
            expect(await canRead(await clientFor(who), "ipas", ipas.id), who).toBe(true)
        }
        const { data: events } = await svc().from("ipas_events").select("kind, detail").eq("ipas_id", ipas.id).order("created_at")
        expect(events.map((e) => e.kind)).toEqual(["created", "cancelled"])
        expect(events[1].detail).toEqual({ reason: "Supplier withdrew" })
    })

    it("refuses a filed IPAS and one already cancelled", async () => {
        const filed = await raise()
        await sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [filed.id])
        const onFiled = await rpc("outsider", "ipas_cancel", { p_ipas_id: filed.id, p_reason: "Oops" })
        expect(onFiled.error?.code).toBe("55000")
        expect(onFiled.error?.message).toMatch(/reopens it/)
        expect((await readRow("ipas", filed.id)).state).toBe("filed")

        const twice = await raise()
        await rpc("outsider", "ipas_cancel", { p_ipas_id: twice.id, p_reason: "Once" })
        expect((await rpc("outsider", "ipas_cancel", { p_ipas_id: twice.id, p_reason: "Twice" })).error?.code).toBe("55000")
    })

    it("reports an IPAS that isn't there", async () => {
        const { error } = await rpc("outsider", "ipas_cancel", {
            p_ipas_id: "00000000-0000-0000-0000-000000000000",
            p_reason: "x",
        })
        expect(error?.code).toBe("P0002")
    })
})

describe("history can't be edited", () => {
    let ipas
    let eventId
    beforeAll(async () => {
        ipas = await raise()
        await rpc("outsider", "ipas_cancel", { p_ipas_id: ipas.id, p_reason: "Dropped" })
        const { data } = await svc().from("ipas_events").select("id").eq("ipas_id", ipas.id).eq("kind", "created").limit(1)
        eventId = data[0].id
    })

    it.each(CAST_KEYS)("refuses %s an update or a delete of an event", async (who) => {
        const client = await clientFor(who)
        const update = await tryUpdate(client, "ipas_events", eventId, { kind: "tampered" })
        expect(update.affected, `${who} updated an event`).toBe(0)
        const del = await tryDelete(client, "ipas_events", eventId)
        expect(del.affected, `${who} deleted an event`).toBe(0)
    })

    it.each(CAST_KEYS)("refuses %s a new event written by hand", async (who) => {
        const result = await tryInsert(await clientFor(who), "ipas_events", {
            ipas_id: ipas.id,
            actor_id: ids[who],
            kind: "forged",
        })
        expect(result.ok, `${who} wrote an event`).toBe(false)
    })

    it("refuses even the service role, and a truncate", async () => {
        const update = await svc().from("ipas_events").update({ kind: "tampered" }).eq("id", eventId)
        expect(update.error?.code).toBe("42501")
        expect(update.error?.message).toMatch(/append-only/)

        const del = await svc().from("ipas_events").delete().eq("id", eventId)
        expect(del.error?.code).toBe("42501")

        await expect(sql().query("truncate public.ipas_events")).rejects.toMatchObject({ code: "42501" })

        const { data } = await svc().from("ipas_events").select("kind").eq("id", eventId).single()
        expect(data.kind).toBe("created")
    })

    it("refuses to delete an IPAS that has history", async () => {
        const { error } = await svc().from("ipas").delete().eq("id", ipas.id)
        expect(error?.code).toBe("42501")
        expect((await readRow("ipas", ipas.id)).id).toBe(ipas.id)
    })
})

describe("who reads an IPAS", () => {
    let ipas
    let withSor
    beforeAll(async () => {
        ipas = await raise()
        withSor = await raise({ p_purpose: "project", p_sor_ids: [sorA] })
    })

    const READERS = [
        ["Purchasing access", "outsider"],
        ["Finance access", "finance"],
        ["a Super Admin", "superAdmin"],
        ["a sign-off list member", "ipasSigner"],
    ]
    const NON_READERS = CAST_KEYS.filter((k) => !["outsider", "finance", "superAdmin", "ipasSigner"].includes(k))

    it.each(READERS)("lets someone with %s read the IPAS, its SORs and its history", async (_, who) => {
        const client = await clientFor(who)
        expect(await canRead(client, "ipas", ipas.id)).toBe(true)
        const sors = await client.from("ipas_sors").select("id").eq("ipas_id", withSor.id)
        expect(sors.data).toHaveLength(1)
        const events = await client.from("ipas_events").select("id").eq("ipas_id", ipas.id)
        expect(events.data).toHaveLength(1)
        expect((await client.rpc("ipas_can_read")).data).toBe(true)
    })

    it.each(NON_READERS)("refuses %s: no IPAS, no SORs, no history, no sign-off lists", async (who) => {
        const client = await clientFor(who)
        expect(await canRead(client, "ipas", ipas.id), `${who} read an IPAS`).toBe(false)
        const all = await client.from("ipas").select("id")
        expect(all.data).toEqual([])
        const sors = await client.from("ipas_sors").select("id")
        expect(sors.data).toEqual([])
        const events = await client.from("ipas_events").select("id")
        expect(events.data).toEqual([])
        const lists = await client.from("ipas_signer_lists").select("id")
        expect(lists.data).toEqual([])
        expect((await client.rpc("ipas_can_read")).data).toBe(false)
    })

    it("refuses someone not signed in", async () => {
        const anon = anonymousClient()
        const all = await anon.from("ipas").select("id")
        expect(all.data ?? []).toEqual([])
    })

    it("refuses a soft-deleted employee even when they hold the flags", async () => {
        const flag = await svc().from("employees").update({ has_purchasing_flow: true, has_finance_flow: true }).eq("id", ids.deleted)
        expect(flag.error).toBeNull()
        try {
            const client = await clientFor("deleted")
            expect((await client.rpc("ipas_can_read")).data).toBe(false)
            expect(await canRead(client, "ipas", ipas.id)).toBe(false)
            const create = await raiseIpas(ids.deleted, ARGS(nextPo()))
            expect(create.error?.code).toBe("42501")
        } finally {
            await svc().from("employees").update({ has_purchasing_flow: false, has_finance_flow: false }).eq("id", ids.deleted)
        }
    })

    it("stops reading once the flag is taken back", async () => {
        await svc().from("employees").update({ has_finance_flow: false }).eq("id", ids.finance)
        try {
            expect(await canRead(await clientFor("finance"), "ipas", ipas.id)).toBe(false)
        } finally {
            await svc().from("employees").update({ has_finance_flow: true }).eq("id", ids.finance)
        }
        expect(await canRead(await clientFor("finance"), "ipas", ipas.id)).toBe(true)
    })

    it("gives readers each IPAS's SORs as a header, and non-readers nothing", async () => {
        const rows = (await rpc("finance", "ipas_sor_headers", { p_ipas_ids: [withSor.id] })).data
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ ipas_id: withSor.id, opportunity_id: sorA, sales_reference: refA })
        expect(rows[0].project_title).toBeTruthy()

        expect((await rpc("ordinary", "ipas_sor_headers", { p_ipas_ids: [withSor.id] })).data).toEqual([])
        expect((await rpc("dealOwner", "ipas_sor_headers", { p_ipas_ids: null })).data).toEqual([])
    })
})

describe("who changes an IPAS", () => {
    let ipas
    beforeAll(async () => {
        ipas = await raise()
    })

    it.each(CAST_KEYS.filter((k) => k !== "outsider"))("refuses %s raising an IPAS", async (who) => {
        const { error } = await raiseIpas(ids[who], ARGS(nextPo()))
        expect(error?.code, `${who} raised an IPAS`).toBe("42501")
    })

    it("refuses Finance, a signer and a Super Admin cancelling or changing one", async () => {
        for (const who of ["finance", "ipasSigner", "superAdmin"]) {
            const cancel = await rpc(who, "ipas_cancel", { p_ipas_id: ipas.id, p_reason: "x" })
            expect(cancel.error?.code, `${who} cancelled`).toBe("42501")
            const change = await rpc(who, "ipas_set_purpose_and_sors", {
                p_ipas_id: ipas.id,
                p_purpose: "events",
                p_sor_ids: [],
            })
            expect(change.error?.code, `${who} changed`).toBe("42501")
        }
        expect((await readRow("ipas", ipas.id)).state).toBe("open")
    })

    it("refuses the signed-out", async () => {
        const { error } = await anonymousClient().rpc("ipas_create", ARGS(nextPo()))
        expect(error).not.toBeNull()
    })

    it.each(["outsider", "finance", "superAdmin"])("gives %s no direct write on the tables", async (who) => {
        const client = await clientFor(who)
        const po = nextPo()
        const insert = await tryInsert(client, "ipas", {
            po_number: po,
            priority: "high",
            source: "local",
            purpose: "inventory",
            odoo_copy: odooCopy(po),
        })
        expect(insert.ok, `${who} inserted an IPAS`).toBe(false)
        expect(insert.code).toBe(RLS_VIOLATION)

        const update = await tryUpdate(client, "ipas", ipas.id, { remarks: "tampered" })
        expect(update.affected).toBe(0)
        const del = await tryDelete(client, "ipas", ipas.id)
        expect(del.affected).toBe(0)
        expect((await readRow("ipas", ipas.id)).remarks).toBeNull()

        const sor = await tryInsert(client, "ipas_sors", { ipas_id: ipas.id, opportunity_id: sorA })
        expect(sor.ok).toBe(false)
    })
})

describe("the sign-off lists", () => {
    it("are written by a Super Admin only", async () => {
        const rowFor = (who) => ({ list_key: "s7_noted", employee_id: ids[who] })

        const byPurchaser = await tryInsert(await clientFor("outsider"), "ipas_signer_lists", rowFor("ordinary"))
        expect(byPurchaser.ok).toBe(false)
        const byFinance = await tryInsert(await clientFor("finance"), "ipas_signer_lists", rowFor("ordinary"))
        expect(byFinance.ok).toBe(false)
        const byHr = await tryInsert(await clientFor("hr"), "ipas_signer_lists", rowFor("ordinary"))
        expect(byHr.ok).toBe(false)

        // Not even a Super Admin writes the table directly: ipas_set_signer_list
        // is the one way in, so every change is logged.
        const bySuperAdmin = await tryInsert(await clientFor("superAdmin"), "ipas_signer_lists", rowFor("ordinary"))
        expect(bySuperAdmin.ok).toBe(false)

        const viaRpc = await (await clientFor("superAdmin")).rpc("ipas_set_signer_list", {
            p_list_key: "s7_noted",
            p_employee_ids: [ids.ordinary],
        })
        expect(viaRpc.error).toBeNull()
        try {
            // Membership alone makes someone a reader.
            expect((await (await clientFor("ordinary")).rpc("ipas_can_read")).data).toBe(true)
        } finally {
            await (await clientFor("superAdmin")).rpc("ipas_set_signer_list", { p_list_key: "s7_noted", p_employee_ids: [] })
        }
        expect((await (await clientFor("ordinary")).rpc("ipas_can_read")).data).toBe(false)
    })

    it("only name the six sign-offs", async () => {
        const { error } = await svc().from("ipas_signer_lists").insert({ list_key: "s2_approved", employee_id: ids.ordinary })
        expect(error?.code).toBe("23514")
    })
})

describe("finding SORs to attach", () => {
    it("gives a purchaser the header of an SOR they can't read", async () => {
        expect((await (await clientFor("outsider")).rpc("sor_access_level", { p_opportunity_id: sorA })).data).toBe("none")

        const { data, error } = await rpc("outsider", "ipas_find_sors", { p_refs: [refA.toLowerCase()], p_search: null })
        expect(error).toBeNull()
        expect(data).toEqual([
            expect.objectContaining({ opportunity_id: sorA, sales_reference: refA, project_title: expect.any(String) }),
        ])
    })

    it("searches by project, and leaves out a deleted SOR", async () => {
        const hit = await rpc("outsider", "ipas_find_sors", { p_refs: null, p_search: "rope rescue" })
        expect(hit.data.map((r) => r.opportunity_id)).toEqual(expect.arrayContaining([sorA, sorB]))

        await svc().from("sales_opportunities").update({ is_deleted: true }).eq("id", sorB)
        try {
            const after = await rpc("outsider", "ipas_find_sors", { p_refs: null, p_search: "rope rescue" })
            expect(after.data.map((r) => r.opportunity_id)).not.toContain(sorB)
            const raised = await raiseAsPurchaser(ARGS(nextPo(), { p_purpose: "project", p_sor_ids: [sorB] }))
            expect(raised.error?.code).toBe("P0002")
        } finally {
            await svc().from("sales_opportunities").update({ is_deleted: false }).eq("id", sorB)
        }
    })

    it("is refused to everyone without Purchasing access", async () => {
        for (const who of ["finance", "superAdmin", "ipasSigner", "ordinary", "dealOwner"]) {
            const { error } = await rpc(who, "ipas_find_sors", { p_refs: [refA], p_search: null })
            expect(error?.code, who).toBe("42501")
        }
    })
})

describe("Purchasing and Finance access are granted by HR or a Super Admin", () => {
    const flagsOf = async (id) =>
        (await svc().from("employees").select("has_purchasing_flow, has_finance_flow").eq("id", id).single()).data

    const reset = async (id) => {
        await svc().from("employees").update({ has_purchasing_flow: false, has_finance_flow: false }).eq("id", id)
    }

    it("reverts an employee granting themselves either flag", async () => {
        try {
            const result = await tryUpdate(await clientFor("ordinary"), "employees", ids.ordinary, {
                has_finance_flow: true,
                has_purchasing_flow: true,
            })
            expect(result.ok, result.message).toBe(true)
            expect(await flagsOf(ids.ordinary)).toEqual({ has_purchasing_flow: false, has_finance_flow: false })
            expect((await (await clientFor("ordinary")).rpc("ipas_can_read")).data).toBe(false)
        } finally {
            await reset(ids.ordinary)
        }
    })

    it("reverts a signer or a purchaser granting Finance access to themselves", async () => {
        try {
            for (const who of ["ipasSigner", "outsider"]) {
                await tryUpdate(await clientFor(who), "employees", ids[who], { has_finance_flow: true })
                expect((await flagsOf(ids[who])).has_finance_flow, who).toBe(false)
            }
        } finally {
            await reset(ids.ipasSigner)
            await svc().from("employees").update({ has_finance_flow: false }).eq("id", ids.outsider)
        }
    })

    it("lets HR and a Super Admin grant them to someone else", async () => {
        try {
            const byHr = await tryUpdate(await clientFor("hr"), "employees", ids.ordinary, { has_finance_flow: true })
            expect(byHr.ok, byHr.message).toBe(true)
            expect((await flagsOf(ids.ordinary)).has_finance_flow).toBe(true)
            expect((await (await clientFor("ordinary")).rpc("ipas_can_read")).data).toBe(true)

            const bySuperAdmin = await tryUpdate(await clientFor("superAdmin"), "employees", ids.ordinary, {
                has_finance_flow: false,
                has_purchasing_flow: true,
            })
            expect(bySuperAdmin.ok, bySuperAdmin.message).toBe(true)
            expect(await flagsOf(ids.ordinary)).toEqual({ has_purchasing_flow: true, has_finance_flow: false })
        } finally {
            await reset(ids.ordinary)
        }
    })

    it("reverts HR granting themselves either flag, but not a Super Admin", async () => {
        try {
            await tryUpdate(await clientFor("hr"), "employees", ids.hr, { has_finance_flow: true, has_purchasing_flow: true })
            expect(await flagsOf(ids.hr)).toEqual({ has_purchasing_flow: false, has_finance_flow: false })

            await tryUpdate(await clientFor("superAdmin"), "employees", ids.superAdmin, { has_finance_flow: true })
            expect((await flagsOf(ids.superAdmin)).has_finance_flow).toBe(true)
        } finally {
            await reset(ids.hr)
            await reset(ids.superAdmin)
        }
    })

    it("leaves a profile save that carries the flags unchanged alone", async () => {
        const result = await tryUpdate(await clientFor("finance"), "employees", ids.finance, {
            role: "ACCOUNTING OFFICER",
            has_finance_flow: true,
        })
        expect(result.ok, result.message).toBe(true)
        expect((await flagsOf(ids.finance)).has_finance_flow).toBe(true)
    })
})

describe("the #312 seam answers from the live IPAS copy", () => {
    const lineIds = async (po) => {
        const { rows } = await sql().query(`select public._ipas_po_line_ids($1) as ids`, [po])
        return rows[0].ids
    }

    it("returns the copy's purchase.order.line ids, and nothing for a PO with no IPAS", async () => {
        const po = nextPo()
        const lines = [901, 902, 903].map((line_id) => ({ line_id, name: `Line ${line_id}`, quantity: 1, price_unit: 1 }))
        await raise({ p_odoo_copy: odooCopy(po, { lines }) }, po)

        expect(await lineIds(po)).toEqual([901, 902, 903])
        expect(await lineIds(po.toLowerCase())).toEqual([901, 902, 903])
        expect(await lineIds(nextPo())).toEqual([])
    })

    it("answers empty once the IPAS is cancelled, and the new IPAS's lines after that", async () => {
        const po = nextPo()
        const first = await raise({ p_odoo_copy: odooCopy(po, { lines: [{ line_id: 911, name: "A", quantity: 1, price_unit: 1 }] }) }, po)
        await rpc("outsider", "ipas_cancel", { p_ipas_id: first.id, p_reason: "Wrong PO" })
        expect(await lineIds(po)).toEqual([])

        await raise({ p_odoo_copy: odooCopy(po, { lines: [{ line_id: 912, name: "B", quantity: 1, price_unit: 1 }] }) }, po)
        expect(await lineIds(po)).toEqual([912])
    })

    it("still can't be called by anyone", async () => {
        const { error } = await rpc("superAdmin", "_ipas_po_line_ids", { p_po_number: "P0777" })
        expect(error).not.toBeNull()
    })
})
