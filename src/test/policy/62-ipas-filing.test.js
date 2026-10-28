/**
 * Section 7 and Filing (#248, spec #241): the database rules.
 *
 * `outsider` holds Purchasing access for the file and is the purchaser;
 * `ipasSigner` approves sections 1, 3 and 6 (screen 1, 2 and 3) and section 7's Approved; `finance` is
 * Received, `ordinary` Noted and `support` Checked (anyone may be put on a list,
 * and each test rebuilds the lists from nothing); `superAdmin` is on no list, so
 * signs nothing and reopens.
 *
 * Everything runs through the real `ipas_sign`, `ipas_reopen`, `ipas_cancel`,
 * `ipas_record_odoo_copy` and the freeze triggers. The cleanup at the end
 * removes filed IPAS through `session_replication_role = replica`
 * (support/ipas.js), so it also proves the freeze doesn't block teardown.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser, recordOdooCopyAs, readyToSign } from "./support/ipas.js"
import { makeSor } from "./support/rows.js"

const svc = () => serviceClient()

let poSeq = 0
const nextPo = () => `P9${String(60000 + (poSeq += 1)).padStart(6, "0")}`

let supplierSeq = 0
const nextSupplier = () => 9_400_000 + (supplierSeq += 1)

const line = (n, over = {}) => ({
    line_id: 600000 + poSeq * 10 + n,
    product_id: 6300 + n,
    name: `Item ${n}`,
    quantity: 2,
    unit: "Unit",
    price_unit: 100,
    price_subtotal: 200,
    taxes: [],
    analytic: [],
    brand: null,
    ...over,
})

const copyFor = (po, supplierId = 553, lines = [line(1)]) => ({
    po: { id: 650000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: supplierId, name: "Scorpe Technologies", contact: null },
    lines,
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const rpc = async (who, name, args) => {
    // A sign-off now asks for documents, a Logistics placement and so on (#711, #713); give it what it asks for.
    if (name === "ipas_sign") await readyToSign(args.p_ipas_id, args.p_section, args.p_role)
    return name === "ipas_record_odoo_copy" ? recordOdooCopyAs(who, args) : (await clientFor(who)).rpc(name, args)
}

let sorId
let methodId
let chargeKindId

/** Raises an IPAS as the purchaser. `project` names the file's SOR. */
async function raise({ project = false } = {}) {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: project ? "project" : "inventory",
        p_sor_ids: project ? [sorId] : [],
        p_remarks: null,
        p_odoo_copy: copyFor(po, nextSupplier()),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const sign = (who, ipasId, section, role) =>
    rpc(who, "ipas_sign", { p_ipas_id: ipasId, p_section: section, p_role: role })

async function signOk(who, ipasId, section, role) {
    const { data, error } = await sign(who, ipasId, section, role)
    if (error) throw new Error(`ipas_sign ${who} ${section}/${role}: ${error.message}`)
    return data
}

const reopen = (who, ipasId, reason) => rpc(who, "ipas_reopen", { p_ipas_id: ipasId, p_reason: reason })
const setStatus = (ipasId, status) =>
    rpc("outsider", "ipas_set_header", { p_ipas_id: ipasId, p_fields: { computation_status: status } })

const onList = async (listKey, who) => {
    const { error } = await svc().from("ipas_signer_lists").insert({ list_key: listKey, employee_id: ids[who] })
    if (error) throw error
}
const CAST_IDS = () => CAST_KEYS.map((k) => ids[k])
const clearLists = async () => {
    const { error } = await svc().from("ipas_signer_lists").delete().in("employee_id", CAST_IDS())
    if (error) throw error
}

const rowOf = async (id) => (await svc().from("ipas").select("*").eq("id", id).single()).data
const liveKeys = async (ipasId) => {
    const { data, error } = await svc().from("ipas_signoffs").select("*").eq("ipas_id", ipasId).is("cleared_at", null)
    if (error) throw error
    return data.map((r) => `${r.section}/${r.role}`).sort()
}
const history = async (ipasId) => {
    const { data } = await svc().from("ipas_signoffs").select("*").eq("ipas_id", ipasId).not("cleared_at", "is", null)
    return data
}
async function eventKinds(ipasId) {
    const { data } = await svc().from("ipas_events").select("kind").eq("ipas_id", ipasId).order("created_at")
    return data.map((e) => e.kind)
}

/**
 * Sections 1, 3 and 6 prepared by the purchaser and approved by `ipasSigner`, and Logistics (8) approved. Section 6
 * (screen 3) can only be submitted at LC Odoo Done, so it is written straight to the
 * table here; the tests of its own gate go through the real `ipas_sign`.
 */
async function approvedThrough(ipas, sections = [1, 3, 6, 8]) {
    for (const section of sections) {
        if (section === 8) {
            // Logistics (#713) is one Approved, with no Prepared before it.
            await signOk("ipasSigner", ipas.id, 8, "approved")
            continue
        }
        if (section === 6) {
            await readyToSign(ipas.id, 6, "prepared")
            const { error } = await svc().from("ipas_signoffs").insert([
                { ipas_id: ipas.id, section: 6, role: "prepared", signed_by: ids.outsider },
                { ipas_id: ipas.id, section: 6, role: "approved", signed_by: ids.ipasSigner },
            ])
            if (error) throw error
            continue
        }
        await signOk("outsider", ipas.id, section, "prepared")
        await signOk("ipasSigner", ipas.id, section, "approved")
    }
}

/** Everything short of Approved in section 7. */
async function receivedNotedChecked(ipas) {
    await signOk("finance", ipas.id, 7, "received")
    await signOk("ordinary", ipas.id, 7, "noted")
    await signOk("support", ipas.id, 7, "checked")
}

/** A filed IPAS with a payment, a charge, bank details and (for a project) an SOR. */
async function filed({ project = false } = {}) {
    const ipas = await raise({ project })
    const payment = await rpc("outsider", "ipas_add_payment", {
        p_ipas_id: ipas.id, p_kind: "down_payment", p_paid_on: "2026-10-01", p_amount: 500,
        p_php_debited: null, p_charge_fee_php: 0, p_method_id: methodId, p_check_no: null, p_proof_url: null,
    })
    expect(payment.error).toBeNull()
    const charge = await rpc("outsider", "ipas_add_charge", {
        p_ipas_id: ipas.id, p_kind_id: chargeKindId, p_charged_on: "2026-10-02", p_amount_php: 4200,
    })
    expect(charge.error).toBeNull()
    const bank = await rpc("outsider", "ipas_set_bank_details", {
        p_ipas_id: ipas.id, p_bank_name: "BDO", p_account_name: "Scorpe", p_account_number: "0011-2233",
    })
    expect(bank.error).toBeNull()
    expect((await setStatus(ipas.id, "lc_odoo_done")).error).toBeNull()
    await approvedThrough(ipas)
    await receivedNotedChecked(ipas)
    const done = await signOk("ipasSigner", ipas.id, 7, "approved")
    return { ipas, done }
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    const method = await svc().from("ipas_options").select("id").eq("list", "payment_method").eq("label", "Dated Check").maybeSingle()
    const kind = await svc().from("ipas_options").select("id").eq("list", "charge_kind").eq("label", "Brokerage Fee").maybeSingle()
    if (!method.data || !kind.data) throw new Error("The IPAS option lists aren't seeded")
    methodId = method.data.id
    chargeKindId = kind.data.id
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
})

