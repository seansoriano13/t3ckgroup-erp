/**
 * Which files an IPAS needs is a setting (#959, spec #954): a document kind's "Required before"
 * and two switches (proof of payment on every payment, a file on every charge). The sign-off
 * checks read them live; only a Super Admin changes them.
 *
 * The sign-offs are inserted straight through the service role, so the guard triggers are what is
 * under test, not the sign-off rules around them.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const CAST_IDS = () => CAST_KEYS.map((k) => ids[k])
const FILE = "https://example.com/file.pdf"

let poSeq = 0
const copyFor = (po) => ({
    po: { id: 959000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_590_000 + poSeq, name: "Required Files Supplier", contact: null },
    lines: [{ line_id: 959100 + poSeq * 10, product_id: 7600, name: "Item 1", quantity: 2, unit: "Unit", price_unit: 100, price_subtotal: 200, taxes: [], analytic: [], brand: null }],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise(source = "local") {
    const po = `P9${String(95000 + (poSeq += 1)).padStart(6, "0")}`
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: source,
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po),
    })
    if (error) throw new Error(`ipas_raise ${po}: ${error.message}`)
    return data
}

const kindId = async (label) =>
    (await sql().query(`select id from public.ipas_options where list = 'document_kind' and label = $1`, [label])).rows[0].id
const setRequired = (label, value) =>
    sql().query(`update public.ipas_options set required_before = $2 where list = 'document_kind' and label = $1`, [label, value])
const setSwitches = (proof, charge) =>
    sql().query(`update public.ipas_file_rules set proof_on_every_payment = $1, file_on_every_charge = $2`, [proof, charge])
const missing = async (ipasId, section) =>
    (await sql().query(`select public._ipas_missing_documents($1, $2) as m`, [ipasId, section])).rows[0].m
const attach = async (ipasId, label) =>
    sql().query(
        `insert into public.ipas_documents (ipas_id, kind_id, attachment_url) values ($1, $2, $3)
         on conflict (ipas_id, kind_id) where kind_id is not null do update set attachment_url = excluded.attachment_url`,
        [ipasId, await kindId(label), FILE],
    )
const signPrepared = (ipasId, section) =>
    svc().from("ipas_signoffs").insert({ ipas_id: ipasId, section, role: "prepared", signed_by: ids.outsider })

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterEach(async () => {
    // Back to the seeded rules.
    await setRequired("Sales Contract", null)
    await setRequired("Waybill", null)
    await setRequired("Proforma Invoice", 1)
    await setRequired("Quotation (Local)", 1)
    await setRequired("BIR 2307", null)
    await setSwitches(true, true)
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", CAST_IDS())
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("the seeded rules", () => {
    it("keep today's rules and start BIR 2307 as not required", async () => {
        const local = await raise("local")
        const imported = await raise("import")
        expect(await missing(local.id, 1)).toEqual(["Quotation (Local)"])
        expect(await missing(imported.id, 1)).toEqual(["Proforma Invoice"])
        expect(await missing(imported.id, 6)).toEqual(["BL or Waybill", "Packing List", "Commercial Invoice", "Freight Billing"])
        expect(await missing(local.id, 6)).toEqual([])
        expect(await missing(local.id, 7)).toEqual([])
        expect(await missing(imported.id, 7)).toEqual([])
    })
})

describe("a kind's Required before", () => {
    it("blocks the sign-off until the file is attached, and lets it through after", async () => {
        const ipas = await raise("local")
        await setRequired("Sales Contract", 3)

        const refused = await signPrepared(ipas.id, 6)
        expect(refused.error?.code).toBe("22023")
        expect(refused.error?.message).toMatch(/Sales Contract/)

        await attach(ipas.id, "Sales Contract")
        expect((await signPrepared(ipas.id, 6)).error).toBeNull()
    })

    it("does not block once the kind is set to not required", async () => {
        const ipas = await raise("local")
        await setRequired("Sales Contract", 3)
        expect(await missing(ipas.id, 6)).toEqual(["Sales Contract"])
        await setRequired("Sales Contract", null)
        expect(await missing(ipas.id, 6)).toEqual([])
        expect((await signPrepared(ipas.id, 6)).error).toBeNull()
    })

    it("follows the kind's Source: an Import-only kind is not asked of a Local IPAS", async () => {
        const local = await raise("local")
        const imported = await raise("import")
        await setRequired("Waybill", 6)
        expect(await missing(imported.id, 7)).toEqual(["Waybill"])
        expect(await missing(local.id, 7)).toEqual([])
    })

    it("makes BIR 2307 required before Sign-offs when a Super Admin says so, for both Sources", async () => {
        const local = await raise("local")
        await setRequired("BIR 2307", 6)
        expect(await missing(local.id, 7)).toEqual(["BIR 2307"])
        await attach(local.id, "BIR 2307")
        expect(await missing(local.id, 7)).toEqual([])
    })

    it("applies to an IPAS that is already open, at once", async () => {
        const ipas = await raise("local")
        expect(await missing(ipas.id, 1)).toEqual(["Quotation (Local)"])
        await setRequired("Quotation (Local)", null)
        expect(await missing(ipas.id, 1)).toEqual([])
    })
})

describe("the two switches", () => {
    it("proof of payment: on blocks screen 2 while a payment has none, off does not", async () => {
        const ipas = await raise("local")
        const method = (await sql().query(`select id from public.ipas_options where list = 'payment_method' limit 1`)).rows[0].id
        await sql().query(
            `insert into public.ipas_payments (ipas_id, kind, paid_on, amount, php_debited, method_id) values ($1, 'payment', '2026-12-01', 100, 100, $2)`,
            [ipas.id, method],
        )
        expect((await missing(ipas.id, 3)).length).toBe(1)
        await setSwitches(false, true)
        expect(await missing(ipas.id, 3)).toEqual([])
        await setSwitches(true, true)
        expect((await missing(ipas.id, 3)).length).toBe(1)
    })

    it("a file on every charge: on blocks screen 3 for a charge with an amount and no file, off does not", async () => {
        const ipas = await raise("local")
        const kind = (await sql().query(`select id from public.ipas_options where list = 'charge_kind' limit 1`)).rows[0].id
        await sql().query(
            `insert into public.ipas_charges (ipas_id, kind_id, charged_on, amount_php) values ($1, $2, '2026-12-01', 50)`,
            [ipas.id, kind],
        )
        const refused = await signPrepared(ipas.id, 6)
        expect(refused.error?.code).toBe("22023")
        expect(refused.error?.message).toMatch(/no file/)

        await setSwitches(true, false)
        expect((await signPrepared(ipas.id, 6)).error).toBeNull()
    })
})

describe("who can change the settings", () => {
    it("lets a Super Admin change the switches and a kind's Required before", async () => {
        const admin = await clientFor("superAdmin")
        const switched = await admin.from("ipas_file_rules").update({ proof_on_every_payment: false }).eq("id", true).select()
        expect(switched.error).toBeNull()
        expect(switched.data).toHaveLength(1)

        const marked = await admin
            .from("ipas_options")
            .update({ required_before: 6 })
            .eq("id", await kindId("BIR 2307"))
            .select()
        expect(marked.error).toBeNull()
        expect(marked.data[0].required_before).toBe(6)
    })

    it("refuses everyone else, Purchasing included", async () => {
        for (const who of ["outsider", "ipasSigner", "finance", "ordinary"]) {
            const client = await clientFor(who)
            const switched = await client.from("ipas_file_rules").update({ proof_on_every_payment: false }).eq("id", true).select()
            expect(switched.data ?? [], `${who} switch`).toHaveLength(0)

            const marked = await client
                .from("ipas_options")
                .update({ required_before: 6 })
                .eq("id", await kindId("BIR 2307"))
                .select()
            expect((marked.data ?? []).length === 0 || Boolean(marked.error), `${who} kind`).toBe(true)
        }
        const { rows } = await sql().query(`select proof_on_every_payment from public.ipas_file_rules`)
        expect(rows[0].proof_on_every_payment).toBe(true)
        const bir = await sql().query(`select required_before from public.ipas_options where label = 'BIR 2307' and list = 'document_kind'`)
        expect(bir.rows[0].required_before).toBeNull()
    })

    it("lets Purchasing still add kinds, but not mark one required", async () => {
        const purchasing = await clientFor("outsider")
        const added = await purchasing
            .from("ipas_options")
            .insert({ list: "document_kind", label: "Zz 959 plain", applies_to: "both", used_for: "documentation", sort: 9990 })
            .select()
            .single()
        expect(added.error).toBeNull()

        const required = await purchasing.from("ipas_options").update({ required_before: 1 }).eq("id", added.data.id).select()
        expect(required.error?.code).toBe("42501")

        const born = await purchasing
            .from("ipas_options")
            .insert({ list: "document_kind", label: "Zz 959 required", applies_to: "both", used_for: "documentation", sort: 9991, required_before: 1 })
            .select()
        expect(born.error?.code).toBe("42501")

        await sql().query(`delete from public.ipas_options where label like 'Zz 959%'`)
    })

    it("keeps the values to 1, 3 or 6 and to document kinds", async () => {
        const bad = await sql().query(`update public.ipas_options set required_before = 2 where label = 'BIR 2307' and list = 'document_kind'`).catch((e) => e)
        expect(bad.code).toBe("23514")
        const wrongList = await sql().query(`update public.ipas_options set required_before = 1 where list = 'payment_method'`).catch((e) => e)
        expect(wrongList.code).toBe("23514")
    })
})

describe("a filed IPAS keeps the rules it was filed under", () => {
    const snapshotOf = async (ipasId) =>
        (await sql().query(`select file_rules_snapshot as s from public.ipas where id = $1`, [ipasId])).rows[0].s

    it("writes the snapshot at filing and does not move when the settings change", async () => {
        const ipas = await raise("local")
        expect(await snapshotOf(ipas.id)).toBeNull()

        await setRequired("Sales Contract", 3)
        const filed = await sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [ipas.id])
        expect(filed.rowCount).toBe(1)

        const kind = await kindId("Sales Contract")
        const before = await snapshotOf(ipas.id)
        expect(before.options[kind]).toBe(3)
        expect(before.proof_on_every_payment).toBe(true)

        await setRequired("Sales Contract", 6)
        await setRequired("Quotation (Local)", null)
        await setSwitches(false, false)
        expect(await snapshotOf(ipas.id)).toEqual(before)
    })

    it("leaves an open IPAS without a snapshot, following the live settings", async () => {
        const ipas = await raise("local")
        await setRequired("Sales Contract", 3)
        expect(await snapshotOf(ipas.id)).toBeNull()
        expect(await missing(ipas.id, 6)).toEqual(["Sales Contract"])
    })
})
