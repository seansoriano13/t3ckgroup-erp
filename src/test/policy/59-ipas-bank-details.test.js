/**
 * IPAS bank details and the changed-account flag (#245, spec #241): the
 * database rules.
 *
 * `outsider` holds Purchasing access for the file and is the purchaser;
 * `finance` holds Finance access alone; `ipasSigner` is a plain employee put on
 * sign-off lists by the test that needs it (a list-only member, no flags);
 * `superAdmin` is a Super Admin with neither flag; `ordinary` and `dealOwner`
 * are nobody to the IPAS.
 *
 * Everything runs through the real `ipas_create` and `ipas_set_bank_details`.
 * `ipas_bank_details` has no `id` column (the IPAS id is its key), so the read
 * and write probes below are written for it rather than reusing support/access.js.
 *
 * The approval reset runs against the real `ipas_signoffs` (#247).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql, rlsStatus } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"
import { RLS_VIOLATION } from "./support/access.js"

const svc = () => serviceClient()

let poSeq = 0
/** A PO number nothing else in the tier uses. */
const nextPo = () => `P9${String(90000 + (poSeq += 1)).padStart(6, "0")}`

let supplierSeq = 0
/** An Odoo partner id nothing else in the tier uses, so each scenario owns its supplier. */
const nextSupplier = () => 9_100_000 + (supplierSeq += 1)

