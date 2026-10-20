/**
 * Keeping the Odoo copy current, with overrides (#243, spec #241): the database
 * rules.
 *
 * `outsider` holds Purchasing access for the file and is the purchaser;
 * `finance` holds Finance access alone; `ipasSigner` is a plain employee on the
 * `s1_approved` list; `superAdmin` is a Super Admin on no list; `ordinary`
 * and `dealOwner` are nobody to the IPAS.
 *
 * Everything runs through the real `ipas_record_odoo_copy`, `ipas_override_field`,
 * `ipas_reset_override` and `ipas_set_header`. The approval reset runs against the
 * real `ipas_signoffs` (#247).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"
import { tryUpdate, tryDelete } from "./support/access.js"

const svc = () => serviceClient()

let poSeq = 0
/** A PO number nothing else in the tier uses. */
const nextPo = () => `P9${String(80000 + (poSeq += 1)).padStart(6, "0")}`

const line = (id, over = {}) => ({
    line_id: id,
    product_id: id * 10,
    name: `Item ${id}`,
    quantity: 2,
    unit: "Unit",
    price_unit: 100,
    price_subtotal: 200,
    taxes: [],
    analytic: [],
    brand: null,
    ...over,
})

const copyFor = (po, over = {}) => ({
    po: {
        id: 770000 + poSeq,
        name: po,
        state: "purchase",
        company: "T3ck Trading",
        company_id: 1,
        currency: "Php",
        origin: null,
        partner_ref: null,
        ...(over.po ?? {}),
    },
    supplier: { id: 553, name: "Scorpe Technologies", contact: "Ms. K. Tan", ...(over.supplier ?? {}) },
    lines: over.lines ?? [line(1), line(2)],
    receipts: over.receipts ?? { status: "pending", done: 0, total: 1 },
    bills: over.bills ?? { count: 0, draft: 0 },
})

const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

/** Raises an IPAS as the purchaser, failing the test loudly if it can't. */
async function raise(copyOver = {}) {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po, copyOver),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

/** The PO's copy as Odoo answers now: the one raised with, plus changes. */
const changed = (ipas, over = {}) => ({
    ...ipas.odoo_copy,
    ...over,
    po: { ...ipas.odoo_copy.po, ...(over.po ?? {}) },
    supplier: { ...ipas.odoo_copy.supplier, ...(over.supplier ?? {}) },
})

const record = (who, ipasId, copy) => rpc(who, "ipas_record_odoo_copy", { p_ipas_id: ipasId, p_odoo_copy: copy })

async function readRow(id) {
    const { data, error } = await svc().from("ipas").select("*").eq("id", id).maybeSingle()
    if (error) throw error
    return data
}

async function eventKinds(id) {
    const { data } = await svc().from("ipas_events").select("kind").eq("ipas_id", id).order("created_at")
    return data.map((e) => e.kind)
}

async function eventsOf(id, kind) {
    const { data } = await svc().from("ipas_events").select("*").eq("ipas_id", id).eq("kind", kind).order("created_at")
    return data
}

