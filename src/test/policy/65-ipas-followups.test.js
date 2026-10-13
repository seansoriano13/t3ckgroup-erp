/**
 * IPAS follow-ups (#241): the database rules.
 *
 *   - signature images: whoever reads IPAS reads the signature a sign-off was
 *     given with, and nothing else in the `signatures` bucket
 *   - section 7 is sent back by anyone on a section 7 list
 *   - the signer lists are changed by ipas_set_signer_list, which logs
 *
 * (Removing a document is in 60-ipas-documents-statuses.)
 *
 * `outsider` holds Purchasing access for the file and is the purchaser;
 * `ipasSigner` approves sections 1 and 3 and is Received; `superAdmin` is Noted
 * and `finance` Checked; `hr` is on Approved only; `ordinary` is on nothing.
 * Lists are rebuilt per test from nothing.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql, rlsStatus } from "./support/stack.js"
import { purgeFixtureIpas } from "./support/ipas.js"
import { tryInsert, tryUpdate, tryDelete } from "./support/access.js"

const svc = () => serviceClient()

let poSeq = 0
const nextPo = () => `P9${String(70000 + (poSeq += 1)).padStart(6, "0")}`

let supplierSeq = 0
const nextSupplier = () => 9_500_000 + (supplierSeq += 1)

const copyFor = (po, supplierId) => ({
    po: { id: 750000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: supplierId, name: "Follow-up Supplier", contact: null },
    lines: [
        { line_id: 760000 + poSeq * 10, product_id: 7300, name: "Item 1", quantity: 2, unit: "Unit", price_unit: 100, price_subtotal: 200, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

async function raise() {
    const po = nextPo()
    const { data, error } = await rpc("outsider", "ipas_create", {
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po, nextSupplier()),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const sign = (who, ipasId, section, role, over = {}) =>
    rpc(who, "ipas_sign", { p_ipas_id: ipasId, p_section: section, p_role: role, ...over })
const sendBack = (who, ipasId, section, reason) =>
    rpc(who, "ipas_send_back", { p_ipas_id: ipasId, p_section: section, p_reason: reason })

async function signOk(who, ipasId, section, role, over) {
    const { data, error } = await sign(who, ipasId, section, role, over)
    if (error) throw new Error(`ipas_sign ${who} ${section}/${role}: ${error.message}`)
    return data
}

const setList = (who, listKey, employeeIds) =>
    rpc(who, "ipas_set_signer_list", { p_list_key: listKey, p_employee_ids: employeeIds })

const onList = async (listKey, who) => {
    const { error } = await svc().from("ipas_signer_lists").insert({ list_key: listKey, employee_id: ids[who] })
    if (error) throw error
}

const CAST_IDS = () => CAST_KEYS.map((k) => ids[k])
const clearLists = async () => {
    const { error } = await svc().from("ipas_signer_lists").delete().in("employee_id", CAST_IDS())
    if (error) throw error
}

const signoffs = async (ipasId) => {
    const { data, error } = await svc().from("ipas_signoffs").select("*").eq("ipas_id", ipasId).order("signed_at")
    if (error) throw error
    return data
}
const liveKeys = async (ipasId) =>
    (await signoffs(ipasId)).filter((r) => !r.cleared_at).map((r) => `${r.section}/${r.role}`).sort()

async function events(ipasId, ...kinds) {
    let query = svc().from("ipas_events").select("*").eq("ipas_id", ipasId).order("created_at")
    if (kinds.length) query = query.in("kind", kinds)
    const { data, error } = await query
    if (error) throw error
    return data
}

const file = (id) => sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [id])

/** Lists for the section 7 tests, and sections 1 and 3 approved on a fresh IPAS. */
async function listsForSectionSeven() {
    await clearLists()
    await onList("s1_approved", "ipasSigner")
    await onList("s3_approved", "ipasSigner")
    await onList("s7_received", "ipasSigner")
    await onList("s7_noted", "superAdmin")
    await onList("s7_checked", "finance")
    await onList("s7_approved", "hr")
}

async function opened() {
    const ipas = await raise()
    for (const section of [1, 3]) {
        await signOk("outsider", ipas.id, section, "prepared")
        await signOk("ipasSigner", ipas.id, section, "approved")
    }
    return ipas
}

