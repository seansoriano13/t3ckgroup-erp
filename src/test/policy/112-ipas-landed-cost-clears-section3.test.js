/**
 * Landed Cost changes clear IPAS section 3; Return and Undo work on it (#591, spec #584).
 *
 * Section 3 is stored as sign-off section 6. Its Submitted and Approved vouch only for the
 * Landed Cost that was checked, so the database clears both (kept as history, reason
 * recorded, the people who signed told) when that Landed Cost changes: a payment or charge
 * added, changed or removed, the spread changed, an Odoo refresh that changes the lines or
 * total, or the status moving below LC Odoo Done. A document tick, a payment proof or an
 * Odoo refresh that changes no money leaves it standing. Payments and charges still never
 * clear sections 1 or 2 (stored 1 and 3).
 *
 * `outsider` holds Purchasing access and submits; `ipasSigner` approves; `finance`, `superAdmin`
 * and `hr` sign section 4 (stored 7).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser, recordOdooCopyAs, readyToSign } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => {
    // A sign-off now asks for documents, a Logistics placement and so on (#711, #713); give it what it asks for.
    if (name === "ipas_sign") await readyToSign(args.p_ipas_id, args.p_section, args.p_role)
    return (await clientFor(who)).rpc(name, args)
}

let poSeq = 0
let chargeKindId = null
let methodId = null

const copyFor = (po, over = {}) => ({
    po: { id: 870000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_800_000 + poSeq, name: "Landed Cost Supplier", contact: null },
    lines: [
        { line_id: 880000 + poSeq * 10, product_id: 7600, name: "Item 1", quantity: 2, unit: "Unit", price_unit: 100, price_subtotal: 200, taxes: [], analytic: [], brand: null },
        { line_id: 880000 + poSeq * 10 + 1, product_id: 7601, name: "Item 2", quantity: 1, unit: "Unit", price_unit: 300, price_subtotal: 300, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
    ...over,
})

async function raise() {
    const po = `P9${String(95000 + (poSeq += 1)).padStart(6, "0")}`
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const sign = (who, ipasId, section, role) => rpc(who, "ipas_sign", { p_ipas_id: ipasId, p_section: section, p_role: role })
async function signOk(who, ipasId, section, role) {
    const { data, error } = await sign(who, ipasId, section, role)
    if (error) throw new Error(`ipas_sign ${who} ${section}/${role}: ${error.message}`)
    return data
}
const header = (who, ipasId, fields) => rpc(who, "ipas_set_header", { p_ipas_id: ipasId, p_fields: fields })
const sendBack = (who, ipasId, section, reason) => rpc(who, "ipas_send_back", { p_ipas_id: ipasId, p_section: section, p_reason: reason })
const undo = (who, ipasId, section, reason) => rpc(who, "ipas_undo_approval", { p_ipas_id: ipasId, p_section: section, p_reason: reason })

const addPayment = (ipasId, over = {}) =>
    rpc("outsider", "ipas_add_payment", {
        p_ipas_id: ipasId,
        p_kind: "shipping_fee",
        p_paid_on: "2026-10-01",
        p_amount: 500,
        p_php_debited: null,
        p_charge_fee_php: 0,
        p_method_id: methodId,
        p_check_no: null,
        p_proof_url: null,
        ...over,
    })
const addCharge = (ipasId, amount = 150) =>
    rpc("outsider", "ipas_add_charge", { p_ipas_id: ipasId, p_kind_id: chargeKindId, p_charged_on: "2026-10-05", p_amount_php: amount })

const signoffs = async (ipasId) => (await svc().from("ipas_signoffs").select("*").eq("ipas_id", ipasId).order("signed_at")).data
const liveKeys = async (ipasId) => (await signoffs(ipasId)).filter((r) => !r.cleared_at).map((r) => `${r.section}/${r.role}`).sort()
const events = async (ipasId, kind) => (await svc().from("ipas_events").select("*").eq("ipas_id", ipasId).eq("kind", kind).order("created_at")).data
const notices = async (ipasId) =>
    (await svc().from("notifications").select("*").eq("reference_id", ipasId).eq("type", "IPAS_SECTION_3_CLEARED")).data

const CAST_IDS = () => CAST_KEYS.map((k) => ids[k])
const onList = async (listKey, who) => {
    const { error } = await svc().from("ipas_signer_lists").insert({ list_key: listKey, employee_id: ids[who] })
    if (error) throw error
}
const clearLists = async () => {
    const { error } = await svc().from("ipas_signer_lists").delete().in("employee_id", CAST_IDS())
    if (error) throw error
}

async function lists() {
    await clearLists()
    await onList("s1_approved", "ipasSigner")
    await onList("s3_approved", "ipasSigner")
    await onList("s6_approved", "ipasSigner")
    await onList("logistics_signed", "ipasSigner")
    await onList("s7_received", "ipasSigner")
    await onList("s7_noted", "superAdmin")
    await onList("s7_checked", "finance")
    await onList("s7_approved", "hr")
}

/** Sections 1, 2 and 3 submitted and approved, at LC Odoo Done. */
async function approvedAll() {
    const ipas = await raise()
    expect((await header("outsider", ipas.id, { computation_status: "lc_odoo_done" })).error).toBeNull()
    for (const section of [1, 3, 6]) {
        await signOk("outsider", ipas.id, section, "prepared")
        await signOk("ipasSigner", ipas.id, section, "approved")
    }
    // Logistics (stored 8) is the fourth gate on section 4 (#713).
    await signOk("ipasSigner", ipas.id, 8, "approved")
    return ipas
}