const file = (id) => sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [id])

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    const member = await svc().from("ipas_signer_lists").insert({ list_key: "s1_approved", employee_id: ids.ipasSigner })
    if (member.error) throw member.error

})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await svc().from("ipas_signer_lists").delete().eq("employee_id", ids.ipasSigner)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("refreshing the copy", () => {
    it("stores the new copy with its fetch time and a note of what changed", async () => {
        const ipas = await raise()
        const next = changed(ipas, {
            lines: [line(1, { quantity: 5, price_subtotal: 500 }), line(3, { price_unit: 40, price_subtotal: 80 })],
        })

        const { data, error } = await record("outsider", ipas.id, next)

        expect(error).toBeNull()
        expect(data).toMatchObject({ changed: true, filed: false, approvals_cleared: [], preparer_ids: [] })
        expect(data.ipas.odoo_copy.lines.map((l) => l.line_id)).toEqual([1, 3])
        expect(new Date(data.ipas.odoo_fetched_at) >= new Date(ipas.odoo_fetched_at)).toBe(true)

        const note = data.ipas.odoo_change_note
        expect(note.added).toEqual([expect.objectContaining({ line_id: 3, name: "Item 3" })])
        expect(note.removed).toEqual([expect.objectContaining({ line_id: 2 })])
        expect(note.changed).toEqual([
            expect.objectContaining({ line_id: 1, quantity_from: 2, quantity_to: 5, price_unit_from: 100, price_unit_to: 100 }),
        ])
        expect(Number(note.total_from)).toBe(400)
        expect(Number(note.total_to)).toBe(580)
        expect(note.at).toBeTruthy()
        expect(await eventKinds(ipas.id)).toEqual(["created", "odoo_copy_changed"])
    })

    it("notes a price change on its own", async () => {
        const ipas = await raise()
        const { data } = await record("outsider", ipas.id, changed(ipas, { lines: [line(1, { price_unit: 120, price_subtotal: 240 }), line(2)] }))

        expect(data.ipas.odoo_change_note.changed).toEqual([
            expect.objectContaining({ line_id: 1, price_unit_from: 100, price_unit_to: 120 }),
        ])
        expect(data.ipas.odoo_change_note.added).toEqual([])
        expect(data.ipas.odoo_change_note.removed).toEqual([])
    })

    it("writes no history and no note when only the receipts and bills moved", async () => {
        const ipas = await raise()
        const { data } = await record(
            "outsider",
            ipas.id,
            changed(ipas, { receipts: { status: "partial", done: 1, total: 2 }, bills: { count: 1, draft: 1 } }),
        )

        expect(data.changed).toBe(false)
        expect(data.ipas.odoo_change_note).toBeNull()
        expect(data.ipas.odoo_copy.receipts).toEqual({ status: "partial", done: 1, total: 2 })
        expect(await eventKinds(ipas.id)).toEqual(["created"])
    })

    it("keeps the last note until a newer change replaces it", async () => {
        const ipas = await raise()
        await record("outsider", ipas.id, changed(ipas, { lines: [line(1), line(2), line(3)] }))
        const same = await record("outsider", ipas.id, changed(ipas, { lines: [line(1), line(2), line(3)] }))
        expect(same.data.changed).toBe(false)
        expect(same.data.ipas.odoo_change_note.added.map((l) => l.line_id)).toEqual([3])

        const newer = await record("outsider", ipas.id, changed(ipas, { lines: [line(1), line(2)] }))
        expect(newer.data.ipas.odoo_change_note.removed.map((l) => l.line_id)).toEqual([3])
        expect(newer.data.ipas.odoo_change_note.added).toEqual([])
    })

    it("records a PO cancelled in Odoo without cancelling the IPAS", async () => {
        const ipas = await raise()
        const { data, error } = await record("outsider", ipas.id, changed(ipas, { po: { state: "cancel" } }))

        expect(error).toBeNull()
        expect(data.ipas.state).toBe("open")
        expect(data.ipas.odoo_copy.po.state).toBe("cancel")
        const [event] = await eventsOf(ipas.id, "odoo_copy_changed")
        expect(event.detail).toMatchObject({ po_state_from: "purchase", po_state_to: "cancel" })
        const row = await readRow(ipas.id)
        expect(row).toMatchObject({ state: "open", cancelled_at: null, cancelled_by: null })
    })

    it("refuses a copy for a different PO, a missing one, a missing IPAS and a cancelled IPAS", async () => {
        const ipas = await raise()
        const other = await record("outsider", ipas.id, copyFor(nextPo()))
        expect(other.error?.code).toBe("22023")
        expect(other.error?.message).toMatch(/not P9/)

        for (const bad of [null, { po: { name: ipas.po_number } }, { lines: [] }]) {
            expect((await record("outsider", ipas.id, bad)).error?.code).toBe("22023")
        }

        const missing = await record("outsider", "00000000-0000-0000-0000-000000000000", copyFor(nextPo()))
        expect(missing.error?.code).toBe("22023")

        await rpc("outsider", "ipas_cancel", { p_ipas_id: ipas.id, p_reason: "Dropped" })
        const cancelled = await record("outsider", ipas.id, changed(ipas, { lines: [line(1)] }))
        expect(cancelled.error?.code).toBe("22023")
        expect((await readRow(ipas.id)).odoo_copy.lines).toHaveLength(2)
    })

    it("is open to everyone who reads IPAS, and refused to everyone else", async () => {
        const ipas = await raise()
        for (const who of ["outsider", "finance", "ipasSigner", "superAdmin"]) {
            const { error } = await record(who, ipas.id, changed(ipas))
            expect(error, `${who} refused a refresh`).toBeNull()
        }
        for (const who of CAST_KEYS.filter((k) => !["outsider", "finance", "ipasSigner", "superAdmin"].includes(k))) {
            const { error } = await record(who, ipas.id, changed(ipas, { lines: [line(9)] }))
            expect(error?.code, `${who} refreshed an IPAS`).toBe("42501")
        }
        expect((await readRow(ipas.id)).odoo_copy.lines).toHaveLength(2)
    })

    it("can't be written to the IPAS directly by anyone", async () => {
        const ipas = await raise()
        for (const who of ["outsider", "finance", "superAdmin", "ipasSigner"]) {
            const client = await clientFor(who)
            const forged = await tryUpdate(client, "ipas", ipas.id, {
                odoo_copy: changed(ipas, { po: { currency: "USD" } }),
                entity_override: "Forged",
                odoo_changed_since_filing: true,
            })
            expect(forged.affected, `${who} wrote the IPAS`).toBe(0)
            expect((await tryDelete(client, "ipas", ipas.id)).affected).toBe(0)
        }
        const row = await readRow(ipas.id)
        expect(row.entity_override).toBeNull()
        expect(row.odoo_copy.po.currency).toBe("Php")
    })
})