async function receivedNotedChecked(ipas) {
    await signOk("ipasSigner", ipas.id, 7, "received")
    await signOk("superAdmin", ipas.id, 7, "noted")
    await signOk("finance", ipas.id, 7, "checked")
}

// A one-pixel PNG, small enough for the bucket's limit.
const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
)
const uploaded = []
async function upload(employeeKey) {
    const path = `${ids[employeeKey]}/${crypto.randomUUID()}.png`
    const { error } = await svc().storage.from("signatures").upload(path, PNG, { contentType: "image/png", upsert: false })
    if (error) throw new Error(`Uploading ${path}: ${error.message}`)
    uploaded.push(path)
    return path
}
const setSignaturePath = async (employeeKey, path) => {
    const { error } = await svc().from("employees").update({ signature_path: path }).eq("id", ids[employeeKey])
    if (error) throw error
}
/** Whether `who` can download the file. */
const canDownload = async (who, path) => {
    const { data, error } = await (await clientFor(who)).storage.from("signatures").download(path)
    return !error && Boolean(data)
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

beforeEach(async () => {
    await clearLists()
    await onList("s1_approved", "ipasSigner")
    await onList("s3_approved", "ipasSigner")
})

afterAll(async () => {
    await clearLists()
    await svc().from("employees").update({ has_purchasing_flow: false, signature_path: null }).in("id", CAST_IDS())
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    if (uploaded.length) await svc().storage.from("signatures").remove(uploaded)
})

describe("signature images on a print", () => {
    it("lets whoever reads IPAS download the signature a sign-off was given with, and no one else", async () => {
        const signed = await upload("ipasSigner")
        await setSignaturePath("ipasSigner", signed)
        const ipas = await raise()
        await signOk("outsider", ipas.id, 1, "prepared")
        await signOk("ipasSigner", ipas.id, 1, "approved")

        // Readers of IPAS: Purchasing access, Finance access, a Super Admin, a signer.
        for (const who of ["outsider", "finance", "superAdmin", "ipasSigner"]) {
            expect(await canDownload(who, signed), `${who} should read the signature`).toBe(true)
        }
        // Everyone else, as before.
        for (const who of ["ordinary", "dealOwner", "support", "head", "deleted"]) {
            expect(await canDownload(who, signed), `${who} should not`).toBe(false)
        }
    })

    it("opens only the signatures signed with: not a signer's other versions, not a non-signer's file", async () => {
        const signed = await upload("ipasSigner")
        const later = await upload("ipasSigner")
        const bystander = await upload("ordinary")
        await setSignaturePath("ipasSigner", signed)
        await setSignaturePath("ordinary", bystander)
        const ipas = await raise()
        await signOk("outsider", ipas.id, 1, "prepared")
        await signOk("ipasSigner", ipas.id, 1, "approved")
        await setSignaturePath("ipasSigner", later)

        expect(await canDownload("outsider", signed)).toBe(true)
        expect(await canDownload("outsider", later), "a version nobody signed with").toBe(false)
        expect(await canDownload("outsider", bystander), "a non-signer's signature").toBe(false)
        expect(await canDownload("finance", bystander)).toBe(false)
    })

    it("still opens the signature after the sign-off is cleared, and never one that was declined", async () => {
        const signed = await upload("ipasSigner")
        await setSignaturePath("ipasSigner", signed)
        const ipas = await raise()
        await signOk("outsider", ipas.id, 1, "prepared")
        await signOk("ipasSigner", ipas.id, 1, "approved")
        expect((await sendBack("ipasSigner", ipas.id, 1, "Wrong supplier")).error).toBeNull()
        expect(await canDownload("finance", signed), "cleared sign-offs stay printable history").toBe(true)

        // A declined sign-off keeps no signature, so opens nothing.
        const other = await upload("finance")
        await setSignaturePath("finance", other)
        await clearLists()
        await onList("s1_approved", "finance")
        const second = await raise()
        await signOk("outsider", second.id, 1, "prepared")
        await signOk("finance", second.id, 1, "approved", { p_decline_signature: true })
        expect(await canDownload("outsider", other)).toBe(false)
    })

    it("leaves the owner's and HR's reading as it was", async () => {
        const mine = await upload("ordinary")
        expect(await canDownload("ordinary", mine)).toBe(true)
        expect(await canDownload("hr", mine)).toBe(true)
        expect(await canDownload("outsider", mine)).toBe(false)
    })

    it("answers through a helper only the signed-in can call", async () => {
        const signed = await upload("ipasSigner")
        await setSignaturePath("ipasSigner", signed)
        const ipas = await raise()
        await signOk("outsider", ipas.id, 1, "prepared")
        await signOk("ipasSigner", ipas.id, 1, "approved")

        expect((await rpc("outsider", "ipas_signature_readable", { p_name: signed })).data).toBe(true)
        expect((await rpc("ordinary", "ipas_signature_readable", { p_name: signed })).data).toBe(false)
        expect((await rpc("outsider", "ipas_signature_readable", { p_name: null })).data).toBe(false)
    })
})

describe("sending back section 7", () => {
    beforeEach(listsForSectionSeven)

    it("clears Received, Noted and Checked, keeps them as history, writes the event and names who to tell", async () => {
        const ipas = await opened()
        await receivedNotedChecked(ipas)
        expect(await liveKeys(ipas.id)).toEqual(["1/approved", "1/prepared", "3/approved", "3/prepared", "7/checked", "7/noted", "7/received"])

        // `finance` is the Checked signer and sends it back.
        const { data, error } = await sendBack("finance", ipas.id, 7, "Wrong landed cost split")
        expect(error).toBeNull()
        expect(data.cleared_roles).toEqual(["checked", "noted", "received"])
        expect([...data.notify_ids].sort()).toEqual([ids.ipasSigner, ids.superAdmin].sort())
        expect(data.notify_ids).not.toContain(ids.finance)

        expect(await liveKeys(ipas.id)).toEqual(["1/approved", "1/prepared", "3/approved", "3/prepared"])
        const cleared = (await signoffs(ipas.id)).filter((r) => r.section === 7)
        expect(cleared).toHaveLength(3)
        for (const row of cleared) {
            expect(row.cleared_by).toBe(ids.finance)
            expect(row.cleared_reason).toBe("Sent back: Wrong landed cost split")
        }
        const [event] = (await events(ipas.id, "sent_back")).slice(-1)
        expect(event.detail).toMatchObject({ section: 7, reason: "Wrong landed cost split", cleared: ["checked", "noted", "received"] })
        expect(event.actor_id).toBe(ids.finance)

        // Section 7 can be given again from Received.
        await signOk("ipasSigner", ipas.id, 7, "received")
        expect(await liveKeys(ipas.id)).toContain("7/received")
    })

    it("lets a signer from any section 7 list do it, the Approved list included", async () => {
        const ipas = await opened()
        await signOk("ipasSigner", ipas.id, 7, "received")

        const back = await sendBack("hr", ipas.id, 7, "Hold on")
        expect(back.error).toBeNull()
        expect(back.data.cleared_roles).toEqual(["received"])
        expect(back.data.notify_ids).toEqual([ids.ipasSigner])
    })

    it("doesn't tell the person who sent it back about their own sign-off", async () => {
        const ipas = await opened()
        await signOk("ipasSigner", ipas.id, 7, "received")

        const back = await sendBack("ipasSigner", ipas.id, 7, "My mistake")
        expect(back.error).toBeNull()
        expect(back.data.notify_ids).toEqual([])
    })

    it("refuses someone on no section 7 list: the purchaser, a Super Admin off the lists, a stranger", async () => {
        await clearLists()
        await onList("s1_approved", "ipasSigner")
        await onList("s3_approved", "ipasSigner")
        await onList("s7_received", "ipasSigner")
        const ipas = await opened()
        await signOk("ipasSigner", ipas.id, 7, "received")

        for (const who of ["outsider", "superAdmin", "finance", "hr", "ordinary"]) {
            const { error } = await sendBack(who, ipas.id, 7, "No")
            expect(error?.code, who).toBe("42501")
        }
        expect(await liveKeys(ipas.id)).toContain("7/received")
    })

    it("refuses when nothing is live to clear, with a reason missing, or before section 7 is open", async () => {
        const ipas = await opened()
        expect((await sendBack("finance", ipas.id, 7, "Nothing signed")).error?.code).toBe("55000")

        await signOk("ipasSigner", ipas.id, 7, "received")
        expect((await sendBack("finance", ipas.id, 7, "   ")).error?.code).toBe("22023")
        expect((await sendBack("finance", ipas.id, 7, "x".repeat(501))).error?.code).toBe("22023")

        // Sections 1 and 3 not approved: section 7 isn't open.
        const early = await raise()
        await signOk("outsider", early.id, 1, "prepared")
        const refused = await sendBack("finance", early.id, 7, "Too early")
        expect(refused.error?.code).toBe("55000")
        expect(refused.error?.message).toMatch(/isn't open yet/)
    })

    it("refuses a filed or cancelled IPAS", async () => {
        const ipas = await opened()
        await receivedNotedChecked(ipas)
        await file(ipas.id)
        const filedBack = await sendBack("finance", ipas.id, 7, "Too late")
        expect(filedBack.error?.code).toBe("55000")
        expect(await liveKeys(ipas.id)).toEqual(expect.arrayContaining(["7/checked", "7/noted", "7/received"]))

        const cancelled = await raise()
        expect((await rpc("outsider", "ipas_cancel", { p_ipas_id: cancelled.id, p_reason: "Duplicate" })).error).toBeNull()
        expect((await sendBack("finance", cancelled.id, 7, "Gone")).error?.code).toBe("55000")
    })

    it("leaves sections 1 and 3 as they were", async () => {
        const ipas = await opened()
        await signOk("ipasSigner", ipas.id, 7, "received")
        expect((await sendBack("ipasSigner", ipas.id, 1, "Wrong supplier")).data.cleared_roles).toEqual(["approved", "prepared"])
        expect(await liveKeys(ipas.id)).toContain("7/received")
    })
})

describe("the signer-list log", () => {
    // The log can't be emptied, so each test reads only what it added.
    let before = new Set()
    beforeEach(async () => {
        const { data, error } = await svc().from("ipas_signer_list_log").select("id")
        if (error) throw error
        before = new Set(data.map((r) => r.id))
    })
    const logOf = async (listKey) => {
        const { data, error } = await svc().from("ipas_signer_list_log").select("*").eq("list_key", listKey).order("created_at")
        if (error) throw error
        return data.filter((r) => !before.has(r.id))
    }

    it("has row level security on and a policy", async () => {
        const { enabled, policies } = await rlsStatus("ipas_signer_list_log")
        expect(enabled).toBe(true)
        expect(policies).toBeGreaterThan(0)
    })

    it("records who was added and removed, by whom, and nothing for a list left as it was", async () => {
        await clearLists()
        const added = await setList("superAdmin", "s7_noted", [ids.ordinary, ids.support])
        expect(added.error).toBeNull()
        expect(added.data.removed).toEqual([])
        expect([...added.data.added].sort()).toEqual([ids.ordinary, ids.support].sort())

        const unchanged = await setList("superAdmin", "s7_noted", [ids.support, ids.ordinary, ids.support])
        expect(unchanged.error).toBeNull()
        expect(await logOf("s7_noted")).toHaveLength(2)

        const swapped = await setList("superAdmin", "s7_noted", [ids.support, ids.dealOwner])
        expect(swapped.error).toBeNull()
        expect(swapped.data).toMatchObject({ added: [ids.dealOwner], removed: [ids.ordinary] })

        const rows = await logOf("s7_noted")
        expect(rows.map((r) => [r.employee_id, r.action, r.actor_id])).toEqual(
            expect.arrayContaining([
                [ids.ordinary, "added", ids.superAdmin],
                [ids.support, "added", ids.superAdmin],
                [ids.dealOwner, "added", ids.superAdmin],
                [ids.ordinary, "removed", ids.superAdmin],
            ]),
        )
        expect(rows).toHaveLength(4)

        const members = (await svc().from("ipas_signer_lists").select("employee_id").eq("list_key", "s7_noted")).data
        expect(members.map((m) => m.employee_id).sort()).toEqual([ids.support, ids.dealOwner].sort())
    })

    it("takes the whole list at once, empty included", async () => {
        await clearLists()
        expect((await setList("superAdmin", "s7_checked", [ids.ordinary])).error).toBeNull()
        const cleared = await setList("superAdmin", "s7_checked", [])
        expect(cleared.error).toBeNull()
        expect(cleared.data.removed).toEqual([ids.ordinary])
        expect((await svc().from("ipas_signer_lists").select("id").eq("list_key", "s7_checked")).data).toHaveLength(0)
    })

    it("is for Super Admins only, and refuses a bad list, a missing employee and a left employee", async () => {
        await clearLists()
        for (const who of ["outsider", "finance", "hr", "ipasSigner", "ordinary", "head"]) {
            expect((await setList(who, "s7_noted", [ids.ordinary])).error?.code, who).toBe("42501")
        }
        expect((await setList("superAdmin", "s2_approved", [ids.ordinary])).error?.code).toBe("22023")
        expect((await setList("superAdmin", "s7_noted", [crypto.randomUUID()])).error?.code).toBe("P0002")
        expect((await setList("superAdmin", "s7_noted", [ids.deleted])).error?.code).toBe("P0002")
        expect((await svc().from("ipas_signer_lists").select("id").eq("list_key", "s7_noted")).data).toHaveLength(0)
        expect(await logOf("s7_noted")).toHaveLength(0)
    })

    it("leaves a list unchanged when one name is bad", async () => {
        await clearLists()
        expect((await setList("superAdmin", "s7_noted", [ids.ordinary])).error).toBeNull()
        const refused = await setList("superAdmin", "s7_noted", [ids.support, ids.deleted])
        expect(refused.error?.code).toBe("P0002")
        const members = (await svc().from("ipas_signer_lists").select("employee_id").eq("list_key", "s7_noted")).data
        expect(members.map((m) => m.employee_id)).toEqual([ids.ordinary])
        expect(await logOf("s7_noted")).toHaveLength(1)
    })

    it("is readable by a Super Admin only", async () => {
        await clearLists()
        await setList("superAdmin", "s7_checked", [ids.ordinary])
        for (const who of CAST_KEYS) {
            const { data, error } = await (await clientFor(who)).from("ipas_signer_list_log").select("id").eq("list_key", "s7_checked")
            expect(error).toBeNull()
            expect(data.length > 0, who).toBe(who === "superAdmin")
        }
    })

    it("can't be written by a client, or changed by anyone", async () => {
        await clearLists()
        await setList("superAdmin", "s7_checked", [ids.ordinary])
        const [row] = await logOf("s7_checked")

        for (const who of ["superAdmin", "outsider", "finance", "hr"]) {
            const client = await clientFor(who)
            const insert = await tryInsert(client, "ipas_signer_list_log", {
                list_key: "s7_checked", employee_id: ids[who], action: "added", actor_id: ids[who],
            })
            expect(insert.ok, `${who} inserted a log row`).toBe(false)
            expect((await tryUpdate(client, "ipas_signer_list_log", row.id, { action: "removed" })).affected, `${who} updated`).toBe(0)
            expect((await tryDelete(client, "ipas_signer_list_log", row.id)).affected, `${who} deleted`).toBe(0)
        }
        // The service role is held to it too.
        const rewrite = await svc().from("ipas_signer_list_log").update({ action: "removed" }).eq("id", row.id)
        expect(rewrite.error?.code).toBe("42501")
        const remove = await svc().from("ipas_signer_list_log").delete().eq("id", row.id)
        expect(remove.error?.code).toBe("42501")
    })

    it("leaves the lists with no client write path, a Super Admin included", async () => {
        await clearLists()
        const client = await clientFor("superAdmin")
        const insert = await tryInsert(client, "ipas_signer_lists", { list_key: "s7_checked", employee_id: ids.ordinary })
        expect(insert.ok).toBe(false)

        await setList("superAdmin", "s7_checked", [ids.ordinary])
        const [row] = (await svc().from("ipas_signer_lists").select("id").eq("list_key", "s7_checked")).data
        expect((await tryDelete(client, "ipas_signer_lists", row.id)).affected).toBe(0)
        expect((await svc().from("ipas_signer_lists").select("id").eq("list_key", "s7_checked")).data).toHaveLength(1)
    })
})
