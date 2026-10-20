/**
 * Sections 1 and 3 sign-offs (#247, spec #241): the database rules.
 *
 * `outsider` holds Purchasing access for the file and is the purchaser;
 * `finance` holds Finance access alone; `ipasSigner` is a plain employee the
 * tests put on sign-off lists; `superAdmin` is a Super Admin on no list until a
 * test adds them; `hr` sets call signs; `ordinary` and `deleted` are nobody.
 *
 * Everything runs through the real `ipas_sign`, `ipas_send_back`,
 * `ipas_record_odoo_copy` and `ipas_set_bank_details`, against the real
 * `ipas_signoffs`. Lists are rebuilt per test from nothing, so each test says
 * exactly who is on them.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql, rlsStatus } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser, recordOdooCopyAs } from "./support/ipas.js"
import { tryInsert, tryUpdate, tryDelete } from "./support/access.js"

const svc = () => serviceClient()

let poSeq = 0
/** A PO number nothing else in the tier uses. */
const nextPo = () => `P9${String(50000 + (poSeq += 1)).padStart(6, "0")}`

let supplierSeq = 0
const nextSupplier = () => 9_300_000 + (supplierSeq += 1)

const line = (n, over = {}) => ({
    line_id: 500000 + poSeq * 10 + n,
    product_id: 5300 + n,
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
    po: { id: 550000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: supplierId, name: "Scorpe Technologies", contact: null },
    lines,
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const rpc = async (who, name, args) =>
    name === "ipas_record_odoo_copy" ? recordOdooCopyAs(who, args) : (await clientFor(who)).rpc(name, args)

/** Raises an IPAS as the purchaser. */
async function raise(supplierId = nextSupplier()) {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po, supplierId),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const sign = (who, ipasId, section, role, over = {}) =>
    rpc(who, "ipas_sign", { p_ipas_id: ipasId, p_section: section, p_role: role, ...over })
const sendBack = (who, ipasId, section, reason) =>
    rpc(who, "ipas_send_back", { p_ipas_id: ipasId, p_section: section, p_reason: reason })

/** Signs as `who`, failing the test loudly if it is refused. */
async function signOk(who, ipasId, section, role, over) {
    const { data, error } = await sign(who, ipasId, section, role, over)
    if (error) throw new Error(`ipas_sign ${who} ${section}/${role}: ${error.message}`)
    return data
}

const onList = async (listKey, who) => {
    const { error } = await svc().from("ipas_signer_lists").insert({ list_key: listKey, employee_id: ids[who] })
    if (error) throw error
}

const CAST_IDS = () => CAST_KEYS.map((k) => ids[k])
const clearLists = async () => {
    const { error } = await svc().from("ipas_signer_lists").delete().in("employee_id", CAST_IDS())
    if (error) throw error
}

const signoffRows = async (ipasId) => {
    const { data, error } = await svc().from("ipas_signoffs").select("*").eq("ipas_id", ipasId).order("signed_at")
    if (error) throw error
    return data
}
const live = async (ipasId) => (await signoffRows(ipasId)).filter((r) => !r.cleared_at)
const liveKeys = async (ipasId) => (await live(ipasId)).map((r) => `${r.section}/${r.role}`).sort()

async function events(ipasId, ...kinds) {
    let query = svc().from("ipas_events").select("*").eq("ipas_id", ipasId).order("created_at")
    if (kinds.length) query = query.in("kind", kinds)
    const { data, error } = await query
    if (error) throw error
    return data
}

const file = (id) => sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [id])

let methodId

/** Prepares and approves section 1 and/or 3 on a fresh IPAS: purchaser prepares, `ipasSigner` approves. */
async function approved(sections = [1]) {
    const ipas = await raise()
    for (const section of sections) {
        await signOk("outsider", ipas.id, section, "prepared")
        await signOk("ipasSigner", ipas.id, section, "approved")
    }
    return ipas
}

const pay = (ipasId) =>
    rpc("outsider", "ipas_add_payment", {
        p_ipas_id: ipasId,
        p_kind: "down_payment",
        p_paid_on: "2026-10-01",
        p_amount: 500,
        p_php_debited: null,
        p_charge_fee_php: 0,
        p_method_id: methodId,
        p_check_no: null,
        p_proof_url: null,
    })

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    const { data, error } = await svc().from("ipas_options").select("id").eq("list", "payment_method").eq("label", "Dated Check").maybeSingle()
    if (error || !data) throw new Error("The payment methods aren't seeded")
    methodId = data.id
})