describe("overrides", () => {
    it("survives a refresh, keeps Odoo's value to show beside it, and resets in one action", async () => {
        const ipas = await raise()
        const set = await rpc("outsider", "ipas_override_field", { p_ipas_id: ipas.id, p_field: "entity", p_value: "  TG Enterprise " })
        expect(set.error).toBeNull()
        expect(set.data.entity_override).toBe("TG Enterprise")

        const refreshed = await record("outsider", ipas.id, changed(ipas, { po: { company: "T3ck Trading Inc" } }))
        expect(refreshed.data.ipas).toMatchObject({ entity_override: "TG Enterprise" })
        expect(refreshed.data.ipas.odoo_copy.po.company).toBe("T3ck Trading Inc")

        const reset = await rpc("outsider", "ipas_reset_override", { p_ipas_id: ipas.id, p_field: "entity" })
        expect(reset.error).toBeNull()
        expect(reset.data.entity_override).toBeNull()
    })

    it("covers Source Doc. and Analytic Dist., and leaves the others alone", async () => {
        const ipas = await raise()
        await rpc("outsider", "ipas_override_field", { p_ipas_id: ipas.id, p_field: "source_doc", p_value: "S07920 Capas LGU" })
        const both = await rpc("outsider", "ipas_override_field", { p_ipas_id: ipas.id, p_field: "analytic", p_value: "S07920 · Ops" })

        expect(both.data).toMatchObject({
            entity_override: null,
            source_doc_override: "S07920 Capas LGU",
            analytic_override: "S07920 · Ops",
        })

        const reset = await rpc("outsider", "ipas_reset_override", { p_ipas_id: ipas.id, p_field: "source_doc" })
        expect(reset.data).toMatchObject({ source_doc_override: null, analytic_override: "S07920 · Ops" })
    })

    it("keeps every override and reset in history, with Odoo's value at the time", async () => {
        const ipas = await raise({ po: { origin: "S07920 Capas" }, lines: [line(1, { analytic: ["S07920 Capas", "Ops"] })] })
        await rpc("outsider", "ipas_override_field", { p_ipas_id: ipas.id, p_field: "source_doc", p_value: "S07920 LGU" })
        await rpc("outsider", "ipas_override_field", { p_ipas_id: ipas.id, p_field: "source_doc", p_value: "S07920 Capas LGU" })
        await rpc("outsider", "ipas_override_field", { p_ipas_id: ipas.id, p_field: "analytic", p_value: "Ops only" })
        await rpc("outsider", "ipas_reset_override", { p_ipas_id: ipas.id, p_field: "source_doc" })

        const { data } = await svc().from("ipas_events").select("kind, actor_id, detail").eq("ipas_id", ipas.id).order("created_at")
        const trail = data.filter((e) => e.kind.startsWith("override"))

        expect(trail.map((e) => [e.kind, e.detail.field, e.detail.from ?? null, e.detail.to ?? null])).toEqual([
            ["override_set", "source_doc", null, "S07920 LGU"],
            ["override_set", "source_doc", "S07920 LGU", "S07920 Capas LGU"],
            ["override_set", "analytic", null, "Ops only"],
            ["override_reset", "source_doc", "S07920 Capas LGU", null],
        ])
        expect(trail.every((e) => e.actor_id === ids.outsider)).toBe(true)
        expect(trail[0].detail.odoo).toBe("S07920 Capas")
        expect(trail[2].detail.odoo).toBe("S07920 Capas · Ops")
    })

    it("writes no history for a repeat override or a reset of a field that isn't overridden", async () => {
        const ipas = await raise()
        await rpc("outsider", "ipas_override_field", { p_ipas_id: ipas.id, p_field: "entity", p_value: "TG" })
        await rpc("outsider", "ipas_override_field", { p_ipas_id: ipas.id, p_field: "entity", p_value: "TG" })
        await rpc("outsider", "ipas_reset_override", { p_ipas_id: ipas.id, p_field: "analytic" })
        expect(await eventKinds(ipas.id)).toEqual(["created", "override_set"])
    })

    it.each(["currency", "supplier", "lines", "brand", "purchase_order", "received_in_odoo", "create_bill", "po_number"])(
        "refuses to override or reset %s, for the purchaser too",
        async (field) => {
            const ipas = await raise()
            const set = await rpc("outsider", "ipas_override_field", { p_ipas_id: ipas.id, p_field: field, p_value: "x" })
            expect(set.error?.code).toBe("22023")
            const reset = await rpc("outsider", "ipas_reset_override", { p_ipas_id: ipas.id, p_field: field })
            expect(reset.error?.code).toBe("22023")
            expect(await eventKinds(ipas.id)).toEqual(["created"])
        },
    )

    it("needs a value", async () => {
        const ipas = await raise()
        for (const value of ["", "   ", null]) {
            const { error } = await rpc("outsider", "ipas_override_field", { p_ipas_id: ipas.id, p_field: "entity", p_value: value })
            expect(error?.code).toBe("22023")
        }
    })

    it("is written by Purchasing access only", async () => {
        const ipas = await raise()
        for (const who of CAST_KEYS.filter((k) => k !== "outsider")) {
            const set = await rpc(who, "ipas_override_field", { p_ipas_id: ipas.id, p_field: "entity", p_value: "Mine" })
            expect(set.error?.code, `${who} overrode`).toBe("42501")
            const reset = await rpc(who, "ipas_reset_override", { p_ipas_id: ipas.id, p_field: "entity" })
            expect(reset.error?.code, `${who} reset`).toBe("42501")
        }
        expect((await readRow(ipas.id)).entity_override).toBeNull()
    })

    it("is refused on a filed or cancelled IPAS", async () => {
        const filed = await raise()
        await file(filed.id)
        expect((await rpc("outsider", "ipas_override_field", { p_ipas_id: filed.id, p_field: "entity", p_value: "TG" })).error?.code).toBe("22023")
        expect((await rpc("outsider", "ipas_reset_override", { p_ipas_id: filed.id, p_field: "entity" })).error?.code).toBe("22023")

        const cancelled = await raise()
        await rpc("outsider", "ipas_cancel", { p_ipas_id: cancelled.id, p_reason: "Dropped" })
        expect((await rpc("outsider", "ipas_override_field", { p_ipas_id: cancelled.id, p_field: "entity", p_value: "TG" })).error?.code).toBe("22023")
    })
})