beforeEach(async () => {
    await clearLists()
    await onList("s1_approved", "ipasSigner")
    await onList("s3_approved", "ipasSigner")
    await onList("s6_approved", "ipasSigner")
    await onList("s7_received", "finance")
    await onList("s7_noted", "ordinary")
    await onList("s7_checked", "support")
    await onList("s7_approved", "ipasSigner")
    await onList("logistics_signed", "ipasSigner")
})

afterAll(async () => {
    await clearLists()
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", CAST_IDS())
    // Filed IPAS go too: replica mode skips the freeze (and every other trigger).
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("section 7: the order", () => {
    it("doesn't open until sections 1, 2 and 3 are all approved", async () => {
        const ipas = await raise()
        for (const role of ["received", "noted", "checked", "approved"]) {
            const { error } = await sign("finance", ipas.id, 7, role)
            expect(error?.code, role).toBeDefined()
        }
        const none = await sign("finance", ipas.id, 7, "received")
        expect(none.error?.code).toBe("22023")
        expect(none.error?.message).toMatch(/section 4 opens once sections 1, 2, 3 and 6 are signed/)

        await approvedThrough(ipas, [1])
        const onlyOne = await sign("finance", ipas.id, 7, "received")
        expect(onlyOne.error?.code).toBe("22023")

        // Sections 1 and 2 approved is not enough: section 3 (stored 6) has to be too (#590).
        await approvedThrough(ipas, [3])
        const withoutThree = await sign("finance", ipas.id, 7, "received")
        expect(withoutThree.error?.code).toBe("22023")
        expect(withoutThree.error?.message).toMatch(/section 4 opens once sections 1, 2, 3 and 6 are signed/)

        // Section 3 is submitted at LC Odoo Done; submitted alone does not open section 4 either.
        expect((await setStatus(ipas.id, "lc_odoo_done")).error).toBeNull()
        await signOk("outsider", ipas.id, 6, "prepared")
        expect((await sign("finance", ipas.id, 7, "received")).error?.code).toBe("22023")
        await signOk("ipasSigner", ipas.id, 6, "approved")

        // Logistics (section 6 on screen, stored 8) is the last gate (#713).
        expect((await sign("finance", ipas.id, 7, "received")).error?.code).toBe("22023")
        await approvedThrough(ipas, [8])

        expect((await sign("finance", ipas.id, 7, "received")).error).toBeNull()
        expect(await liveKeys(ipas.id)).toEqual([
            "1/approved", "1/prepared", "3/approved", "3/prepared", "6/approved", "6/prepared", "7/received", "8/approved",
        ])
    })

    it("keeps section 4 sign-offs already given, and holds the final Approve for section 3 (#590)", async () => {
        const ipas = await raise()
        expect((await setStatus(ipas.id, "lc_odoo_done")).error).toBeNull()
        await approvedThrough(ipas)
        await receivedNotedChecked(ipas)

        // Section 3's approval is taken away (an IPAS signed before the gate existed, or an undo).
        const { error: cleared } = await svc()
            .from("ipas_signoffs")
            .update({ cleared_at: new Date().toISOString(), cleared_by: ids.ipasSigner, cleared_reason: "test" })
            .eq("ipas_id", ipas.id)
            .eq("section", 6)
            .eq("role", "approved")
        expect(cleared).toBeNull()

        // What was given stays; the final Approve waits.
        expect((await liveKeys(ipas.id)).filter((k) => k.startsWith("7/"))).toEqual(["7/checked", "7/noted", "7/received"])
        const held = await sign("ipasSigner", ipas.id, 7, "approved")
        expect(held.error?.code).toBe("22023")
        expect(held.error?.message).toMatch(/section 4 opens once sections 1, 2, 3 and 6 are signed/)
        expect((await rowOf(ipas.id)).state).toBe("open")

        // Section 3 approved again: the same sign-offs file it.
        await signOk("ipasSigner", ipas.id, 6, "approved")
        expect((await signOk("ipasSigner", ipas.id, 7, "approved")).filed).toBe(true)
    })

    it("tells the Received list when section 3 is the last approval in (#590)", async () => {
        const ipas = await raise()
        expect((await setStatus(ipas.id, "lc_odoo_done")).error).toBeNull()
        await approvedThrough(ipas, [1, 3, 8])
        await signOk("outsider", ipas.id, 6, "prepared")
        const last = await signOk("ipasSigner", ipas.id, 6, "approved")
        expect(last.stage).toBe("received_ready")
        // The Received list, and never the person who just approved.
        expect(last.notify_ids).toContain(ids.finance)
        expect(last.notify_ids).not.toContain(ids.ipasSigner)
    })

    it("tells nobody when section 3 is approved first and a section 1 or 2 is still open (#590)", async () => {
        const ipas = await raise()
        expect((await setStatus(ipas.id, "lc_odoo_done")).error).toBeNull()
        await signOk("outsider", ipas.id, 6, "prepared")
        const early = await signOk("ipasSigner", ipas.id, 6, "approved")
        expect(early).toMatchObject({ stage: null, notify_ids: [] })
    })

    it("keeps Noted and Checked behind Received, and lets them come in either order", async () => {
        const ipas = await raise()
        await approvedThrough(ipas)

        for (const [who, role] of [["ordinary", "noted"], ["support", "checked"]]) {
            const { error } = await sign(who, ipas.id, 7, role)
            expect(error?.code, role).toBe("22023")
            expect(error?.message).toMatch(/Received comes first/)
        }

        await signOk("finance", ipas.id, 7, "received")
        await signOk("support", ipas.id, 7, "checked")
        await signOk("ordinary", ipas.id, 7, "noted")
        expect(await liveKeys(ipas.id)).toEqual(
            ["1/approved", "1/prepared", "3/approved", "3/prepared", "6/approved", "6/prepared", "7/checked", "7/noted", "7/received", "8/approved"],
        )

        const twice = await sign("finance", ipas.id, 7, "received")
        expect(twice.error?.code).toBe("22023")
    })

    it("refuses Approved until Received, Noted and Checked are all given", async () => {
        const ipas = await raise()
        await approvedThrough(ipas)
        await setStatus(ipas.id, "lc_odoo_done")

        expect((await sign("ipasSigner", ipas.id, 7, "approved")).error?.code).toBe("22023")
        await signOk("finance", ipas.id, 7, "received")
        await signOk("ordinary", ipas.id, 7, "noted")
        const missing = await sign("ipasSigner", ipas.id, 7, "approved")
        expect(missing.error?.code).toBe("22023")
        expect(missing.error?.message).toMatch(/Received, Noted and Checked/)
        expect((await rowOf(ipas.id)).state).toBe("open")
    })

    it("closes again when an approval of section 1 or 3 is undone", async () => {
        const ipas = await raise()
        await approvedThrough(ipas)
        await signOk("finance", ipas.id, 7, "received")

        const changed = copyFor(ipas.po_number, ipas.odoo_copy.supplier.id, [line(1), line(2, { price_subtotal: 700 })])
        changed.po.id = ipas.odoo_copy.po.id
        const { error } = await rpc("outsider", "ipas_record_odoo_copy", { p_ipas_id: ipas.id, p_odoo_copy: changed })
        expect(error).toBeNull()

        const noted = await sign("ordinary", ipas.id, 7, "noted")
        expect(noted.error?.code).toBe("22023")
        expect(noted.error?.message).toMatch(/section 4 opens once sections 1, 2, 3 and 6 are signed/)
    })

    it("belongs to each step's list: a purchaser, a Super Admin off the list and a stranger are refused", async () => {
        const ipas = await raise()
        await approvedThrough(ipas)
        for (const who of ["outsider", "superAdmin", "hr", "dealOwner", "ipasSigner"]) {
            const { error } = await sign(who, ipas.id, 7, "received")
            expect(error?.code, who).toBe("42501")
        }
        expect(await liveKeys(ipas.id)).not.toContain("7/received")
    })

    it("has no Prepared", async () => {
        const ipas = await raise()
        await approvedThrough(ipas)
        expect((await sign("outsider", ipas.id, 7, "prepared")).error?.code).toBe("22023")
    })
})

describe("filing", () => {
    it("is refused before LC Odoo Done, with the reason", async () => {
        for (const status of ["encoding", "encoded"]) {
            const ipas = await raise()
            // Set the status first: dropping a final Landed Cost back clears section 3 (#591), and
            // this test is about the LC Odoo Done gate, not the section 3 one.
            await setStatus(ipas.id, status)
            await approvedThrough(ipas)
            await receivedNotedChecked(ipas)

            const { error } = await sign("ipasSigner", ipas.id, 7, "approved")
            expect(error?.code, status).toBe("22023")
            expect(error?.message).toMatch(/LC Odoo Done/)
            const row = await rowOf(ipas.id)
            expect(row.state).toBe("open")
            expect(row.filed_at).toBeNull()
            expect(await liveKeys(ipas.id)).not.toContain("7/approved")
        }
    })

    it("files on Approved once costs are complete: state, filed_at and the history", async () => {
        const { ipas, done } = await filed()
        expect(done).toMatchObject({ filed: true, stage: "filed", notify_ids: [] })
        const row = await rowOf(ipas.id)
        expect(row.state).toBe("filed")
        expect(row.filed_at).not.toBeNull()
        expect(row.odoo_changed_since_filing).toBe(false)
        expect(await eventKinds(ipas.id)).toContain("filed")
        expect((await liveKeys(ipas.id)).filter((k) => k.startsWith("7/"))).toEqual(["7/approved", "7/checked", "7/noted", "7/received"])
    })

    it("refuses any further sign-off on a filed IPAS", async () => {
        const { ipas } = await filed()
        const { error } = await sign("finance", ipas.id, 7, "received")
        expect(error?.code).toBe("22023")
    })
})

describe("who each step notifies", () => {
    it("names exactly the next list, never the person signing", async () => {
        const ipas = await raise()
        await setStatus(ipas.id, "lc_odoo_done")

        const a = await signOk("outsider", ipas.id, 1, "prepared")
        expect(a).toMatchObject({ stage: "section_prepared", notify_ids: [ids.ipasSigner] })
        const b = await signOk("ipasSigner", ipas.id, 1, "approved")
        expect(b).toMatchObject({ stage: null, notify_ids: [] })
        await signOk("outsider", ipas.id, 3, "prepared")
        // Sections 1 and 2 approved is not enough: section 3 has to be approved too (#590).
        const c = await signOk("ipasSigner", ipas.id, 3, "approved")
        expect(c).toMatchObject({ stage: null, notify_ids: [] })
        await signOk("outsider", ipas.id, 6, "prepared")
        const six = await signOk("ipasSigner", ipas.id, 6, "approved")
        expect(six).toMatchObject({ stage: null, notify_ids: [] })
        // The last of sections 1, 2, 3 and Logistics is approved: the Received list (#713).
        const last = await signOk("ipasSigner", ipas.id, 8, "approved")
        expect(last).toMatchObject({ stage: "received_ready", notify_ids: [ids.finance] })

        // Received: the Noted and Checked lists.
        const received = await signOk("finance", ipas.id, 7, "received")
        expect(received.stage).toBe("noted_checked_ready")
        expect([...received.notify_ids].sort()).toEqual([ids.ordinary, ids.support].sort())

        // The first of Noted and Checked tells nobody; both given tell the Approved list.
        const noted = await signOk("ordinary", ipas.id, 7, "noted")
        expect(noted).toMatchObject({ stage: null, notify_ids: [] })
        const checked = await signOk("support", ipas.id, 7, "checked")
        expect(checked).toMatchObject({ stage: "approve_ready", notify_ids: [ids.ipasSigner] })
    })

    it("tells one person once when they are on both of the lists, and not the person acting", async () => {
        const ipas = await raise()
        await approvedThrough(ipas)
        await onList("s7_noted", "support")
        const received = await signOk("finance", ipas.id, 7, "received")
        expect([...received.notify_ids].sort()).toEqual([ids.ordinary, ids.support].sort())

        await onList("s7_approved", "support")
        await signOk("ordinary", ipas.id, 7, "noted")
        const checked = await signOk("support", ipas.id, 7, "checked")
        // support signed, so isn't told; the other Approved list member is.
        expect(checked.notify_ids).toEqual([ids.ipasSigner])
    })
})

describe("the freeze", () => {
    it("refuses every write on a filed IPAS's payments, charges, documents, bank details and SORs, service role included", async () => {
        const { ipas } = await filed({ project: true })
        const one = async (table) => (await svc().from(table).select("*").eq("ipas_id", ipas.id).limit(1)).data[0]
        const rows = {
            ipas_payments: await one("ipas_payments"),
            ipas_charges: await one("ipas_charges"),
            ipas_documents: await one("ipas_documents"),
            ipas_bank_details: await one("ipas_bank_details"),
            ipas_sors: await one("ipas_sors"),
        }
        for (const [table, row] of Object.entries(rows)) expect(row, `${table} has a row to test with`).toBeTruthy()
        const before = Object.fromEntries(
            await Promise.all(Object.keys(rows).map(async (t) => [t, (await svc().from(t).select("*").eq("ipas_id", ipas.id)).data])),
        )

        // The service role through PostgREST.
        const patches = {
            ipas_payments: { amount: 1 },
            ipas_charges: { amount_php: 1 },
            ipas_documents: { purchasing_has: !rows.ipas_documents.purchasing_has },
            ipas_bank_details: { bank_name: "Other bank" },
            ipas_sors: { opportunity_id: sorId },
        }
        const inserts = {
            ipas_payments: { ...stripIdentity(rows.ipas_payments), amount: 2 },
            ipas_charges: { ...stripIdentity(rows.ipas_charges), amount_php: 2 },
            ipas_documents: { ipas_id: ipas.id, label: "Late document" },
        }
        for (const table of Object.keys(rows)) {
            const key = table === "ipas_bank_details" ? "ipas_id" : "id"
            const update = await svc().from(table).update(patches[table]).eq(key, rows[table][key])
            expect(update.error?.code, `${table} update`).toBe("22023")
            const del = await svc().from(table).delete().eq(key, rows[table][key])
            expect(del.error?.code, `${table} delete`).toBe("22023")
            if (inserts[table]) {
                const insert = await svc().from(table).insert(inserts[table])
                expect(insert.error?.code, `${table} insert`).toBe("22023")
            }
        }

        // The superuser connection too: the trigger is the rule, not the role.
        for (const statement of [
            `update public.ipas_payments set amount = 3 where ipas_id = $1`,
            `delete from public.ipas_charges where ipas_id = $1`,
            `update public.ipas_documents set finance_has = true where ipas_id = $1`,
            `delete from public.ipas_bank_details where ipas_id = $1`,
            `delete from public.ipas_sors where ipas_id = $1`,
        ]) {
            await expect(sql().query(statement, [ipas.id]), statement).rejects.toThrow(/filed and frozen/)
        }

        for (const table of Object.keys(rows)) {
            const { data } = await svc().from(table).select("*").eq("ipas_id", ipas.id)
            expect(data, `${table} unchanged`).toEqual(before[table])
        }
    })

    it("refuses every change to the IPAS's own fields: Purpose, overrides, header, state, the copy", async () => {
        const { ipas } = await filed()
        const before = await rowOf(ipas.id)
        for (const patch of [
            { purpose: "supplies" },
            { remarks: "Edited" },
            { entity_override: "Elsewhere" },
            { source_doc_override: "S99999" },
            { analytic_override: "Other" },
            { supplier_contact: "Someone" },
            { pi_number: "PI-9" },
            { computation_status: "encoding" },
            { state: "open", filed_at: null },
            { state: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "x" },
            { odoo_copy: { po: { name: ipas.po_number }, lines: [] } },
            { odoo_change_note: { x: 1 } },
        ]) {
            const { error } = await svc().from("ipas").update(patch).eq("id", ipas.id)
            expect(error?.code, JSON.stringify(patch)).toBe("22023")
        }
        await expect(sql().query(`delete from public.ipas where id = $1`, [ipas.id])).rejects.toThrow(/filed and frozen/)
        expect(await rowOf(ipas.id)).toEqual(before)
    })

    it("lets the Odoo flag move on its own, both ways, and nothing alongside it", async () => {
        const { ipas } = await filed()
        const up = await svc().from("ipas").update({ odoo_changed_since_filing: true }).eq("id", ipas.id)
        expect(up.error).toBeNull()
        expect((await rowOf(ipas.id)).odoo_changed_since_filing).toBe(true)
        const down = await svc().from("ipas").update({ odoo_changed_since_filing: false }).eq("id", ipas.id)
        expect(down.error).toBeNull()
        expect((await rowOf(ipas.id)).odoo_changed_since_filing).toBe(false)

        const mixed = await svc().from("ipas").update({ odoo_changed_since_filing: true, remarks: "Sneaky" }).eq("id", ipas.id)
        expect(mixed.error?.code).toBe("22023")
        expect((await rowOf(ipas.id)).odoo_changed_since_filing).toBe(false)
    })

    it("refuses the functions that write, with their own sentence", async () => {
        const { ipas } = await filed()
        const refusals = await Promise.all([
            rpc("outsider", "ipas_set_purpose_and_sors", { p_ipas_id: ipas.id, p_purpose: "inventory", p_sor_ids: [] }),
            rpc("outsider", "ipas_add_charge", { p_ipas_id: ipas.id, p_kind_id: chargeKindId, p_charged_on: "2026-10-03", p_amount_php: 1 }),
            rpc("outsider", "ipas_set_bank_details", { p_ipas_id: ipas.id, p_bank_name: "X", p_account_name: "Y", p_account_number: "1" }),
            rpc("outsider", "ipas_override_field", { p_ipas_id: ipas.id, p_field: "entity", p_value: "TG" }),
        ])
        for (const { error } of refusals) expect(error?.code).toBe("22023")
    })

    it("leaves the CHECK constraints answering on an open IPAS", async () => {
        const ipas = await raise()
        // A Local IPAS can't carry an Import-only date: the #246 check still speaks.
        const { error } = await svc().from("ipas").update({ import_clearance_on: "2026-10-01" }).eq("id", ipas.id)
        expect(error?.code).toBe("23514")
    })
})

describe("the Odoo copy of a filed IPAS", () => {
    it("stores nothing new and only says that Odoo has changed", async () => {
        const { ipas } = await filed()
        const changed = copyFor(ipas.po_number, ipas.odoo_copy.supplier.id, [line(1), line(2, { quantity: 9, price_subtotal: 900 })])
        changed.po.id = ipas.odoo_copy.po.id

        const { data, error } = await rpc("outsider", "ipas_record_odoo_copy", { p_ipas_id: ipas.id, p_odoo_copy: changed })
        expect(error).toBeNull()
        expect(data).toMatchObject({ filed: true, changed: false, approvals_cleared: [], preparer_ids: [] })
        expect(data.ipas.odoo_changed_since_filing).toBe(true)

        const row = await rowOf(ipas.id)
        expect(row.odoo_copy).toEqual(ipas.odoo_copy)
        expect(row.odoo_fetched_at).toBe(ipas.odoo_fetched_at)
        expect(row.state).toBe("filed")
        expect(await eventKinds(ipas.id)).toContain("odoo_changed_since_filing")
        expect((await liveKeys(ipas.id)).filter((k) => k === "1/approved" || k === "3/approved")).toHaveLength(2)

        // The PO goes back to what was filed: the flag drops.
        const back = await rpc("outsider", "ipas_record_odoo_copy", { p_ipas_id: ipas.id, p_odoo_copy: ipas.odoo_copy })
        expect(back.error).toBeNull()
        expect((await rowOf(ipas.id)).odoo_changed_since_filing).toBe(false)
    })
})

describe("reopening", () => {
    it("is for Super Admins only, whoever else is on a list or holds a flag", async () => {
        const { ipas } = await filed()
        for (const who of CAST_KEYS.filter((k) => k !== "superAdmin")) {
            const { error } = await reopen(who, ipas.id, "Wrong figures")
            expect(error?.code, who).toBe("42501")
        }
        expect((await rowOf(ipas.id)).state).toBe("filed")
        expect((await reopen("superAdmin", ipas.id, "Wrong figures")).error).toBeNull()
    })

    it("needs a reason and a filed IPAS", async () => {
        const { ipas } = await filed()
        for (const reason of [null, "", "   "]) {
            expect((await reopen("superAdmin", ipas.id, reason)).error?.code, JSON.stringify(reason)).toBe("22023")
        }
        expect((await reopen("superAdmin", ipas.id, "x".repeat(501))).error?.code).toBe("22023")
        expect((await rowOf(ipas.id)).state).toBe("filed")

        const open = await raise()
        expect((await reopen("superAdmin", open.id, "Not filed")).error?.code).toBe("22023")
        expect((await reopen("superAdmin", "00000000-0000-0000-0000-000000000000", "Nope")).error?.code).toBe("22023")
    })

    it("clears section 7 only, keeps sections 1, 2 and 3 approved, and writes the history", async () => {
        const { ipas } = await filed()
        await svc().from("ipas").update({ odoo_changed_since_filing: true }).eq("id", ipas.id)

        const { data, error } = await reopen("superAdmin", ipas.id, "Charges were misread")
        expect(error).toBeNull()
        expect(data.cleared_roles).toEqual(["approved", "checked", "noted", "received"])

        const row = await rowOf(ipas.id)
        expect(row.state).toBe("open")
        expect(row.filed_at).toBeNull()
        expect(row.odoo_changed_since_filing).toBe(false)
        expect(await liveKeys(ipas.id)).toEqual(["1/approved", "1/prepared", "3/approved", "3/prepared", "6/approved", "6/prepared", "8/approved"])

        const cleared = await history(ipas.id)
        expect(cleared).toHaveLength(4)
        for (const r of cleared) {
            expect(r.section).toBe(7)
            expect(r.cleared_by).toBe(ids.superAdmin)
            expect(r.cleared_reason).toBe("Reopened: Charges were misread")
        }
        expect(await eventKinds(ipas.id)).toContain("reopened")
        const { data: events } = await svc().from("ipas_events").select("*").eq("ipas_id", ipas.id).eq("kind", "reopened")
        expect(events[0]).toMatchObject({ actor_id: ids.superAdmin })
        expect(events[0].detail.reason).toBe("Charges were misread")
    })

    it("makes edits work again, and can be filed once more through the whole chain", async () => {
        const { ipas } = await filed({ project: true })
        await reopen("superAdmin", ipas.id, "Fix a payment")

        const payment = await rpc("outsider", "ipas_add_payment", {
            p_ipas_id: ipas.id, p_kind: "full_payment", p_paid_on: "2026-10-09", p_amount: 100,
            p_php_debited: null, p_charge_fee_php: 0, p_method_id: methodId, p_check_no: null, p_proof_url: null,
        })
        expect(payment.error).toBeNull()
        // A Project keeps its SORs even when reopened (#551).
        const purpose = await rpc("outsider", "ipas_set_purpose_and_sors", { p_ipas_id: ipas.id, p_purpose: "inventory", p_sor_ids: [] })
        expect(purpose.error?.code).toBe("22023")

        // Section 7 starts again from Received.
        expect((await sign("ordinary", ipas.id, 7, "noted")).error?.code).toBe("22023")
        await receivedNotedChecked(ipas)
        expect((await sign("ipasSigner", ipas.id, 7, "approved")).error).toBeNull()
        expect((await rowOf(ipas.id)).state).toBe("filed")
    })
})

describe("cancelling", () => {
    it("is refused while filed, and works once the IPAS is reopened", async () => {
        const { ipas } = await filed()
        const refused = await rpc("outsider", "ipas_cancel", { p_ipas_id: ipas.id, p_reason: "Changed our minds" })
        expect(refused.error?.code).toBe("22023")
        expect(refused.error?.message).toMatch(/reopens/)
        expect((await rowOf(ipas.id)).state).toBe("filed")

        await reopen("superAdmin", ipas.id, "Raised in error")
        const cancelled = await rpc("outsider", "ipas_cancel", { p_ipas_id: ipas.id, p_reason: "Raised in error" })
        expect(cancelled.error).toBeNull()
        expect((await rowOf(ipas.id)).state).toBe("cancelled")
    })
})

function stripIdentity(row) {
    const { id: _id, created_at: _created, updated_at: _updated, ...rest } = row
    return rest
}
