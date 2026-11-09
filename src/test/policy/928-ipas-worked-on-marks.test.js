/**
 * "Worked on since it was raised" as a saved mark (#928, spec #927).
 *
 * `ipas_worked_on` used to scan the IPAS history on every read and timed out
 * (57014). It now reads `ipas_work_marks`, a row per IPAS that a trigger on the
 * history writes and the migration backfilled. What must hold is that the
 * answer did not change: the old scan, written out here as SQL, and the marks
 * agree for every kind of history entry, the `approvals_cleared` exclusion
 * included, and for every IPAS in the database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

// The filter `ipas_worked_on` ran before #928, word for word.
const OLD_SCAN = `
  select distinct e.ipas_id
    from public.ipas_events e
   where e.ipas_id = any ($1::uuid[])
     and e.kind not in (
       'created',
       'odoo_copy_changed', 'filled_from_odoo', 'odoo_changed_since_filing',
       'on_hold_set', 'on_hold_changed', 'on_hold_cleared'
     )
     and not (e.kind = 'approvals_cleared' and e.detail ->> 'reason' = 'PO changed in Odoo')`

let poSeq = 0
const nextPo = () => `P9${String(928000 + (poSeq += 1)).padStart(6, "0")}`

const copyFor = (po) => ({
    po: { id: 928000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_928_000 + poSeq, name: "Worked-on Supplier", contact: null },
    lines: [
        { line_id: 928000 + poSeq * 10, product_id: 7800, name: "Item 1", quantity: 1, unit: "Unit", price_unit: 100, price_subtotal: 100, taxes: [], analytic: ["S01234"], brand: "Acme" },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise() {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po),
    })
    if (error) throw new Error(`ipas raise ${po}: ${error.message}`)
    return data
}

/** Adds one history entry straight to the table, as the IPAS functions do. */
const addEvent = (ipasId, kind, detail = {}) =>
    sql().query(`insert into public.ipas_events (ipas_id, actor_id, kind, detail) values ($1, $2, $3, $4::jsonb)`, [
        ipasId,
        ids.outsider,
        kind,
        JSON.stringify(detail),
    ])

const oldScan = async (ipasIds) => (await sql().query(OLD_SCAN, [ipasIds])).rows.map((r) => r.ipas_id).sort()
const workedOn = async (ipasIds) => {
    const { data, error } = await rpc("outsider", "ipas_worked_on", { p_ipas_ids: ipasIds })
    if (error) throw error
    return [...data].sort()
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("ipas_worked_on reads the saved marks and answers as the old scan did", () => {
    it("agrees with the old scan for every kind of history entry", async () => {
        // [what is added to the history, whether it counts as work]
        const cases = [
            [[], false],
            [[["odoo_copy_changed"], ["filled_from_odoo"], ["odoo_changed_since_filing"]], false],
            [[["on_hold_set"], ["on_hold_changed"], ["on_hold_cleared"]], false],
            [[["approvals_cleared", { reason: "PO changed in Odoo" }]], false],
            // No reason: the old filter's comparison was null, so the entry was dropped.
            [[["approvals_cleared", {}]], false],
            [[["approvals_cleared", { reason: "Landed Cost changed" }]], true],
            [[["header_changed", { fields: ["computation_status"] }]], true],
            [[["on_hold_set"], ["payment_added"]], true],
        ]

        const raised = []
        for (const [events, expected] of cases) {
            const ipas = await raise()
            for (const [kind, detail] of events) await addEvent(ipas.id, kind, detail)
            raised.push({ id: ipas.id, expected })
        }

        const allIds = raised.map((r) => r.id)
        const expected = raised.filter((r) => r.expected).map((r) => r.id).sort()
        expect(await oldScan(allIds)).toEqual(expected)
        expect(await workedOn(allIds)).toEqual(expected)
    })

    it("marks an IPAS the moment real work lands, through the IPAS functions", async () => {
        const ipas = await raise()
        expect(await workedOn([ipas.id])).toEqual([])
        const set = await rpc("outsider", "ipas_set_header", { p_ipas_id: ipas.id, p_fields: { computation_status: "encoded" } })
        expect(set.error).toBeNull()
        expect(await workedOn([ipas.id])).toEqual([ipas.id])
    })

    it("holds a mark for exactly the IPAS the old scan finds, across the whole database (the backfill)", async () => {
        const { rows } = await sql().query(`
            with old as (${OLD_SCAN.replace("e.ipas_id = any ($1::uuid[])", "true")}),
                 marks as (select ipas_id from public.ipas_work_marks)
            select (select count(*) from old where ipas_id not in (select ipas_id from marks))::int as missing,
                   (select count(*) from marks where ipas_id not in (select ipas_id from old))::int as extra`)
        expect(rows[0]).toEqual({ missing: 0, extra: 0 })
    })

    it("shows no marks to someone who cannot read IPAS", async () => {
        const ipas = await raise()
        await addEvent(ipas.id, "header_changed", {})
        const { data } = await rpc("ordinary", "ipas_worked_on", { p_ipas_ids: [ipas.id] })
        expect(data ?? []).toEqual([])
        const direct = await (await clientFor("ordinary")).from("ipas_work_marks").select("ipas_id").eq("ipas_id", ipas.id)
        expect(direct.data ?? []).toEqual([])
    })

    it("lets nobody write a mark by hand", async () => {
        const ipas = await raise()
        const insert = await (await clientFor("outsider")).from("ipas_work_marks").insert({ ipas_id: ipas.id })
        expect(insert.error).not.toBeNull()
        expect(await workedOn([ipas.id])).toEqual([])
    })
})

describe("the IPAS list's slice of the Odoo copy (ipas_list_copy)", () => {
    it("keeps the header parts and only each line's analytic and subtotal", async () => {
        const ipas = await raise()
        const { data, error } = await (await clientFor("outsider"))
            .from("ipas")
            .select("id, odoo_copy:ipas_list_copy")
            .eq("id", ipas.id)
            .single()
        expect(error).toBeNull()
        expect(data.odoo_copy.po.company).toBe("T3ck Trading")
        expect(data.odoo_copy.supplier.name).toBe("Worked-on Supplier")
        expect(data.odoo_copy.receipts).toEqual({ status: "pending", done: 0, total: 1 })
        expect(data.odoo_copy.lines).toEqual([{ analytic: ["S01234"], price_subtotal: 100 }])
    })
})