describe("contact and P.I # fill while blank", () => {
    it("fill from Odoo on raising, and from a later copy while still blank", async () => {
        const ipas = await raise()
        expect(ipas).toMatchObject({ supplier_contact: "Ms. K. Tan", pi_number: null })

        const { data } = await record("outsider", ipas.id, changed(ipas, { po: { partner_ref: "PI-2026-77" } }))

        expect(data.ipas).toMatchObject({ supplier_contact: "Ms. K. Tan", pi_number: "PI-2026-77" })
        const [filled] = await eventsOf(ipas.id, "filled_from_odoo")
        expect(filled.detail.fields).toEqual(["pi_number"])
    })

    it("are never overwritten once typed, however Odoo changes", async () => {
        const ipas = await raise()
        const typed = await rpc("outsider", "ipas_set_header", {
            p_ipas_id: ipas.id,
            p_fields: { supplier_contact: "  Mr. R. Cruz ", pi_number: "PI-TYPED" },
        })
        expect(typed.error).toBeNull()
        expect(typed.data).toMatchObject({ supplier_contact: "Mr. R. Cruz", pi_number: "PI-TYPED" })

        const { data } = await record(
            "outsider",
            ipas.id,
            changed(ipas, { po: { partner_ref: "PI-FROM-ODOO" }, supplier: { contact: "Someone Else" } }),
        )

        expect(data.ipas).toMatchObject({ supplier_contact: "Mr. R. Cruz", pi_number: "PI-TYPED" })
        expect(await eventsOf(ipas.id, "filled_from_odoo")).toEqual([])
    })

    it("fill again from the next copy once cleared", async () => {
        const ipas = await raise()
        await rpc("outsider", "ipas_set_header", { p_ipas_id: ipas.id, p_fields: { supplier_contact: "Typed" } })
        const cleared = await rpc("outsider", "ipas_set_header", { p_ipas_id: ipas.id, p_fields: { supplier_contact: "  " } })
        expect(cleared.data.supplier_contact).toBeNull()

        const { data } = await record("outsider", ipas.id, changed(ipas, { supplier: { contact: "Ms. New" } }))
        expect(data.ipas.supplier_contact).toBe("Ms. New")
    })

    it("keeps a typed change in history, and types only these two fields", async () => {
        const ipas = await raise()
        await rpc("outsider", "ipas_set_header", { p_ipas_id: ipas.id, p_fields: { pi_number: "PI-1" } })
        const [event] = await eventsOf(ipas.id, "header_changed")
        expect(event.detail.fields).toEqual({ pi_number: { from: null, to: "PI-1" } })

        // Remarks became editable in #551 (policy test 106), so it is no longer in this refused list.
        for (const fields of [{ number: "TGIPAS_001" }, { supplier_contact: "ok", state: "filed" }]) {
            const { error } = await rpc("outsider", "ipas_set_header", { p_ipas_id: ipas.id, p_fields: fields })
            expect(error?.code).toBe("22023")
        }
        const row = await readRow(ipas.id)
        expect(row).toMatchObject({ number: ipas.number, state: "open", supplier_contact: "Ms. K. Tan" })
    })

    it("is typed by Purchasing access only, and not once filed", async () => {
        const ipas = await raise()
        for (const who of CAST_KEYS.filter((k) => k !== "outsider")) {
            const { error } = await rpc(who, "ipas_set_header", { p_ipas_id: ipas.id, p_fields: { pi_number: "Mine" } })
            expect(error?.code, `${who} typed`).toBe("42501")
        }
        await file(ipas.id)
        const filed = await rpc("outsider", "ipas_set_header", { p_ipas_id: ipas.id, p_fields: { pi_number: "Late" } })
        expect(filed.error?.code).toBe("22023")
        expect((await readRow(ipas.id)).pi_number).toBeNull()
    })
})

