/**
 * Managing the Compliance kinds (#1258, spec #1247): the database rules.
 *
 * `outsider` holds Purchasing access and raises; `superAdmin` is a Super Admin with neither flag;
 * `finance` reads the IPAS but may not change the lists; `dealOwner` reads nothing.
 *
 * A retired kind is no longer picked for a new answer but stays on every IPAS that holds it (proven for
 * the picker rule in 1251); a kind a FILED IPAS holds keeps its name (the filed guard now knows
 * `ipas_compliance_requirements`), while retiring and reordering stay open.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"
import { tryUpdate } from "./support/access.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)
const RUN = Date.now().toString(36)
let poSeq = 0

const copyFor = (po) => ({
    po: { id: 1258000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_258_000 + poSeq, name: "Compliance Kinds Supplier", contact: null },
    lines: [{ line_id: 1258500 + poSeq * 10, product_id: 7730, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null }],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise() {
    const po = `P9${String(125800 + (poSeq += 1)).padStart(6, "0")}`
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po),
    })
    if (error) throw new Error(`raise ${po}: ${error.message}`)
    return data
}

const created = []
async function makeKind(label) {
    const { data, error } = await svc().from("ipas_options").insert({ list: "compliance_kind", label: `${label} ${RUN}`, sort: 900 + created.length }).select().single()
    if (error) throw new Error(`kind ${label}: ${error.message}`)
    created.push(data.id)
    return data
}
const row = async (id) => (await svc().from("ipas_options").select("*").eq("id", id).single()).data

beforeAll(async () => {
    await ensureCastLoaded()
    const a = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (a.error) throw a.error
})

afterAll(async () => {
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await sql().query(`delete from public.purchase_request_members where employee_id = $1`, [ids.outsider])
    if (created.length) await svc().from("ipas_options").delete().in("id", created)
})

describe("changing a kind", () => {
    it("lets Purchasing access and a Super Admin rename, reorder and retire one that no filed IPAS holds", async () => {
        for (const who of ["outsider", "superAdmin"]) {
            const kind = await makeKind(`Edit ${who}`)
            const client = await clientFor(who)
            const renamed = await tryUpdate(client, "ipas_options", kind.id, { label: `Renamed ${who} ${RUN}` })
            const moved = await tryUpdate(client, "ipas_options", kind.id, { sort: 777 })
            const retired = await tryUpdate(client, "ipas_options", kind.id, { active: false })
            expect([renamed.affected, moved.affected, retired.affected], who).toEqual([1, 1, 1])
            expect(await row(kind.id), who).toMatchObject({ label: `Renamed ${who} ${RUN}`, sort: 777, active: false })
        }
    })

    it("changes nothing for anyone else: a rename, a move and a retire all touch no row", async () => {
        const kind = await makeKind("Locked")
        for (const who of CAST_KEYS.filter((k) => !["outsider", "superAdmin"].includes(k))) {
            const client = await clientFor(who)
            for (const patch of [{ label: `Nope ${who}` }, { sort: 1 }, { active: false }]) {
                const result = await tryUpdate(client, "ipas_options", kind.id, patch)
                expect(result.affected, `${who} ${JSON.stringify(patch)}`).toBe(0)
            }
        }
        expect(await row(kind.id)).toMatchObject({ label: `Locked ${RUN}`, active: true })
    })

    it("lets the IPAS readers who can't edit read the list, and nobody else", async () => {
        for (const who of ["finance"]) {
            const { data, error } = await (await clientFor(who)).from("ipas_options").select("label").eq("list", "compliance_kind")
            expect(error, who).toBeNull()
            expect(data.map((o) => o.label), who).toEqual(expect.arrayContaining(["DENR", "MARINA", "OMB", "NTC", "FDA"]))
        }
        const { data } = await (await clientFor("dealOwner")).from("ipas_options").select("label").eq("list", "compliance_kind")
        expect(data).toEqual([])
    })
})

describe("a kind a filed IPAS holds", () => {
    let kind
    let filed
    let open

    beforeAll(async () => {
        kind = await makeKind("Held")
        filed = await raise()
        open = await raise()
        for (const ipas of [filed, open]) {
            const { error } = await rpc("outsider", "ipas_set_compliance", { p_ipas_id: ipas.id, p_needed: true, p_kind_ids: [kind.id] })
            if (error) throw new Error(`answer: ${error.message}`)
        }
    })

    it("can still be renamed while only an open IPAS holds it", async () => {
        const result = await tryUpdate(await clientFor("outsider"), "ipas_options", kind.id, { label: `Held renamed ${RUN}` })
        expect(result.affected).toBe(1)
        expect((await row(kind.id)).label).toBe(`Held renamed ${RUN}`)
        await svc().from("ipas_options").update({ label: kind.label }).eq("id", kind.id)
    })

    it("can't be renamed once a filed IPAS holds it, by anyone", async () => {
        await sql().query(`update public.ipas set state = 'filed', filed_at = now() where id = $1`, [filed.id])
        for (const who of ["outsider", "superAdmin"]) {
            const result = await tryUpdate(await clientFor(who), "ipas_options", kind.id, { label: `Sneaky ${who}` })
            expect(result.code, who).toBe("22023")
            expect(result.message, who).toMatch(/used on a filed IPAS/)
        }
        expect((await row(kind.id)).label).toBe(kind.label)
    })

    it("is named by ipas_filed_option_ids, which the screen uses to disable Rename", async () => {
        for (const who of ["outsider", "superAdmin", "finance"]) {
            const { data, error } = await rpc(who, "ipas_filed_option_ids")
            expect(error, who).toBeNull()
            expect(data, who).toContain(kind.id)
        }
    })

    it("can still be retired and reordered, and stays on the IPAS under its name", async () => {
        const client = await clientFor("outsider")
        expect((await tryUpdate(client, "ipas_options", kind.id, { active: false })).affected).toBe(1)
        expect((await tryUpdate(client, "ipas_options", kind.id, { sort: 955 })).affected).toBe(1)

        for (const ipas of [filed, open]) {
            const { data } = await svc()
                .from("ipas_compliance_requirements")
                .select("kind:ipas_options!ipas_compliance_requirements_kind_id_fkey(label, active)")
                .eq("ipas_id", ipas.id)
            expect(data.map((r) => r.kind)).toEqual([{ label: kind.label, active: false }])
        }
    })

    it("is no longer picked for a new answer, while the open IPAS that holds it may keep it", async () => {
        const fresh = await raise()
        const refused = await rpc("outsider", "ipas_set_compliance", { p_ipas_id: fresh.id, p_needed: true, p_kind_ids: [kind.id] })
        expect(refused.error?.code).toBe("22023")

        const kept = await rpc("outsider", "ipas_set_compliance", { p_ipas_id: open.id, p_needed: true, p_kind_ids: [kind.id] })
        expect(kept.error).toBeNull()
    })
})