const copyFor = (po, supplierId) => ({
    po: { id: 880000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: supplierId === null ? { name: "Supplier without an id", contact: null } : { id: supplierId, name: "Scorpe Technologies", contact: null },
    lines: [
        { line_id: 900001 + poSeq * 10, product_id: 5350, name: "Cutter", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

/** Raises an IPAS for the given supplier as the purchaser. */
async function raise(supplierId) {
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

const bankArgs = (ipasId, over = {}) => ({
    p_ipas_id: ipasId,
    p_bank_name: "BDO",
    p_account_name: "Scorpe Technologies Inc.",
    p_account_number: "0012 3456 7890",
    ...over,
})

const setBank = (who, ipasId, over) => rpc(who, "ipas_set_bank_details", bankArgs(ipasId, over))

/** Types bank details as the purchaser, failing the test loudly if it can't. */
async function typeBank(ipasId, accountNumber, over = {}) {
    const { data, error } = await setBank("outsider", ipasId, { p_account_number: accountNumber, ...over })
    if (error) throw new Error(`ipas_set_bank_details: ${error.message}`)
    return data
}

async function bankRow(ipasId) {
    const { data, error } = await svc().from("ipas_bank_details").select("*").eq("ipas_id", ipasId).maybeSingle()
    if (error) throw error
    return data
}

async function events(ipasId, ...kinds) {
    let query = svc().from("ipas_events").select("*").eq("ipas_id", ipasId).order("created_at")
    if (kinds.length) query = query.in("kind", kinds)
    const { data, error } = await query
    if (error) throw error
    return data
}

/** Whether `who` sees the IPAS's bank-details row at all. */
async function readsBank(who, ipasId) {
    const { data, error } = await (await clientFor(who)).from("ipas_bank_details").select("ipas_id, account_number").eq("ipas_id", ipasId)
    if (error) throw new Error(`Reading bank details as ${who}: ${error.message}`)
    return data.length > 0
}

const file = (id) => sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [id])

const addToList = async (listKey, who = "ipasSigner") => {
    const { error } = await svc().from("ipas_signer_lists").insert({ list_key: listKey, employee_id: ids[who] })
    if (error) throw error
}
const clearLists = (who = "ipasSigner") => svc().from("ipas_signer_lists").delete().eq("employee_id", ids[who])

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    await clearLists()

})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await clearLists()
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("the new table is protected", () => {
    it("has row level security on and a policy", async () => {
        const { enabled, policies } = await rlsStatus("ipas_bank_details")
        expect(enabled, "ipas_bank_details has RLS switched off").toBe(true)
        expect(policies, "ipas_bank_details has no policy").toBeGreaterThan(0)
    })

    it("has only a read policy: every write goes through ipas_set_bank_details", async () => {
        const { rows } = await sql().query(
            `select cmd from pg_policies where schemaname = 'public' and tablename = 'ipas_bank_details'`,
        )
        expect(rows.map((r) => r.cmd)).toEqual(["SELECT"])
    })
})

describe("who reads bank details", () => {
    const READERS = ["outsider", "finance", "superAdmin"]

    it("reads them: Purchasing, Finance and Super Admin, and refuses everyone else in the cast", async () => {
        const ipas = await raise(nextSupplier())
        await typeBank(ipas.id, "0012 3456 7890")

        for (const who of READERS) {
            expect(await readsBank(who, ipas.id), `${who} was refused`).toBe(true)
        }
        for (const who of CAST_KEYS.filter((k) => !READERS.includes(k))) {
            expect(await readsBank(who, ipas.id), `${who} read bank details`).toBe(false)
        }
    })

    it("answers ipas_can_read_bank_details the same way", async () => {
        for (const who of CAST_KEYS) {
            const { data, error } = await rpc(who, "ipas_can_read_bank_details")
            expect(error, `${who}: ${error?.message}`).toBeNull()
            expect(data, `${who}`).toBe(READERS.includes(who))
        }
    })

    it("lets a section 1 approver with no flags read them", async () => {
        const ipas = await raise(nextSupplier())
        await typeBank(ipas.id, "0012 3456 7890")
        await addToList("s1_approved")
        try {
            expect(await readsBank("ipasSigner", ipas.id)).toBe(true)
            const { data } = await rpc("ipasSigner", "ipas_can_read_bank_details")
            expect(data).toBe(true)
            const read = await (await clientFor("ipasSigner")).from("ipas_bank_details").select("*").eq("ipas_id", ipas.id).single()
            expect(read.data).toMatchObject({ bank_name: "BDO", account_number: "0012 3456 7890", account_flagged: false })
        } finally {
            await clearLists()
        }
    })

    it("lets a section 3 approver with no flags read them", async () => {
        const ipas = await raise(nextSupplier())
        await typeBank(ipas.id, "0012 3456 7890")
        await addToList("s3_approved")
        try {
            expect(await readsBank("ipasSigner", ipas.id)).toBe(true)
        } finally {
            await clearLists()
        }
    })

    it.each(["s7_received", "s7_noted", "s7_checked", "s7_approved"])(
        "refuses a section 7 signer with no flags (%s): they read the IPAS and get no bank details",
        async (listKey) => {
            const ipas = await raise(nextSupplier())
            await typeBank(ipas.id, "0012 3456 7890")
            await addToList(listKey)
            try {
                // The IPAS itself reads: list membership makes them a full reader...
                const own = await (await clientFor("ipasSigner")).from("ipas").select("id").eq("id", ipas.id)
                expect(own.error).toBeNull()
                expect(own.data).toHaveLength(1)
                // ...but the bank details are refused by the database.
                expect(await readsBank("ipasSigner", ipas.id), "a section 7 signer read bank details").toBe(false)
                const { data } = await rpc("ipasSigner", "ipas_can_read_bank_details")
                expect(data).toBe(false)
            } finally {
                await clearLists()
            }
        },
    )

    it("refuses a section 7 Noted signer who is also on no section 1 or 3 list, but reads once added to one", async () => {
        const ipas = await raise(nextSupplier())
        await typeBank(ipas.id, "0012 3456 7890")
        await addToList("s7_noted")
        try {
            expect(await readsBank("ipasSigner", ipas.id)).toBe(false)
            await addToList("s3_approved")
            expect(await readsBank("ipasSigner", ipas.id)).toBe(true)
        } finally {
            await clearLists()
        }
    })

    it("refuses a soft-deleted member of an approval list", async () => {
        const ipas = await raise(nextSupplier())
        await typeBank(ipas.id, "0012 3456 7890")
        await addToList("s1_approved", "deleted")
        try {
            expect(await readsBank("deleted", ipas.id)).toBe(false)
        } finally {
            await clearLists("deleted")
        }
    })
})

describe("who writes bank details", () => {
    it("lets Purchasing type and change them", async () => {
        const ipas = await raise(nextSupplier())

        const first = await setBank("outsider", ipas.id)
        expect(first.error).toBeNull()
        expect(first.data.bank_details).toMatchObject({ bank_name: "BDO", account_name: "Scorpe Technologies Inc.", account_number: "0012 3456 7890" })

        const second = await setBank("outsider", ipas.id, { p_bank_name: "BPI" })
        expect(second.error).toBeNull()
        expect((await bankRow(ipas.id)).bank_name).toBe("BPI")
    })

    it("refuses Finance, who reads them but can't type them, and stores nothing", async () => {
        const ipas = await raise(nextSupplier())
        await typeBank(ipas.id, "0012 3456 7890")

        const { error } = await setBank("finance", ipas.id, { p_account_number: "9999" })

        expect(error?.code).toBe("42501")
        expect(error?.message).toMatch(/only Purchasing/)
        expect((await bankRow(ipas.id)).account_number).toBe("0012 3456 7890")

        // The same refusal on a first write.
        const bare = await raise(nextSupplier())
        const refused = await setBank("finance", bare.id)
        expect(refused.error?.code).toBe("42501")
        expect(await bankRow(bare.id)).toBeNull()
    })

    it("refuses everyone else in the cast: Super Admin without Purchasing access, a list member, and plain employees", async () => {
        const ipas = await raise(nextSupplier())
        await addToList("s1_approved")
        try {
            for (const who of CAST_KEYS.filter((k) => k !== "outsider")) {
                const { error } = await setBank(who, ipas.id)
                expect(error?.code, `${who} typed bank details`).toBe("42501")
            }
        } finally {
            await clearLists()
        }
        expect(await bankRow(ipas.id)).toBeNull()
    })

    it("refuses a direct insert, update or delete on the table, for everyone including Purchasing", async () => {
        const ipas = await raise(nextSupplier())
        await typeBank(ipas.id, "0012 3456 7890")
        const spare = await raise(nextSupplier())

        for (const who of CAST_KEYS) {
            const client = await clientFor(who)

            const inserted = await client.from("ipas_bank_details").insert({ ipas_id: spare.id, account_number: "1", account_flagged: false }).select()
            expect(inserted.error?.code, `${who} inserted a row`).toBe(RLS_VIOLATION)

            const updated = await client.from("ipas_bank_details").update({ account_number: "2", account_flagged: false }).eq("ipas_id", ipas.id).select()
            expect(updated.data ?? [], `${who} updated a row`).toEqual([])

            const deleted = await client.from("ipas_bank_details").delete().eq("ipas_id", ipas.id).select()
            expect(deleted.data ?? [], `${who} deleted a row`).toEqual([])
        }

        expect(await bankRow(spare.id)).toBeNull()
        expect((await bankRow(ipas.id)).account_number).toBe("0012 3456 7890")
    })

    it("can't set the flag by hand: a client can't write account_flagged", async () => {
        const ipas = await raise(nextSupplier())
        await typeBank(ipas.id, "0012 3456 7890")

        const { data } = await (await clientFor("outsider")).from("ipas_bank_details").update({ account_flagged: true }).eq("ipas_id", ipas.id).select()

        expect(data ?? []).toEqual([])
        expect((await bankRow(ipas.id)).account_flagged).toBe(false)
    })

    it("refuses a filed IPAS, a cancelled one and an unknown one", async () => {
        const filed = await raise(nextSupplier())
        await file(filed.id)
        const cancelled = await raise(nextSupplier())
        await rpc("outsider", "ipas_cancel", { p_ipas_id: cancelled.id, p_reason: "Wrong PO" })

        expect((await setBank("outsider", filed.id)).error?.code).toBe("22023")
        expect((await setBank("outsider", cancelled.id)).error?.code).toBe("22023")
        expect((await setBank("outsider", "00000000-0000-0000-0000-000000000000")).error?.code).toBe("22023")
        expect(await bankRow(filed.id)).toBeNull()
        expect(await bankRow(cancelled.id)).toBeNull()
    })

    it("refuses an over-long value with a sentence", async () => {
        const ipas = await raise(nextSupplier())

        const { error } = await setBank("outsider", ipas.id, { p_account_number: "9".repeat(101) })

        expect(error?.code).toBe("22023")
        expect(await bankRow(ipas.id)).toBeNull()
    })

    it("treats blanks as nothing typed", async () => {
        const ipas = await raise(nextSupplier())

        const { data, error } = await setBank("outsider", ipas.id, { p_bank_name: "  BPI ", p_account_name: "   ", p_account_number: "" })

        expect(error).toBeNull()
        expect(data.bank_details).toMatchObject({ bank_name: "BPI", account_name: null, account_number: null, account_flagged: false })
    })
})

describe("the changed-account flag", () => {
    it("never flags a supplier's first IPAS", async () => {
        const ipas = await raise(nextSupplier())

        const out = await typeBank(ipas.id, "0012 3456 7890")

        expect(out.flagged).toBe(false)
        expect((await bankRow(ipas.id)).account_flagged).toBe(false)
        expect(await events(ipas.id, "account_flagged")).toEqual([])
    })

    it("flags an Account # that differs from the same supplier's previous IPAS, and records an event", async () => {
        const supplier = nextSupplier()
        const first = await raise(supplier)
        await typeBank(first.id, "0012 3456 7890")
        const second = await raise(supplier)

        const out = await typeBank(second.id, "9999 8888 7777")

        expect(out).toMatchObject({ flagged: true, account_changed: true })
        expect((await bankRow(second.id)).account_flagged).toBe(true)
        expect((await bankRow(first.id)).account_flagged).toBe(false)

        const flagged = await events(second.id, "account_flagged")
        expect(flagged).toHaveLength(1)
        expect(flagged[0].detail).toMatchObject({ previous_ipas_id: first.id, previous_number: first.number })
        expect(flagged[0].actor_id).toBe(ids.outsider)
    })

    it.each([
        ["spaces", "0012345 67890"],
        ["dashes", "0012-3456-7890"],
        ["spaces and dashes together", " 0012 - 3456-7890 "],
        ["no separators at all", "00123456 7890"],
    ])("does not flag the same number with different %s", async (_, typed) => {
        const supplier = nextSupplier()
        const first = await raise(supplier)
        await typeBank(first.id, "0012 3456 7890")
        const second = await raise(supplier)

        const out = await typeBank(second.id, typed)

        expect(out.flagged).toBe(false)
        expect((await bankRow(second.id)).account_flagged).toBe(false)
        expect(await events(second.id, "account_flagged")).toEqual([])
    })

    it("flags a number that differs in a digit, not only in spacing", async () => {
        const supplier = nextSupplier()
        const first = await raise(supplier)
        await typeBank(first.id, "0012 3456 7890")
        const second = await raise(supplier)

        expect((await typeBank(second.id, "0012-3456-7891")).flagged).toBe(true)
    })

    it("compares only the same Odoo supplier", async () => {
        const other = await raise(nextSupplier())
        await typeBank(other.id, "1111")
        const mine = await raise(nextSupplier())

        expect((await typeBank(mine.id, "2222")).flagged).toBe(false)
    })

    it("compares with the most recent other IPAS, not an older one", async () => {
        const supplier = nextSupplier()
        const oldest = await raise(supplier)
        await typeBank(oldest.id, "1111")
        const newer = await raise(supplier)
        expect((await typeBank(newer.id, "2222")).flagged).toBe(true)

        const newest = await raise(supplier)
        expect((await typeBank(newest.id, "2222")).flagged).toBe(false)
    })

    it("skips a cancelled IPAS, so a rejected account can't become the last known good one", async () => {
        const supplier = nextSupplier()
        const trusted = await raise(supplier)
        await typeBank(trusted.id, "1111")
        const rejected = await raise(supplier)
        await typeBank(rejected.id, "6666")
        await rpc("outsider", "ipas_cancel", { p_ipas_id: rejected.id, p_reason: "Wrong account" })
        const next = await raise(supplier)

        expect((await typeBank(next.id, "6666")).flagged).toBe(true)
    })

    it("skips an IPAS with no Account # typed", async () => {
        const supplier = nextSupplier()
        const trusted = await raise(supplier)
        await typeBank(trusted.id, "1111")
        const blank = await raise(supplier)
        await typeBank(blank.id, null, { p_bank_name: "BDO" })
        const next = await raise(supplier)

        expect((await typeBank(next.id, "2222")).flagged).toBe(true)
    })

    it("flags nothing when the supplier has no Odoo partner id to match on", async () => {
        const first = await raise(null)
        await typeBank(first.id, "1111")
        const second = await raise(null)

        expect((await typeBank(second.id, "2222")).flagged).toBe(false)
    })

    it("does the cross-IPAS comparison as security definer, so it never depends on the caller reading the other IPAS", async () => {
        const { rows } = await sql().query(
            `select prosecdef from pg_proc where proname = 'ipas_set_bank_details' and pronamespace = 'public'::regnamespace`,
        )
        expect(rows[0].prosecdef).toBe(true)

        const supplier = nextSupplier()
        const first = await raise(supplier)
        await typeBank(first.id, "1111")
        const second = await raise(supplier)

        expect((await typeBank(second.id, "2222")).flagged).toBe(true)
    })

    it("lowers the flag when the number is corrected back", async () => {
        const supplier = nextSupplier()
        const first = await raise(supplier)
        await typeBank(first.id, "1111")
        const second = await raise(supplier)
        await typeBank(second.id, "9999")
        expect((await bankRow(second.id)).account_flagged).toBe(true)

        const out = await typeBank(second.id, "1111")

        expect(out.flagged).toBe(false)
        expect((await bankRow(second.id)).account_flagged).toBe(false)
        const changed = await events(second.id, "bank_details_changed")
        expect(changed.at(-1).detail).toMatchObject({ flagged: false, was_flagged: true })
    })

    it("stays flagged when only the bank name changes, and records that change without a second flag event", async () => {
        const supplier = nextSupplier()
        const first = await raise(supplier)
        await typeBank(first.id, "1111")
        const second = await raise(supplier)
        await typeBank(second.id, "9999")

        const out = await typeBank(second.id, "9999", { p_bank_name: "BPI" })

        expect(out).toMatchObject({ flagged: true, account_changed: false })
        expect((await bankRow(second.id)).account_flagged).toBe(true)
        expect(await events(second.id, "account_flagged")).toHaveLength(1)
    })

    it("records nothing when nothing changed", async () => {
        const ipas = await raise(nextSupplier())
        await typeBank(ipas.id, "1111")
        const before = (await events(ipas.id)).length

        await typeBank(ipas.id, "1111")

        expect(await events(ipas.id)).toHaveLength(before)
    })
})

describe("when the account is flagged", () => {
    const insertSignoff = (ipasId, section, role, signedBy) =>
        sql().query(
            `insert into public.ipas_signoffs (ipas_id, section, role, signed_by) values ($1, $2, $3, $4)`,
            [ipasId, section, role, signedBy],
        )

    const signoffs = async (ipasId) =>
        (
            await sql().query(
                `select section, role, cleared_at, cleared_reason from public.ipas_signoffs
                  where ipas_id = $1 order by section, role, signed_at`,
                [ipasId],
            )
        ).rows

    it("clears the live section 2 (stored 3) approval only with 'Account # flagged', and names who prepared it", async () => {
        const supplier = nextSupplier()
        const first = await raise(supplier)
        await typeBank(first.id, "1111")
        const second = await raise(supplier)
        await insertSignoff(second.id, 1, "prepared", ids.outsider)
        await insertSignoff(second.id, 1, "approved", ids.ipasSigner)
        await insertSignoff(second.id, 3, "prepared", ids.finance)
        await insertSignoff(second.id, 3, "approved", ids.ipasSigner)
        await insertSignoff(second.id, 7, "received", ids.ipasSigner)

        const out = await typeBank(second.id, "9999")

        expect(out.flagged).toBe(true)
        expect(out.approvals_cleared).toEqual([3])
        expect(out.preparer_ids).toEqual([ids.finance])

        const rows = await signoffs(second.id)
        const cleared = rows.filter((r) => r.cleared_at)
        expect(cleared.map((r) => [r.section, r.role])).toEqual([[3, "approved"]])
        expect(cleared.every((r) => r.cleared_reason === "Account # flagged")).toBe(true)
        // Prepared stays, and section 7 isn't undone by an account change.
        expect(rows.filter((r) => r.role === "prepared").every((r) => !r.cleared_at)).toBe(true)
        expect(rows.find((r) => r.section === 7).cleared_at).toBeNull()

        const cleared_ev = await events(second.id, "approvals_cleared")
        expect(cleared_ev).toHaveLength(1)
        expect(cleared_ev[0].detail).toMatchObject({ reason: "Account # flagged", sections: [3] })
    })

    it("clears nothing when the account isn't flagged", async () => {
        const supplier = nextSupplier()
        const first = await raise(supplier)
        await typeBank(first.id, "1111")
        const second = await raise(supplier)
        await insertSignoff(second.id, 1, "prepared", ids.outsider)
        await insertSignoff(second.id, 1, "approved", ids.ipasSigner)

        const out = await typeBank(second.id, "1-1 11")

        expect(out.flagged).toBe(false)
        expect(out.approvals_cleared).toEqual([])
        expect((await signoffs(second.id)).every((r) => !r.cleared_at)).toBe(true)
    })

    it("clears nothing, and names no one, when nothing had been approved", async () => {
        const supplier = nextSupplier()
        const first = await raise(supplier)
        await typeBank(first.id, "1111")
        const second = await raise(supplier)
        await insertSignoff(second.id, 1, "prepared", ids.outsider)

        const out = await typeBank(second.id, "9999")

        expect(out).toMatchObject({ flagged: true, approvals_cleared: [], preparer_ids: [] })
        expect(await events(second.id, "approvals_cleared")).toEqual([])
    })

    it("leaves approvals alone when only the bank name changes on a flagged IPAS", async () => {
        const supplier = nextSupplier()
        const first = await raise(supplier)
        await typeBank(first.id, "1111")
        const second = await raise(supplier)
        await typeBank(second.id, "9999")
        await insertSignoff(second.id, 1, "prepared", ids.outsider)
        await insertSignoff(second.id, 1, "approved", ids.ipasSigner)

        await typeBank(second.id, "9999", { p_bank_name: "BPI" })

        expect((await signoffs(second.id)).every((r) => !r.cleared_at)).toBe(true)
    })
})

describe("keeping the account number out of the open", () => {
    it("never writes bank details to ipas_events, only which fields changed", async () => {
        const supplier = nextSupplier()
        const first = await raise(supplier)
        await typeBank(first.id, "5550001111", { p_account_name: "Earlier Holder" })
        const second = await raise(supplier)
        await typeBank(second.id, "7770002222", { p_bank_name: "Secret Bank", p_account_name: "Secret Holder" })
        await typeBank(second.id, "7770003333", { p_bank_name: "Secret Bank", p_account_name: "Secret Holder" })

        for (const ipas of [first, second]) {
            const everything = JSON.stringify(await events(ipas.id))
            for (const secret of ["5550001111", "7770002222", "7770003333", "Secret Bank", "Secret Holder", "Earlier Holder"]) {
                expect(everything, `${secret} reached the history`).not.toContain(secret)
            }
        }

        const set = await events(second.id, "bank_details_set")
        expect(set[0].detail).toMatchObject({ fields: ["bank_name", "account_name", "account_number"], flagged: true })
    })

    it("lets a section 7 signer read the history, which says what changed but not to what", async () => {
        const supplier = nextSupplier()
        const first = await raise(supplier)
        await typeBank(first.id, "5550001111")
        const second = await raise(supplier)
        await typeBank(second.id, "7770002222")
        await addToList("s7_noted")
        try {
            const read = await (await clientFor("ipasSigner")).from("ipas_events").select("*").eq("ipas_id", second.id)
            expect(read.error).toBeNull()
            expect(read.data.map((e) => e.kind)).toEqual(expect.arrayContaining(["bank_details_set", "account_flagged"]))
            expect(JSON.stringify(read.data)).not.toContain("7770002222")
            expect(JSON.stringify(read.data)).not.toContain("5550001111")
        } finally {
            await clearLists()
        }
    })
})