describe("a filed IPAS", () => {
    it("stores no new copy, and only flags that Odoo has changed", async () => {
        const ipas = await raise()
        await file(ipas.id)

        const { data, error } = await record("outsider", ipas.id, changed(ipas, { lines: [line(1), line(2, { quantity: 9, price_subtotal: 900 })] }))

        expect(error).toBeNull()
        expect(data).toMatchObject({ filed: true, changed: false, approvals_cleared: [], preparer_ids: [] })
        expect(data.ipas.odoo_changed_since_filing).toBe(true)
        const row = await readRow(ipas.id)
        expect(row.odoo_copy).toEqual(ipas.odoo_copy)
        expect(row.odoo_fetched_at).toBe(ipas.odoo_fetched_at)
        expect(row.odoo_change_note).toBeNull()
        expect(row.state).toBe("filed")
        expect(await eventKinds(ipas.id)).toEqual(["created", "odoo_changed_since_filing"])
    })

    it("writes one event however often it is checked, and clears the flag if the PO goes back", async () => {
        const ipas = await raise()
        await file(ipas.id)
        const moved = changed(ipas, { po: { origin: "S09999 Moved" } })

        await record("outsider", ipas.id, moved)
        await record("outsider", ipas.id, moved)
        expect(await eventsOf(ipas.id, "odoo_changed_since_filing")).toHaveLength(1)

        const back = await record("outsider", ipas.id, changed(ipas))
        expect(back.data.ipas.odoo_changed_since_filing).toBe(false)
    })

    it("doesn't count receipts and bills moving as the PO changing", async () => {
        const ipas = await raise()
        await file(ipas.id)
        const { data } = await record(
            "outsider",
            ipas.id,
            changed(ipas, { receipts: { status: "full", done: 1, total: 1 }, bills: { count: 2, draft: 0 } }),
        )
        expect(data.ipas.odoo_changed_since_filing).toBe(false)
        expect(await eventKinds(ipas.id)).toEqual(["created"])
    })

    it("fills no blank contact or P.I # from the later PO", async () => {
        const ipas = await raise()
        await sql().query(`update public.ipas set supplier_contact = null where id = $1`, [ipas.id])
        await file(ipas.id)

        await record("outsider", ipas.id, changed(ipas, { po: { partner_ref: "PI-LATE" }, supplier: { contact: "Late Contact" } }))

        const row = await readRow(ipas.id)
        expect(row.supplier_contact).toBeNull()
        expect(row.pi_number).toBeNull()
    })
})