const SECTION_3 = ["6/approved", "6/prepared"]
// Logistics (stored 8) stands through every Landed Cost change: it is about where the goods are (#713).
const OTHERS = ["1/approved", "1/prepared", "3/approved", "3/prepared", "8/approved"]
const ALL = [...OTHERS, ...SECTION_3].sort()

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    chargeKindId = (await svc().from("ipas_options").select("id").eq("list", "charge_kind").eq("label", "Brokerage Fee").single()).data.id
    methodId = (await svc().from("ipas_options").select("id").eq("list", "payment_method").eq("label", "Dated Check").single()).data.id
})

beforeEach(lists)

afterAll(async () => {
    await clearLists()
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", CAST_IDS())
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("a Landed Cost change clears section 3 only", () => {
    const clearedBy = async (ipasId) => (await signoffs(ipasId)).filter((r) => r.cleared_at && r.section === 6)

    async function expectClearedOnly3(ipas, reason) {
        expect(await liveKeys(ipas.id)).toEqual([...OTHERS].sort())
        const cleared = (await clearedBy(ipas.id)).filter((r) => r.cleared_reason === reason)
        expect(cleared.map((r) => r.role).sort()).toEqual(["approved", "prepared"])
        const event = (await events(ipas.id, "approvals_cleared")).at(-1)
        expect(event.detail).toEqual({ reason, sections: [6] })
    }

    it("a payment added, changed and removed", async () => {
        const ipas = await approvedAll()
        const { data: row, error } = await addPayment(ipas.id)
        expect(error).toBeNull()
        await expectClearedOnly3(ipas, "Payment added")

        // Back to approved, then change the amount (a shipping fee counts in the pool).
        for (const role of ["prepared", "approved"]) await signOk(role === "prepared" ? "outsider" : "ipasSigner", ipas.id, 6, role)
        expect(await liveKeys(ipas.id)).toEqual(ALL)
        const changed = await rpc("outsider", "ipas_update_payment", {
            p_payment_id: row.id, p_kind: "shipping_fee", p_paid_on: "2026-10-01", p_amount: 900, p_php_debited: null,
            p_charge_fee_php: 0, p_method_id: methodId, p_check_no: null, p_proof_url: null,
        })
        expect(changed.error).toBeNull()
        await expectClearedOnly3(ipas, "Payment changed")

        for (const role of ["prepared", "approved"]) await signOk(role === "prepared" ? "outsider" : "ipasSigner", ipas.id, 6, role)
        const removed = await rpc("outsider", "ipas_remove_payment", { p_payment_id: row.id })
        expect(removed.error).toBeNull()
        await expectClearedOnly3(ipas, "Payment removed")
    })

    it("a charge added, changed and removed", async () => {
        const ipas = await approvedAll()
        const { data: row, error } = await addCharge(ipas.id)
        expect(error).toBeNull()
        await expectClearedOnly3(ipas, "Charge added")

        for (const role of ["prepared", "approved"]) await signOk(role === "prepared" ? "outsider" : "ipasSigner", ipas.id, 6, role)
        const changed = await rpc("outsider", "ipas_update_charge", {
            p_charge_id: row.id, p_kind_id: chargeKindId, p_charged_on: "2026-10-05", p_amount_php: 400,
        })
        expect(changed.error).toBeNull()
        await expectClearedOnly3(ipas, "Charge changed")

        for (const role of ["prepared", "approved"]) await signOk(role === "prepared" ? "outsider" : "ipasSigner", ipas.id, 6, role)
        const removed = await rpc("outsider", "ipas_remove_charge", { p_charge_id: row.id })
        expect(removed.error).toBeNull()
        await expectClearedOnly3(ipas, "Charge removed")
    })

    it("the spread changed, when it moves the money", async () => {
        const ipas = await approvedAll()
        // A charge first, so there is something to spread, then approve again on that number.
        expect((await addCharge(ipas.id, 300)).error).toBeNull()
        for (const role of ["prepared", "approved"]) await signOk(role === "prepared" ? "outsider" : "ipasSigner", ipas.id, 6, role)

        expect((await header("outsider", ipas.id, { landed_cost_split: "equal" })).error).toBeNull()
        await expectClearedOnly3(ipas, "Spread changed")
    })

    it("an Odoo refresh that changes the lines or the total", async () => {
        const ipas = await approvedAll()
        const changed = copyFor(ipas.po_number)
        changed.lines[0].price_unit = 150
        const { error } = await recordOdooCopyAs("outsider", { p_ipas_id: ipas.id, p_odoo_copy: changed })
        expect(error).toBeNull()
        // The refresh's own rule (#243) clears sections 1 and 2's approval; section 3 goes too.
        expect(await liveKeys(ipas.id)).not.toContain("6/approved")
        expect(await liveKeys(ipas.id)).not.toContain("6/prepared")
        const cleared = await clearedBy(ipas.id)
        expect(cleared.every((r) => r.cleared_reason === "PO changed in Odoo")).toBe(true)
        const sixEvent = (await events(ipas.id, "approvals_cleared")).find((e) => e.detail.sections?.includes(6))
        expect(sixEvent.detail).toEqual({ reason: "PO changed in Odoo", sections: [6] })
    })

    it("the status moving below LC Odoo Done, whatever the money", async () => {
        const ipas = await approvedAll()
        expect((await header("outsider", ipas.id, { computation_status: "lc_gs_done" })).error).toBeNull()
        await expectClearedOnly3(ipas, "Status moved below LC Odoo Done")
    })

    it("tells the people who signed, not the person who made the change", async () => {
        const ipas = await approvedAll()
        // ipasSigner approved; outsider submitted and makes the change.
        expect((await addCharge(ipas.id)).error).toBeNull()
        const told = await notices(ipas.id)
        expect(told.map((n) => n.recipient_id)).toEqual([ids.ipasSigner])
        expect(told[0].message).toMatch(/Section 3 of IPAS .* was cleared \(Charge added\)/)

    })

    it("the history shows it against section 3", async () => {
        const ipas = await approvedAll()
        expect((await addCharge(ipas.id)).error).toBeNull()
        const event = (await events(ipas.id, "approvals_cleared")).at(-1)
        expect(event.detail.sections).toEqual([6])
        expect(event.actor_id).toBe(ids.outsider)
    })
})

describe("what does not clear section 3", () => {
    it("a document tick, a payment proof upload and a refresh that moves no money", async () => {
        const ipas = await approvedAll()
        const before = await liveKeys(ipas.id)
        expect(before).toEqual(ALL)

        const doc = await svc().from("ipas_documents").select("id").eq("ipas_id", ipas.id).limit(1)
        if (doc.data?.length) {
            const tick = await sql().query(`update public.ipas_documents set updated_at = now() where id = $1`, [doc.data[0].id])
            expect(tick.rowCount).toBe(1)
        }
        expect((await header("outsider", ipas.id, { pi_number: "PI-1" })).error).toBeNull()

        // Receipts changed in Odoo, lines and total the same.
        const same = copyFor(ipas.po_number, { receipts: { status: "full", done: 1, total: 1 } })
        expect((await recordOdooCopyAs("outsider", { p_ipas_id: ipas.id, p_odoo_copy: same })).error).toBeNull()
        // A name-only change moves no money.
        const renamed = copyFor(ipas.po_number)
        renamed.lines[0].name = "Item 1 (renamed)"
        expect((await recordOdooCopyAs("outsider", { p_ipas_id: ipas.id, p_odoo_copy: renamed })).error).toBeNull()

        // Raising the status to the same step, and setting the same spread, change nothing.
        expect((await header("outsider", ipas.id, { computation_status: "lc_odoo_done", landed_cost_split: "value" })).error).toBeNull()

        expect(await liveKeys(ipas.id)).toEqual(ALL)
        expect((await signoffs(ipas.id)).filter((r) => r.cleared_at && r.section === 6)).toEqual([])
    })

    it("a payment proof changes no money", async () => {
        const ipas = await approvedAll()
        // Record a payment, approve on that number, then add a proof link to the same payment.
        const { data: row } = await addPayment(ipas.id)
        for (const role of ["prepared", "approved"]) await signOk(role === "prepared" ? "outsider" : "ipasSigner", ipas.id, 6, role)
        const proof = await rpc("outsider", "ipas_update_payment", {
            p_payment_id: row.id, p_kind: "shipping_fee", p_paid_on: "2026-10-01", p_amount: 500, p_php_debited: null,
            p_charge_fee_php: 0, p_method_id: methodId, p_check_no: null, p_proof_url: "https://res.cloudinary.com/demo/image/upload/pop.png",
        })
        expect(proof.error).toBeNull()
        expect(await liveKeys(ipas.id)).toContain("6/approved")
    })

    it("nobody is told when nothing is cleared", async () => {
        const ipas = await approvedAll()
        expect((await header("outsider", ipas.id, { pi_number: "PI-2" })).error).toBeNull()
        expect(await notices(ipas.id)).toEqual([])
    })

    it("section 3 not submitted yet: nothing to clear, nothing written", async () => {
        const ipas = await raise()
        expect((await addCharge(ipas.id)).error).toBeNull()
        expect((await events(ipas.id, "approvals_cleared"))).toEqual([])
    })
})

describe("payments and charges still never clear sections 1 or 2", () => {
    it("leave stored 1 and 3 standing, while clearing section 3", async () => {
        const ipas = await approvedAll()
        expect((await addPayment(ipas.id)).error).toBeNull()
        expect((await addCharge(ipas.id)).error).toBeNull()
        expect(await liveKeys(ipas.id)).toEqual([...OTHERS].sort())
    })
})

describe("Return and Undo approval on section 3", () => {
    const begun = async () => {
        const ipas = await approvedAll()
        await signOk("ipasSigner", ipas.id, 7, "received")
        await signOk("superAdmin", ipas.id, 7, "noted")
        await signOk("finance", ipas.id, 7, "checked")
        return ipas
    }

    it("Return clears Submitted and Approved and section 4's open sign-offs, and tells them", async () => {
        const ipas = await begun()
        const { data, error } = await sendBack("ipasSigner", ipas.id, 6, "Freight is wrong")
        expect(error).toBeNull()
        expect(data.cleared_roles).toEqual(["approved", "prepared"])
        expect(data.cleared_section_7).toEqual(["checked", "noted", "received"])
        expect([...data.notify_ids].sort()).toEqual([ids.outsider, ids.superAdmin, ids.finance].sort())
        expect(await liveKeys(ipas.id)).toEqual([...OTHERS].sort())

        const cleared = (await signoffs(ipas.id)).filter((r) => r.cleared_at)
        expect(cleared.filter((r) => r.section === 7).map((r) => r.cleared_reason)).toEqual(Array(3).fill("Section 3 returned: Freight is wrong"))
        expect((await events(ipas.id, "sent_back")).at(-1).detail).toMatchObject({ section: 6, reason: "Freight is wrong" })
    })

    it("Undo clears only Approved and section 4's open sign-offs", async () => {
        const ipas = await begun()
        const { data, error } = await undo("ipasSigner", ipas.id, 6, "Too fast")
        expect(error).toBeNull()
        expect(data.cleared_section_7).toEqual(["checked", "noted", "received"])
        expect([...data.notify_ids].sort()).toEqual([ids.superAdmin, ids.finance].sort())
        expect(await liveKeys(ipas.id)).toEqual([...OTHERS, "6/prepared"].sort())
        const cleared = (await signoffs(ipas.id)).filter((r) => r.cleared_at && r.section === 7)
        expect(cleared.map((r) => r.cleared_reason)).toEqual(Array(3).fill("Section 3 approval undone: Too fast"))
    })

    it("need a reason, a signer of section 3, and something to clear", async () => {
        const ipas = await approvedAll()
        expect((await sendBack("ipasSigner", ipas.id, 6, "  ")).error?.code).toBe("22023")
        expect((await sendBack("finance", ipas.id, 6, "x")).error?.code).toBe("42501")
        expect((await undo("finance", ipas.id, 6, "x")).error?.code).toBe("42501")
        expect((await undo("ipasSigner", ipas.id, 6, "ok")).error).toBeNull()
        expect((await undo("ipasSigner", ipas.id, 6, "again")).error?.code).toBe("22023")
    })
})
