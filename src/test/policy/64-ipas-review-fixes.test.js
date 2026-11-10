/**
 * Code-review fixes for the IPAS work (#241): the number format past 999, the
 * grants on the helpers and trigger functions, and `ipas_sor_headers` needing
 * the ids it is asked for.
 *
 * `outsider` holds Purchasing access for the file and raises the IPAS;
 * `finance` holds Finance access alone and reads every IPAS.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { makeSor } from "./support/rows.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()

let poSeq = 0
/** A PO number nothing else in the tier uses. */
const nextPo = () => `P9${String(80000 + (poSeq += 1)).padStart(6, "0")}`

const odooCopy = (po) => ({
    po: { id: 890000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 553, name: "Review Fixes Supplier", contact: null },
    lines: [
        { line_id: 910001 + poSeq * 10, product_id: 5350, name: "Cutter", quantity: 2, unit: "Unit", price_unit: 100, price_subtotal: 200, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let sorId
let projectIpas

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    const ref = `S7${String(Date.now()).slice(-6)}`
    const set = await svc().from("sales_opportunities").update({ sales_reference: ref }).eq("id", sorId)
    if (set.error) throw set.error

    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "project",
        p_sor_ids: [sorId],
        p_remarks: null,
        p_odoo_copy: odooCopy(po),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    projectIpas = data
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    if (sorId) await svc().from("sales_opportunities").delete().eq("id", sorId)
})

describe("numbering", () => {
    it.each([
        [1, "TGIPAS_001"],
        [49, "TGIPAS_049"],
        [99, "TGIPAS_099"],
        [100, "TGIPAS_100"],
        [999, "TGIPAS_999"],
        [1000, "TGIPAS_1000"],
        [1234, "TGIPAS_1234"],
        [12345, "TGIPAS_12345"],
    ])("formats %s as %s, never cutting a longer number short", async (value, expected) => {
        const { rows } = await sql().query(`select public.ipas_format_number($1::bigint) as n`, [value])
        expect(rows[0].n).toBe(expected)
    })

    it("is what a new IPAS's number defaults to, so 1000 can't collide with 100", async () => {
        const { rows } = await sql().query(
            `select column_default from information_schema.columns
              where table_schema = 'public' and table_name = 'ipas' and column_name = 'number'`,
        )
        expect(rows[0].column_default).toContain("ipas_format_number")
        expect(rows[0].column_default).toContain("ipas_number_seq")
        expect(projectIpas.number).toMatch(/^TGIPAS_\d{3,}$/)
    })
})

describe("grants", () => {
    it("no IPAS function is executable by anon or public, and the two access helpers by authenticated", async () => {
        const { rows } = await sql().query(`
            select p.oid::regprocedure::text as fn,
                   has_function_privilege('anon', p.oid, 'execute') as anon,
                   exists (
                     select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
                   ) as public_execute,
                   has_function_privilege('authenticated', p.oid, 'execute') as authed
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname ~ '^(ipas_|_ipas_|has_finance_access$|set_ipas_updated_at$)'`)
        expect(rows.length).toBeGreaterThan(40)
        expect(rows.filter((r) => r.anon).map((r) => r.fn)).toEqual([])
        expect(rows.filter((r) => r.public_execute).map((r) => r.fn)).toEqual([])
        for (const fn of ["has_finance_access()", "ipas_can_read()"]) {
            expect(rows.find((r) => r.fn === fn)?.authed, fn).toBe(true)
        }
    })
})

describe("ipas_sor_headers asks for the IPAS it means", () => {
    it("gives a reader the SORs of the IPAS named", async () => {
        const { data, error } = await rpc("finance", "ipas_sor_headers", { p_ipas_ids: [projectIpas.id] })
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
        expect(data[0]).toMatchObject({ ipas_id: projectIpas.id, opportunity_id: sorId })
    })

    it("gives nobody anything for a null or an empty list, a reader included", async () => {
        for (const who of ["finance", "outsider", "superAdmin"]) {
            const none = await rpc(who, "ipas_sor_headers", { p_ipas_ids: null })
            expect(none.error).toBeNull()
            expect(none.data, `${who} with null`).toEqual([])
            const empty = await rpc(who, "ipas_sor_headers", { p_ipas_ids: [] })
            expect(empty.error).toBeNull()
            expect(empty.data, `${who} with []`).toEqual([])
        }
    })

    it("still gives a non-reader nothing for the IPAS named", async () => {
        const { data, error } = await rpc("ordinary", "ipas_sor_headers", { p_ipas_ids: [projectIpas.id] })
        expect(error).toBeNull()
        expect(data).toEqual([])
    })
})