describe("when the lines or total change", () => {
    const insertSignoff = (ipasId, section, role, signedBy) =>
        sql().query(
            `insert into public.ipas_signoffs (ipas_id, section, role, signed_by) values ($1, $2, $3, $4)`,
            [ipasId, section, role, signedBy],
        )

    const liveSignoffs = async (ipasId) =>
        (
            await sql().query(
                `select section, role, cleared_at, cleared_reason from public.ipas_signoffs
                  where ipas_id = $1 order by section, role, signed_at`,
                [ipasId],
            )
        ).rows

    it("clears the live section 1 and 3 approvals with 'PO changed in Odoo', and names who prepared them", async () => {
        const ipas = await raise()
        await insertSignoff(ipas.id, 1, "prepared", ids.outsider)
        await insertSignoff(ipas.id, 1, "approved", ids.ipasSigner)
        await insertSignoff(ipas.id, 3, "prepared", ids.finance)
        await insertSignoff(ipas.id, 3, "approved", ids.ipasSigner)
        await insertSignoff(ipas.id, 7, "received", ids.ipasSigner)

        const { data, error } = await record("outsider", ipas.id, changed(ipas, { lines: [line(1), line(2), line(3)] }))

        expect(error).toBeNull()
        expect(data.changed).toBe(true)
        expect(data.approvals_cleared).toEqual([1, 3])
        expect([...data.preparer_ids].sort()).toEqual([ids.outsider, ids.finance].sort())

        const rows = await liveSignoffs(ipas.id)
        const cleared = rows.filter((r) => r.cleared_at)
        expect(cleared.map((r) => [r.section, r.role, r.cleared_reason])).toEqual([
            [1, "approved", "PO changed in Odoo"],
            [3, "approved", "PO changed in Odoo"],
        ])
        // Prepared and section 7 are left as they were.
        expect(rows.filter((r) => !r.cleared_at).map((r) => [r.section, r.role])).toEqual([
            [1, "prepared"],
            [3, "prepared"],
            [7, "received"],
        ])
        const [event] = await eventsOf(ipas.id, "approvals_cleared")
        expect(event.detail).toMatchObject({ reason: "PO changed in Odoo", sections: [1, 3] })
    })

    it("clears only the approvals still live, and only on a change to the lines or total", async () => {
        const ipas = await raise()
        await insertSignoff(ipas.id, 1, "prepared", ids.outsider)
        await insertSignoff(ipas.id, 1, "approved", ids.ipasSigner)

        const quiet = await record("outsider", ipas.id, changed(ipas, { po: { origin: "S00001 New origin" }, bills: { count: 1, draft: 1 } }))
        expect(quiet.data.changed).toBe(false)
        expect(quiet.data.approvals_cleared).toEqual([])
        expect((await liveSignoffs(ipas.id)).every((r) => !r.cleared_at)).toBe(true)

        const first = await record("outsider", ipas.id, changed(ipas, { lines: [line(1)] }))
        expect(first.data.approvals_cleared).toEqual([1])
        // Already cleared: a second change has nothing left to clear.
        const second = await record("outsider", ipas.id, changed(ipas, { lines: [line(1), line(4)] }))
        expect(second.data.changed).toBe(true)
        expect(second.data.approvals_cleared).toEqual([])
        expect(second.data.preparer_ids).toEqual([])
    })

    it("leaves a filed IPAS's approvals alone", async () => {
        const ipas = await raise()
        await insertSignoff(ipas.id, 1, "prepared", ids.outsider)
        await insertSignoff(ipas.id, 1, "approved", ids.ipasSigner)
        await file(ipas.id)

        await record("outsider", ipas.id, changed(ipas, { lines: [line(1)] }))

        expect((await liveSignoffs(ipas.id)).every((r) => !r.cleared_at)).toBe(true)
    })
})
