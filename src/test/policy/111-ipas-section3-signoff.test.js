/**
 * Section 3 is a sign-off (#586, spec #584): the database rules.
 *
 * Section 3 (Computation status & Landed Cost) is stored as sign-off section 6 and shown as
 * section 3. It has Submitted ("prepared") and Approved, approved by the `s6_approved` list.
 * It replaces the "Checked by" Computation status step, so the status ends at LC Odoo Done.
 *
 *   - Submit needs Purchasing access and is refused until LC Odoo Done (22023)
 *   - Approve needs list membership, never the submitter, a Super Admin only if listed (42501)
 *   - the status can no longer be set past LC Odoo Done, and Finance no longer sets it
 *   - the list is seeded from Finance access and managed through ipas_set_signer_list
 *   - the migration's conversion turns an old Checked by into a section 3 approval, with the
 *     right person and time, and leaves a filed IPAS filed and frozen
 *
 * `outsider` holds Purchasing access for the file; `finance` is Finance only; `ipasSigner` is a
 * plain employee the tests put on lists; `superAdmin` is a Super Admin on no list until added.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const copyFor = (po) => ({
    po: { id: 830000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_700_000 + poSeq, name: "Section Three Supplier", contact: null },
    lines: [{ line_id: 840000 + poSeq * 10, product_id: 7500, name: "Item 1", quantity: 2, unit: "Unit", price_unit: 100, price_subtotal: 200, taxes: [], analytic: [], brand: null }],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise() {
    const po = `P9${String(90000 + (poSeq += 1)).padStart(6, "0")}`
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
const setStatus = (who, ipasId, status) =>
    rpc(who, "ipas_set_header", { p_ipas_id: ipasId, p_fields: { computation_status: status } })
const statusOf = async (ipasId) => (await svc().from("ipas").select("computation_status").eq("id", ipasId).single()).data.computation_status
const liveS6 = async (ipasId) =>
    (await svc().from("ipas_signoffs").select("*").eq("ipas_id", ipasId).eq("section", 6).is("cleared_at", null)).data
const onList = async (listKey, who) => {
    const { error } = await svc().from("ipas_signer_lists").insert({ list_key: listKey, employee_id: ids[who] })
    if (error) throw error
}
const CAST_IDS = () => CAST_KEYS.map((k) => ids[k])
const clearLists = async () => {
    const { error } = await svc().from("ipas_signer_lists").delete().in("employee_id", CAST_IDS())
    if (error) throw error
}

/** A raised IPAS at LC Odoo Done, ready for section 3 to be submitted. */
async function costed() {
    const ipas = await raise()
    expect((await setStatus("outsider", ipas.id, "lc_odoo_done")).error).toBeNull()
    return ipas
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

beforeEach(async () => {
    await clearLists()
})

afterAll(async () => {
    await clearLists()
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", CAST_IDS())
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("Submit section 3", () => {
    it("is refused before LC Odoo Done, and works at it", async () => {
        const ipas = await raise()
        for (const status of ["encoding", "encoded", "lc_gs_done"]) {
            expect((await setStatus("outsider", ipas.id, status)).error, status).toBeNull()
            const refused = await sign("outsider", ipas.id, 6, "prepared")
            expect(refused.error?.code, status).toBe("22023")
            expect(refused.error?.message).toMatch(/section 3 can be submitted once the Computation status is LC Odoo Done/)
        }
        expect(await liveS6(ipas.id)).toEqual([])

        expect((await setStatus("outsider", ipas.id, "lc_odoo_done")).error).toBeNull()
        const { data, error } = await sign("outsider", ipas.id, 6, "prepared")
        expect(error).toBeNull()
        expect(data).toMatchObject({ section: 6, role: "prepared", stage: "section_prepared" })
        expect((await liveS6(ipas.id)).map((r) => r.role)).toEqual(["prepared"])
    })

    it("needs Purchasing access", async () => {
        await onList("s6_approved", "ipasSigner")
        const ipas = await costed()
        for (const who of ["finance", "ipasSigner", "ordinary"]) {
            expect((await sign(who, ipas.id, 6, "prepared")).error?.code, who).toBe("42501")
        }
    })

    it("tells the section 3 list, not the submitter", async () => {
        await onList("s6_approved", "ipasSigner")
        await onList("s6_approved", "outsider")
        const ipas = await costed()
        const { data } = await sign("outsider", ipas.id, 6, "prepared")
        // Everyone on the list, whoever else the seed put there, and not the submitter.
        expect(data.notify_ids).toContain(ids.ipasSigner)
        expect(data.notify_ids).not.toContain(ids.outsider)
    })

    it("has no other sign-off on section 3", async () => {
        const ipas = await costed()
        const { error } = await sign("outsider", ipas.id, 6, "received")
        expect(error?.code).toBe("22023")
        expect(error?.message).toMatch(/section 3 has no received sign-off/)
    })
})

describe("Approve section 3", () => {
    it("works for a list member once it is submitted, and not before", async () => {
        await onList("s6_approved", "ipasSigner")
        const ipas = await costed()
        expect((await sign("ipasSigner", ipas.id, 6, "approved")).error?.code).toBe("22023")
        expect((await sign("outsider", ipas.id, 6, "prepared")).error).toBeNull()
        const { data, error } = await sign("ipasSigner", ipas.id, 6, "approved")
        expect(error).toBeNull()
        expect(data).toMatchObject({ section: 6, role: "approved" })
        expect((await liveS6(ipas.id)).map((r) => r.role).sort()).toEqual(["approved", "prepared"])
    })

    it("is refused for someone off the list, and for the submitter even when on it", async () => {
        const ipas = await costed()
        expect((await sign("outsider", ipas.id, 6, "prepared")).error).toBeNull()
        expect((await sign("finance", ipas.id, 6, "approved")).error?.code).toBe("42501")

        await onList("s6_approved", "outsider")
        const own = await sign("outsider", ipas.id, 6, "approved")
        expect(own.error?.code).toBe("42501")
        expect(own.error?.message).toMatch(/you prepared section 3/)
    })

    it("is refused for a Super Admin off the list, and allowed once they are on it", async () => {
        const ipas = await costed()
        expect((await sign("outsider", ipas.id, 6, "prepared")).error).toBeNull()
        expect((await sign("superAdmin", ipas.id, 6, "approved")).error?.code).toBe("42501")

        const added = await rpc("superAdmin", "ipas_set_signer_list", { p_list_key: "s6_approved", p_employee_ids: [ids.superAdmin] })
        expect(added.error).toBeNull()
        expect((await sign("superAdmin", ipas.id, 6, "approved")).error).toBeNull()
    })
})

describe("the section 3 approval list", () => {
    it("is managed by a Super Admin through ipas_set_signer_list, with a change-log row", async () => {
        const { data, error } = await rpc("superAdmin", "ipas_set_signer_list", {
            p_list_key: "s6_approved",
            p_employee_ids: [ids.finance, ids.ipasSigner],
        })
        expect(error).toBeNull()
        expect(data.added.sort()).toEqual([ids.finance, ids.ipasSigner].sort())
        const log = await svc().from("ipas_signer_list_log").select("*").eq("list_key", "s6_approved").eq("actor_id", ids.superAdmin)
        expect(log.data.map((r) => r.action)).toContain("added")

        expect((await rpc("outsider", "ipas_set_signer_list", { p_list_key: "s6_approved", p_employee_ids: [] })).error?.code).toBe("42501")
    })

    it("is seeded with everyone who has Finance access", async () => {
        await sql().query(`select public._ipas_seed_s6_approved()`)
        const { data } = await svc().from("ipas_signer_lists").select("employee_id").eq("list_key", "s6_approved")
        const members = data.map((r) => r.employee_id)
        expect(members).toContain(ids.finance)
        expect(members).not.toContain(ids.ordinary)
        expect(members).not.toContain(ids.ipasSigner)

        const { rows } = await sql().query(
            `select e.id from public.employees e
              where e.has_finance_flow and not coalesce(e.is_deleted, false)
                and not exists (select 1 from public.ipas_signer_lists l where l.list_key = 's6_approved' and l.employee_id = e.id)`,
        )
        expect(rows).toEqual([])
        // Re-running adds nobody twice.
        const again = await sql().query(`select public._ipas_seed_s6_approved() as added`)
        expect(again.rows[0].added).toBe(0)
    })

    it("lets whoever is on it read IPAS", async () => {
        await onList("s6_approved", "ipasSigner")
        const ipas = await raise()
        const { data, error } = await (await clientFor("ipasSigner")).from("ipas").select("id").eq("id", ipas.id)
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
    })
})

describe("the Computation status ends at LC Odoo Done", () => {
    it("is refused Checked by, by Purchasing and by the table", async () => {
        const ipas = await costed()
        const refused = await setStatus("outsider", ipas.id, "checked")
        expect(refused.error?.code).toBe("22023")
        expect(refused.error?.message).toMatch(/Encoding, Encoded, LC GS Done or LC Odoo Done/)
        expect(await statusOf(ipas.id)).toBe("lc_odoo_done")

        await expect(sql().query(`update public.ipas set computation_status = 'checked' where id = $1`, [ipas.id])).rejects.toMatchObject({
            code: "23514",
        })
    })

    it("is no longer Finance's or a Super Admin's to set", async () => {
        await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.superAdmin)
        const ipas = await costed()
        for (const who of ["finance", "superAdmin", "ordinary"]) {
            expect((await setStatus(who, ipas.id, "lc_gs_done")).error?.code, who).toBe("42501")
        }
        expect(await statusOf(ipas.id)).toBe("lc_odoo_done")
    })

    it("lets Purchasing walk it up to LC Odoo Done and back", async () => {
        const ipas = await raise()
        for (const status of ["encoded", "lc_gs_done", "lc_odoo_done", "lc_gs_done"]) {
            expect((await setStatus("outsider", ipas.id, status)).error, status).toBeNull()
        }
    })
})

describe("converting an old Checked by", () => {
    const T_SUBMITTED = "2026-09-01T02:00:00.000Z"
    const T_CHECKED = "2026-09-03T08:30:00.000Z"

    /** Puts an IPAS back at the old "checked" status, as it stood before this change, with its header history. */
    async function oldChecked(ipasId, { state = null, history = true } = {}) {
        const client = await sql().connect()
        try {
            await client.query("begin")
            await client.query(`alter table public.ipas drop constraint ipas_computation_status_chk`)
            await client.query(`select set_config('ipas.reopening', 'on', true)`)
            await client.query(
                `update public.ipas set computation_status = 'checked',
                        state = coalesce($2, state),
                        filed_at = case when $2 = 'filed' then now() else filed_at end
                  where id = $1`,
                [ipasId, state],
            )
            if (history) {
                await client.query(
                    `insert into public.ipas_events (ipas_id, actor_id, kind, detail, created_at) values
                      ($1, $2, 'header_changed', '{"fields":{"computation_status":{"from":"lc_gs_done","to":"lc_odoo_done"}}}', $4),
                      ($1, $3, 'header_changed', '{"fields":{"computation_status":{"from":"lc_odoo_done","to":"checked"}}}', $5)`,
                    [ipasId, ids.outsider, ids.finance, T_SUBMITTED, T_CHECKED],
                )
            }
            await client.query("commit")
        } catch (error) {
            await client.query("rollback")
            throw error
        } finally {
            client.release()
        }
    }

    /** Runs the migration's conversion, then puts the status check back the way the migration leaves it. */
    async function convert() {
        const client = await sql().connect()
        try {
            const { rows } = await client.query(`select public._ipas_convert_checked_by() as moved`)
            await client.query(`alter table public.ipas drop constraint if exists ipas_computation_status_chk`)
            await client.query(
                `alter table public.ipas add constraint ipas_computation_status_chk check (computation_status in ('encoding', 'encoded', 'lc_gs_done', 'lc_odoo_done'))`,
            )
            return rows[0].moved
        } finally {
            client.release()
        }
    }

    it("writes a section 3 Submitted and Approved by the right people at the right times", async () => {
        const ipas = await raise()
        await oldChecked(ipas.id)
        expect(await convert()).toBeGreaterThanOrEqual(1)

        expect(await statusOf(ipas.id)).toBe("lc_odoo_done")
        const rows = await liveS6(ipas.id)
        const by = Object.fromEntries(rows.map((r) => [r.role, r]))
        expect(by.prepared.signed_by).toBe(ids.outsider)
        expect(new Date(by.prepared.signed_at).toISOString()).toBe(T_SUBMITTED)
        expect(by.approved.signed_by).toBe(ids.finance)
        expect(new Date(by.approved.signed_at).toISOString()).toBe(T_CHECKED)

        const events = await svc().from("ipas_events").select("*").eq("ipas_id", ipas.id).eq("kind", "signed")
        expect(events.data).toHaveLength(2)
        expect(events.data.every((e) => e.detail.section === 6 && e.detail.migrated === true)).toBe(true)
        const approvedEvent = events.data.find((e) => e.detail.role === "approved")
        expect(new Date(approvedEvent.created_at).toISOString()).toBe(T_CHECKED)
        expect(approvedEvent.actor_id).toBe(ids.finance)
    })

    it("leaves a filed IPAS filed, readable and frozen", async () => {
        const ipas = await raise()
        await oldChecked(ipas.id, { state: "filed" })
        await convert()

        const row = (await svc().from("ipas").select("state, computation_status, filed_at").eq("id", ipas.id).single()).data
        expect(row.state).toBe("filed")
        expect(row.computation_status).toBe("lc_odoo_done")
        expect(row.filed_at).not.toBeNull()
        expect((await liveS6(ipas.id)).map((r) => r.role).sort()).toEqual(["approved", "prepared"])

        // Still frozen: an ordinary update is refused, and so is the front door.
        await expect(sql().query(`update public.ipas set remarks = 'edited' where id = $1`, [ipas.id])).rejects.toBeTruthy()
        expect((await setStatus("outsider", ipas.id, "lc_gs_done")).error?.code).toBe("22023")
        expect(await statusOf(ipas.id)).toBe("lc_odoo_done")
    })

    it("moves the status but signs nothing when there is no history, and again when run twice", async () => {
        const ipas = await raise()
        await oldChecked(ipas.id, { history: false })
        await convert()
        expect(await statusOf(ipas.id)).toBe("lc_odoo_done")
        expect(await liveS6(ipas.id)).toEqual([])
        await convert()
        expect(await liveS6(ipas.id)).toEqual([])
    })

    it("does not sign a cancelled IPAS, but still moves its status off Checked by", async () => {
        const ipas = await raise()
        expect((await rpc("outsider", "ipas_cancel", { p_ipas_id: ipas.id, p_reason: "Raised in error" })).error).toBeNull()
        await oldChecked(ipas.id)
        await convert()
        expect(await statusOf(ipas.id)).toBe("lc_odoo_done")
        expect(await liveS6(ipas.id)).toEqual([])
    })

    it("signs once, however many times it runs", async () => {
        const ipas = await raise()
        await oldChecked(ipas.id)
        await convert()
        const first = await liveS6(ipas.id)
        await convert()
        expect((await liveS6(ipas.id)).map((r) => r.id).sort()).toEqual(first.map((r) => r.id).sort())
    })
})