beforeEach(async () => {
    await clearLists()
    await onList("s1_approved", "ipasSigner")
    await onList("s3_approved", "ipasSigner")
})

afterAll(async () => {
    await clearLists()
    await svc().from("employees").update({ has_purchasing_flow: false, call_sign: null, signature_path: null }).in("id", CAST_IDS())
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("the new table is protected", () => {
    it("has row level security on and a policy", async () => {
        const { enabled, policies } = await rlsStatus("ipas_signoffs")
        expect(enabled).toBe(true)
        expect(policies).toBeGreaterThan(0)
    })

    it("is read by whoever reads IPAS, and by no one else", async () => {
        const ipas = await approved()
        const readers = ["outsider", "finance", "ipasSigner", "superAdmin"]
        for (const who of CAST_KEYS) {
            const { data, error } = await (await clientFor(who)).from("ipas_signoffs").select("id").eq("ipas_id", ipas.id)
            expect(error).toBeNull()
            expect(data.length > 0, `${who}`).toBe(readers.includes(who))
        }
    })

    it("can't be written by a client, purchaser and Super Admin included", async () => {
        const ipas = await approved()
        const [row] = await live(ipas.id)
        for (const who of ["outsider", "ipasSigner", "superAdmin", "finance", "hr"]) {
            const client = await clientFor(who)
            const insert = await tryInsert(client, "ipas_signoffs", {
                ipas_id: ipas.id, section: 3, role: "prepared", signed_by: ids[who],
            })
            expect(insert.ok, `${who} inserted a sign-off`).toBe(false)
            const update = await tryUpdate(client, "ipas_signoffs", row.id, { cleared_at: new Date().toISOString(), cleared_reason: "x" })
            expect(update.affected, `${who} updated a sign-off`).toBe(0)
            const del = await tryDelete(client, "ipas_signoffs", row.id)
            expect(del.affected, `${who} deleted a sign-off`).toBe(0)
        }
        expect(await liveKeys(ipas.id)).toEqual(["1/approved", "1/prepared"])
    })

    it("keeps a signature unchangeable, and a cleared row as history, for the service role too", async () => {
        const ipas = await approved()
        const [prepared] = (await live(ipas.id)).filter((r) => r.role === "prepared")

        const rewrite = await svc().from("ipas_signoffs").update({ signed_by: ids.finance }).eq("id", prepared.id)
        expect(rewrite.error?.code).toBe("42501")

        await sendBack("ipasSigner", ipas.id, 1, "Wrong supplier")
        const cleared = await svc().from("ipas_signoffs").update({ cleared_reason: "Rewritten" }).eq("id", prepared.id)
        expect(cleared.error?.code).toBe("42501")
    })

    it("allows only the section and role pairs the sheet has", async () => {
        const ipas = await raise()
        const bad = (section, role) =>
            svc().from("ipas_signoffs").insert({ ipas_id: ipas.id, section, role, signed_by: ids.outsider })
        expect((await bad(1, "received")).error?.code).toBe("23514")
        expect((await bad(3, "noted")).error?.code).toBe("23514")
        expect((await bad(7, "prepared")).error?.code).toBe("23514")
        expect((await bad(2, "prepared")).error?.code).toBe("23514")
        expect((await bad(7, "received")).error).toBeNull()
    })
})

describe("call signs", () => {
    afterAll(async () => {
        await svc().from("employees").update({ call_sign: null }).in("id", CAST_IDS())
    })

    const setCallSign = async (who, targetId, value) => {
        const { data, error } = await (await clientFor(who))
            .from("employees")
            .update({ call_sign: value })
            .eq("id", targetId)
            .select("id, call_sign")
        return { data, error }
    }
    const callSignOf = async (key) => {
        const { data } = await svc().from("employees").select("call_sign").eq("id", ids[key]).single()
        return data.call_sign
    }

    beforeEach(async () => {
        await svc().from("employees").update({ call_sign: null }).in("id", CAST_IDS())
    })

    it("is unique where it is set, and many people may have none", async () => {
        const first = await svc().from("employees").update({ call_sign: "9101" }).eq("id", ids.ordinary)
        expect(first.error).toBeNull()

        const clash = await svc().from("employees").update({ call_sign: "9101" }).eq("id", ids.dealOwner)
        expect(clash.error?.code).toBe("23505")

        const nulls = await svc().from("employees").select("id").in("id", [ids.support, ids.closingSales]).is("call_sign", null)
        expect(nulls.data).toHaveLength(2)
    })

    it("is never blank or padded", async () => {
        for (const value of ["", "   ", " 9102", "9102 "]) {
            const { error } = await svc().from("employees").update({ call_sign: value }).eq("id", ids.ordinary)
            expect(error?.code, JSON.stringify(value)).toBe("23514")
        }
    })

    it("is set by HR and by a Super Admin, anyone's", async () => {
        const byHr = await setCallSign("hr", ids.ordinary, "9103")
        expect(byHr.error).toBeNull()
        expect(await callSignOf("ordinary")).toBe("9103")

        const bySuperAdmin = await setCallSign("superAdmin", ids.dealOwner, "9104")
        expect(bySuperAdmin.error).toBeNull()
        expect(await callSignOf("dealOwner")).toBe("9104")

        const own = await setCallSign("hr", ids.hr, "9105")
        expect(own.error).toBeNull()
        expect(await callSignOf("hr")).toBe("9105")
    })

    it("is quietly left as it was when anyone else tries, their own included", async () => {
        await svc().from("employees").update({ call_sign: "9106" }).eq("id", ids.ordinary)

        for (const [who, target] of [
            ["ordinary", ids.ordinary],
            ["outsider", ids.outsider],
            ["finance", ids.finance],
            ["head", ids.ordinary],
        ]) {
            await setCallSign(who, target, "9199")
            const { data } = await svc().from("employees").select("call_sign").eq("id", target).single()
            expect(data.call_sign, `${who} changed ${target}`).not.toBe("9199")
        }
        expect(await callSignOf("ordinary")).toBe("9106")
        expect(await callSignOf("outsider")).toBeNull()

        // A profile save that carries the old value back is not an error.
        const { error } = await setCallSign("ordinary", ids.ordinary, "9106")
        expect(error).toBeNull()
    })
})

describe("the signer lists", () => {
    it("are changed through ipas_set_signer_list by a Super Admin only: add and remove", async () => {
        const set = (who, employeeIds) =>
            rpc(who, "ipas_set_signer_list", { p_list_key: "s7_checked", p_employee_ids: employeeIds })
        for (const who of ["outsider", "finance", "hr", "ipasSigner"]) {
            expect((await set(who, [ids.ordinary])).error?.code, `${who} changed a list`).toBe("42501")
        }
        expect((await svc().from("ipas_signer_lists").select("id").eq("list_key", "s7_checked").eq("employee_id", ids.ordinary)).data).toHaveLength(0)

        const added = await set("superAdmin", [ids.ordinary])
        expect(added.error).toBeNull()
        const [row] = (await svc().from("ipas_signer_lists").select("id").eq("list_key", "s7_checked").eq("employee_id", ids.ordinary)).data

        for (const who of ["outsider", "finance", "hr", "ipasSigner"]) {
            const del = await tryDelete(await clientFor(who), "ipas_signer_lists", row.id)
            expect(del.affected, `${who} removed from a list`).toBe(0)
        }
        expect((await set("superAdmin", [])).error).toBeNull()
        expect((await svc().from("ipas_signer_lists").select("id").eq("list_key", "s7_checked")).data).toHaveLength(0)
    })
})

describe("the sheet's signers are seeded by call sign", () => {
    it("matches an employee by call sign, and a call sign with nobody seeds nothing without failing", async () => {
        // The migration ran against a database with no call signs, so it seeded
        // nothing and raised notices. Running its seed again once a call sign
        // exists puts that person on exactly their lists.
        await svc().from("employees").update({ call_sign: "101" }).eq("id", ids.ordinary)
        try {
            await sql().query(`
                insert into public.ipas_signer_lists (list_key, employee_id)
                select t.list_key, e.id
                  from (values ('s1_approved'), ('s3_approved'), ('s7_approved')) as t (list_key)
                  join public.employees e on e.call_sign = '101'
                on conflict (list_key, employee_id) do nothing`)
            const { data } = await svc().from("ipas_signer_lists").select("list_key").eq("employee_id", ids.ordinary)
            expect(data.map((r) => r.list_key).sort()).toEqual(["s1_approved", "s3_approved", "s7_approved"])
        } finally {
            await svc().from("employees").update({ call_sign: null }).eq("id", ids.ordinary)
        }
    })
})

describe("ipas_sign: Prepared", () => {
    it("is given by Purchasing access, and nobody else: a signer, Finance, HR, a Super Admin or an ordinary employee is refused", async () => {
        const ipas = await raise()
        for (const who of ["ipasSigner", "finance", "hr", "superAdmin", "ordinary", "deleted"]) {
            const { error } = await sign(who, ipas.id, 1, "prepared")
            expect(error?.code, who).toBe("42501")
            expect(error?.message, who).toMatch(/Purchasing/)
        }
        expect(await live(ipas.id)).toEqual([])

        const { data, error } = await sign("outsider", ipas.id, 1, "prepared")
        expect(error).toBeNull()
        expect(data.signoff).toMatchObject({ ipas_id: ipas.id, section: 1, role: "prepared", signed_by: ids.outsider, cleared_at: null })
    })

    it("tells exactly that section's approval list, and never the person who prepared", async () => {
        await onList("s1_approved", "superAdmin")
        await onList("s1_approved", "outsider")
        await onList("s3_approved", "finance")
        const ipas = await raise()

        const one = await signOk("outsider", ipas.id, 1, "prepared")
        expect([...one.notify_ids].sort()).toEqual([ids.ipasSigner, ids.superAdmin].sort())

        const three = await signOk("outsider", ipas.id, 3, "prepared")
        expect([...three.notify_ids].sort()).toEqual([ids.finance, ids.ipasSigner].sort())
    })

    it("doesn't tell a soft-deleted person on the list", async () => {
        await onList("s1_approved", "deleted")
        const ipas = await raise()
        const out = await signOk("outsider", ipas.id, 1, "prepared")
        expect(out.notify_ids).toEqual([ids.ipasSigner])
    })

    it("can't be given twice for a section", async () => {
        const ipas = await raise()
        await signOk("outsider", ipas.id, 1, "prepared")
        const again = await sign("outsider", ipas.id, 1, "prepared")
        expect(again.error?.code).toBe("22023")
        expect(await liveKeys(ipas.id)).toEqual(["1/prepared"])
    })

    it("keeps sections 1 and 3 apart", async () => {
        const ipas = await raise()
        await signOk("outsider", ipas.id, 3, "prepared")
        expect(await liveKeys(ipas.id)).toEqual(["3/prepared"])
        const [event] = await events(ipas.id, "signed")
        expect(event.detail).toMatchObject({ section: 3, role: "prepared" })
        expect(event.actor_id).toBe(ids.outsider)
    })
})

describe("ipas_sign: Approved", () => {
    it("works after Prepared, for sections 1 and 3, by someone else on the list", async () => {
        const ipas = await raise()
        await signOk("outsider", ipas.id, 1, "prepared")
        await signOk("outsider", ipas.id, 3, "prepared")

        const one = await sign("ipasSigner", ipas.id, 1, "approved")
        expect(one.error).toBeNull()
        expect(one.data.signoff).toMatchObject({ section: 1, role: "approved", signed_by: ids.ipasSigner })
        expect(one.data.notify_ids).toEqual([])
        expect(await liveKeys(ipas.id)).toEqual(["1/approved", "1/prepared", "3/prepared"])

        await signOk("ipasSigner", ipas.id, 3, "approved")
        expect(await liveKeys(ipas.id)).toEqual(["1/approved", "1/prepared", "3/approved", "3/prepared"])
        expect((await events(ipas.id, "signed")).map((e) => `${e.detail.section}/${e.detail.role}`)).toEqual([
            "1/prepared", "3/prepared", "1/approved", "3/approved",
        ])
    })

    it("refuses the preparer, even when they are on the list", async () => {
        await onList("s1_approved", "outsider")
        const ipas = await raise()
        await signOk("outsider", ipas.id, 1, "prepared")

        const { error } = await sign("outsider", ipas.id, 1, "approved")

        expect(error?.code).toBe("42501")
        expect(error?.message).toMatch(/prepared section 1/)
        expect(await liveKeys(ipas.id)).toEqual(["1/prepared"])
    })

    it("refuses someone off the list, a Super Admin included, until they add themselves", async () => {
        const ipas = await raise()
        await signOk("outsider", ipas.id, 1, "prepared")

        for (const who of ["superAdmin", "finance", "hr", "ordinary", "head"]) {
            const { error } = await sign(who, ipas.id, 1, "approved")
            expect(error?.code, who).toBe("42501")
            expect(error?.message, who).toMatch(/not on the list/)
        }
        expect(await liveKeys(ipas.id)).toEqual(["1/prepared"])

        // A Super Admin writes the lists, so can add themselves.
        const added = await rpc("superAdmin", "ipas_set_signer_list", {
            p_list_key: "s1_approved",
            p_employee_ids: [ids.ipasSigner, ids.superAdmin],
        })
        expect(added.error).toBeNull()
        const { error } = await sign("superAdmin", ipas.id, 1, "approved")
        expect(error).toBeNull()
        expect(await liveKeys(ipas.id)).toEqual(["1/approved", "1/prepared"])
    })

    it("needs the section's own list: section 1's approver can't approve section 3", async () => {
        await clearLists()
        await onList("s1_approved", "ipasSigner")
        const ipas = await raise()
        await signOk("outsider", ipas.id, 3, "prepared")

        const { error } = await sign("ipasSigner", ipas.id, 3, "approved")

        expect(error?.code).toBe("42501")
    })

    it("refuses a soft-deleted person on the list", async () => {
        await onList("s1_approved", "deleted")
        const ipas = await raise()
        await signOk("outsider", ipas.id, 1, "prepared")
        const { error } = await sign("deleted", ipas.id, 1, "approved")
        expect(error?.code).toBe("42501")
    })

    it("needs the section prepared first", async () => {
        const ipas = await raise()
        const { error } = await sign("ipasSigner", ipas.id, 1, "approved")
        expect(error?.code).toBe("22023")
        expect(error?.message).toMatch(/hasn't been prepared/)
    })

    it("can't be given twice", async () => {
        await onList("s1_approved", "finance")
        const ipas = await raise()
        await signOk("outsider", ipas.id, 1, "prepared")
        await signOk("ipasSigner", ipas.id, 1, "approved")
        const again = await sign("finance", ipas.id, 1, "approved")
        expect(again.error?.code).toBe("22023")
        expect(await liveKeys(ipas.id)).toEqual(["1/approved", "1/prepared"])
    })

    it("snapshots the signer's stored signature, or none when they decline it", async () => {
        await svc().from("employees").update({ signature_path: "sig/ipas-signer-v1.png" }).eq("id", ids.ipasSigner)
        const ipas = await raise()
        await signOk("outsider", ipas.id, 1, "prepared")
        const { data } = await sign("ipasSigner", ipas.id, 1, "approved")
        expect(data.signoff).toMatchObject({ signature_declined: false, signature_version: "sig/ipas-signer-v1.png" })

        // A new signature later doesn't rewrite the old row.
        await svc().from("employees").update({ signature_path: "sig/ipas-signer-v2.png" }).eq("id", ids.ipasSigner)
        const [approvedRow] = (await live(ipas.id)).filter((r) => r.role === "approved")
        expect(approvedRow.signature_version).toBe("sig/ipas-signer-v1.png")

        const declining = await raise()
        await signOk("outsider", declining.id, 1, "prepared")
        const declined = await sign("ipasSigner", declining.id, 1, "approved", { p_decline_signature: true })
        expect(declined.data.signoff).toMatchObject({ signature_declined: true, signature_version: null })
    })
})

describe("ipas_sign: what it refuses", () => {
    it("a pair the sheet doesn't have", async () => {
        const ipas = await raise()
        for (const [section, role] of [[1, "received"], [3, "noted"], [2, "prepared"], [7, "prepared"], [1, "checked"]]) {
            const { error } = await sign("outsider", ipas.id, section, role)
            expect(error?.code, `${section}/${role}`).toBe("22023")
        }
        expect(await live(ipas.id)).toEqual([])
    })

    it("a filed or cancelled IPAS, one that doesn't exist, and a caller who isn't signed in", async () => {
        const filed = await raise()
        await signOk("outsider", filed.id, 1, "prepared")
        await file(filed.id)
        expect((await sign("ipasSigner", filed.id, 1, "approved")).error?.code).toBe("22023")
        expect((await sign("outsider", filed.id, 3, "prepared")).error?.code).toBe("22023")

        const cancelled = await raise()
        await rpc("outsider", "ipas_cancel", { p_ipas_id: cancelled.id, p_reason: "Wrong PO" })
        expect((await sign("outsider", cancelled.id, 1, "prepared")).error?.code).toBe("22023")

        const missing = await sign("outsider", "00000000-0000-0000-0000-000000000000", 1, "prepared")
        expect(missing.error?.code).toBe("22023")

        const anon = await anonymousClient().rpc("ipas_sign", { p_ipas_id: filed.id, p_section: 1, p_role: "prepared" })
        expect(anon.error).toBeTruthy()
    })
})

describe("ipas_send_back", () => {
    it("needs a reason", async () => {
        const ipas = await approved()
        for (const reason of ["", "   ", null]) {
            const { error } = await sendBack("ipasSigner", ipas.id, 1, reason)
            expect(error?.code, JSON.stringify(reason)).toBe("22023")
        }
        expect(await liveKeys(ipas.id)).toEqual(["1/approved", "1/prepared"])
    })

    it("clears the section's Prepared and Approved, keeps them as history, and names the preparer", async () => {
        const ipas = await approved([1, 3])

        const { data, error } = await sendBack("ipasSigner", ipas.id, 1, "  Supplier is wrong  ")

        expect(error).toBeNull()
        expect(data.cleared_roles).toEqual(["approved", "prepared"])
        expect(data.preparer_ids).toEqual([ids.outsider])
        // Section 3 is untouched.
        expect(await liveKeys(ipas.id)).toEqual(["3/approved", "3/prepared"])

        const rows = await signoffRows(ipas.id)
        const cleared = rows.filter((r) => r.cleared_at)
        expect(cleared.map((r) => [r.section, r.role, r.cleared_reason, r.cleared_by])).toEqual(
            expect.arrayContaining([
                [1, "prepared", "Returned: Supplier is wrong", ids.ipasSigner],
                [1, "approved", "Returned: Supplier is wrong", ids.ipasSigner],
            ]),
        )
        expect(cleared).toHaveLength(2)

        const [event] = await events(ipas.id, "sent_back")
        expect(event.detail).toMatchObject({ section: 1, reason: "Supplier is wrong", cleared: ["approved", "prepared"] })
        expect(event.actor_id).toBe(ids.ipasSigner)
    })

    it("can return a section that is only Prepared, and the section can then be prepared again", async () => {
        const ipas = await raise()
        await signOk("outsider", ipas.id, 1, "prepared")

        const { data } = await sendBack("ipasSigner", ipas.id, 1, "Attach the quotation")
        expect(data.cleared_roles).toEqual(["prepared"])
        expect(await live(ipas.id)).toEqual([])

        await signOk("outsider", ipas.id, 1, "prepared")
        expect(await liveKeys(ipas.id)).toEqual(["1/prepared"])
        expect((await signoffRows(ipas.id)).filter((r) => r.role === "prepared")).toHaveLength(2)
    })

    it("is for a signer of that section: a purchaser, Finance, HR and a Super Admin off the list are refused", async () => {
        const ipas = await approved()
        for (const who of ["outsider", "finance", "hr", "superAdmin", "ordinary"]) {
            const { error } = await sendBack(who, ipas.id, 1, "No")
            expect(error?.code, who).toBe("42501")
        }
        await clearLists()
        await onList("s3_approved", "ipasSigner")
        expect((await sendBack("ipasSigner", ipas.id, 1, "No")).error?.code).toBe("42501")
        expect(await liveKeys(ipas.id)).toEqual(["1/approved", "1/prepared"])

        await onList("s1_approved", "superAdmin")
        expect((await sendBack("superAdmin", ipas.id, 1, "Not the right supplier")).error).toBeNull()
    })

    it("refuses a section with nothing signed, a section that can't be sent back, and a filed or cancelled IPAS", async () => {
        const ipas = await raise()
        expect((await sendBack("ipasSigner", ipas.id, 1, "Nothing here")).error?.code).toBe("22023")
        expect((await sendBack("ipasSigner", ipas.id, 7, "x")).error?.code).toBe("42501") // on no section 7 list
        expect((await sendBack("ipasSigner", ipas.id, 2, "x")).error?.code).toBe("22023")

        const filed = await approved()
        await file(filed.id)
        expect((await sendBack("ipasSigner", filed.id, 1, "Too late")).error?.code).toBe("22023")
        expect(await liveKeys(filed.id)).toEqual(["1/approved", "1/prepared"])
    })
})

describe("what undoes an approval, for real", () => {
    it("the PO's lines changing clears both approvals with 'PO changed in Odoo', keeps Prepared and names the preparer", async () => {
        const ipas = await approved([1, 3])
        const next = copyFor(ipas.po_number, ipas.odoo_copy.supplier.id, [line(1), line(2)])

        const { data, error } = await rpc("outsider", "ipas_record_odoo_copy", { p_ipas_id: ipas.id, p_odoo_copy: next })

        expect(error).toBeNull()
        expect(data.approvals_cleared).toEqual([1, 3])
        expect(data.preparer_ids).toEqual([ids.outsider])
        expect(await liveKeys(ipas.id)).toEqual(["1/prepared", "3/prepared"])
        const cleared = (await signoffRows(ipas.id)).filter((r) => r.cleared_at)
        expect(cleared.map((r) => [r.section, r.role, r.cleared_reason]).sort()).toEqual([
            [1, "approved", "PO changed in Odoo"],
            [3, "approved", "PO changed in Odoo"],
        ])
        expect((await events(ipas.id, "approvals_cleared"))[0].detail).toMatchObject({
            reason: "PO changed in Odoo",
            sections: [1, 3],
        })

        // The section can be approved again, by a fresh sign-off.
        await signOk("ipasSigner", ipas.id, 1, "approved")
        expect(await liveKeys(ipas.id)).toEqual(["1/approved", "1/prepared", "3/prepared"])
    })

    it("a different Account # for the same supplier flags it and clears only the section 2 (stored 3) approval with 'Account # flagged'", async () => {
        const supplier = nextSupplier()
        const typeBank = async (ipasId, accountNumber) => {
            const { data, error } = await rpc("outsider", "ipas_set_bank_details", {
                p_ipas_id: ipasId, p_bank_name: "BDO", p_account_name: "Scorpe", p_account_number: accountNumber,
            })
            if (error) throw new Error(error.message)
            return data
        }
        const first = await raise(supplier)
        await typeBank(first.id, "1111")

        const second = await raise(supplier)
        for (const section of [1, 3]) {
            await signOk("outsider", second.id, section, "prepared")
            await signOk("ipasSigner", second.id, section, "approved")
        }
        const out = await typeBank(second.id, "9999")

        expect(out).toMatchObject({ flagged: true, account_changed: true, approvals_cleared: [3] })
        expect(out.preparer_ids).toEqual([ids.outsider])
        expect(await liveKeys(second.id)).toEqual(["1/approved", "1/prepared", "3/prepared"])
        const cleared = (await signoffRows(second.id)).filter((r) => r.cleared_at)
        expect(cleared.every((r) => r.cleared_reason === "Account # flagged")).toBe(true)
    })

    it("a payment, a charge, an override, Purpose and SORs leave every approval standing", async () => {
        const ipas = await approved([1, 3])
        const before = await liveKeys(ipas.id)
        expect(before).toEqual(["1/approved", "1/prepared", "3/approved", "3/prepared"])

        const payment = await pay(ipas.id)
        expect(payment.error).toBeNull()

        const { data: kind } = await svc().from("ipas_options").select("id").eq("list", "charge_kind").eq("label", "Brokerage Fee").single()
        const charge = await rpc("outsider", "ipas_add_charge", {
            p_ipas_id: ipas.id, p_kind_id: kind.id, p_charged_on: "2026-10-05", p_amount_php: 150,
        })
        expect(charge.error).toBeNull()

        const override = await rpc("outsider", "ipas_override_field", { p_ipas_id: ipas.id, p_field: "entity", p_value: "T3CK Holdings" })
        expect(override.error).toBeNull()

        const header = await rpc("outsider", "ipas_set_header", { p_ipas_id: ipas.id, p_fields: { pi_number: "PI-77" } })
        expect(header.error).toBeNull()

        const purpose = await rpc("outsider", "ipas_set_purpose_and_sors", { p_ipas_id: ipas.id, p_purpose: "supplies", p_sor_ids: [] })
        expect(purpose.error).toBeNull()

        // Nor does a refresh that changes nothing in the lines or total.
        const same = await rpc("outsider", "ipas_record_odoo_copy", {
            p_ipas_id: ipas.id,
            p_odoo_copy: { ...copyFor(ipas.po_number, ipas.odoo_copy.supplier.id), receipts: { status: "full", done: 1, total: 1 } },
        })
        expect(same.error).toBeNull()
        expect(same.data.approvals_cleared).toEqual([])

        expect(await liveKeys(ipas.id)).toEqual(before)
        expect((await signoffRows(ipas.id)).filter((r) => r.cleared_at)).toEqual([])
    })
})

describe("paid before approval", () => {
    const flagOf = async (id) => (await svc().from("ipas_payments").select("paid_before_approval").eq("id", id).single()).data.paid_before_approval

    it("is set on a payment recorded while section 1 has no live Approved, and not once it has", async () => {
        const ipas = await raise()
        const early = (await pay(ipas.id)).data
        expect(await flagOf(early.id)).toBe(true)

        await signOk("outsider", ipas.id, 1, "prepared")
        const prepared = (await pay(ipas.id)).data
        expect(await flagOf(prepared.id)).toBe(true)

        await signOk("ipasSigner", ipas.id, 1, "approved")
        const after = (await pay(ipas.id)).data
        expect(await flagOf(after.id)).toBe(false)

        // An earlier payment stays flagged after the approval.
        expect(await flagOf(early.id)).toBe(true)
    })

    it("depends on section 1 alone, and comes back when the approval is cleared", async () => {
        const ipas = await raise()
        await signOk("outsider", ipas.id, 3, "prepared")
        await signOk("ipasSigner", ipas.id, 3, "approved")
        expect(await flagOf((await pay(ipas.id)).data.id)).toBe(true)

        await signOk("outsider", ipas.id, 1, "prepared")
        await signOk("ipasSigner", ipas.id, 1, "approved")
        expect(await flagOf((await pay(ipas.id)).data.id)).toBe(false)

        await sendBack("ipasSigner", ipas.id, 1, "Check the price")
        expect(await flagOf((await pay(ipas.id)).data.id)).toBe(true)
    })

    it("can't be set or cleared by anyone, the service role included", async () => {
        const ipas = await raise()
        const early = (await pay(ipas.id)).data
        expect(await flagOf(early.id)).toBe(true)

        await svc().from("ipas_payments").update({ paid_before_approval: false, amount: 600 }).eq("id", early.id)
        expect(await flagOf(early.id)).toBe(true)
        expect((await svc().from("ipas_payments").select("amount").eq("id", early.id).single()).data.amount).toBe(600)

        const updated = await rpc("outsider", "ipas_update_payment", {
            p_payment_id: early.id, p_kind: "down_payment", p_paid_on: "2026-10-02", p_amount: 700,
            p_php_debited: null, p_charge_fee_php: 0, p_method_id: methodId, p_check_no: null, p_proof_url: null,
        })
        expect(updated.error).toBeNull()
        expect(await flagOf(early.id)).toBe(true)
    })
})
