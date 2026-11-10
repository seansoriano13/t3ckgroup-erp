/**
 * The IPAS SOR picker finds every SOR and remembers the last ones (#601, spec
 * #595). `ipas_find_sors` matches SOR number, SO number (Sales Reference and
 * the older opportunity number) and project name, case-insensitively, finds an
 * SOR with no SO number, and still returns the locked summary only.
 * `ipas_recent_sors` gives the caller's own last five.
 *
 * `outsider` and `support` hold Purchasing access here; everyone else does not.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor } from "./support/rows.js"
import { purgeFixtureIpas, raiseIpas } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

const RUN = Date.now().toString(36)
const CUSTOMER = `Quillfeather Holdings ${RUN}`
const PURCHASERS = ["outsider", "support"]
const odooCopy = (po, odooId) => ({
    po: { id: odooId, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 554, name: "Picker Supplier", contact: null },
    lines: [
        { line_id: odooId + 10, product_id: 5360, name: "Cutter", quantity: 2, unit: "Unit", price_unit: 100, price_subtotal: 200, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const created = []
let withSo
let withoutSo
let oldNumberOnly
let ownSors
let othersSor
const refSo = `S6${String(Date.now()).slice(-6)}`
const oldNo = `OLD-${RUN.toUpperCase()}`

async function makeNamedSor(project, patch = {}) {
    const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, companyName: CUSTOMER })
    created.push(id)
    const { data, error } = await svc()
        .from("sales_opportunities")
        .update({ project_title: project, ...patch })
        .eq("id", id)
        .select("id, sor_code")
        .single()
    if (error) throw error
    return data
}

let poSeq = 0
async function raiseFor(who, sorId) {
    poSeq += 1
    const po = `P98816${String(poSeq).padStart(2, "0")}`
    const { data, error } = await raiseIpas(ids[who], {
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "project",
        p_sor_ids: [sorId],
        p_remarks: null,
        p_odoo_copy: odooCopy(po, 881600 + poSeq * 100),
    })
    if (error) throw new Error(`raise ${po}: ${error.message}`)
    return data
}

beforeAll(async () => {
    await ensureCastLoaded()
    for (const who of PURCHASERS) {
        const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids[who])
        if (flag.error) throw flag.error
    }

    withSo = await makeNamedSor(`Zephyr Harbour Dredging ${RUN}`, { sales_reference: refSo })
    withoutSo = await makeNamedSor(`Marlin Breakwater Survey ${RUN}`)
    oldNumberOnly = await makeNamedSor(`Quoll Ridge Bridge ${RUN}`, { opportunity_no: oldNo })

    // Six SORs the purchaser has named, oldest first, and one only a colleague named.
    ownSors = []
    for (let i = 1; i <= 6; i += 1) {
        const sor = await makeNamedSor(`Recent Pick ${i} ${RUN}`)
        ownSors.push(sor)
        await raiseFor("outsider", sor.id)
    }
    othersSor = await makeNamedSor(`Colleague Pick ${RUN}`)
    await raiseFor("support", othersSor.id)
})

afterAll(async () => {
    for (const who of PURCHASERS) {
        await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids[who])
    }
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    if (created.length) await svc().from("sales_opportunities").delete().in("id", created)
})

const find = (search) => rpc("outsider", "ipas_find_sors", { p_refs: null, p_search: search })
const idsOf = (res) => res.data.map((r) => r.opportunity_id)
const SUMMARY_KEYS = ["current_stage_name", "opportunity_id", "project_title", "sales_reference", "sor_code"]

describe("ipas_find_sors", () => {
    it("finds an SOR by its SOR number, however it is typed", async () => {
        const code = withoutSo.sor_code
        expect(code).toMatch(/^SOR-\d+$/)
        for (const typed of [code, code.toLowerCase(), code.replace("-", " "), code.replace("-", "")]) {
            const res = await find(typed)
            expect(res.error, typed).toBeNull()
            expect(idsOf(res), typed).toContain(withoutSo.id)
        }
    })

    it("finds an SOR by its SO number, in any case, and by the older opportunity number", async () => {
        expect(idsOf(await find(refSo))).toContain(withSo.id)
        expect(idsOf(await find(refSo.toLowerCase()))).toContain(withSo.id)
        expect(idsOf(await find(oldNo.toLowerCase()))).toContain(oldNumberOnly.id)
    })

    it("finds an SOR by project name, in any case", async () => {
        expect(idsOf(await find(`zephyr harbour dredging ${RUN}`))).toEqual([withSo.id])
        expect(idsOf(await find("MARLIN BREAKWATER"))).toContain(withoutSo.id)
    })

    it("finds an SOR that has no SO number yet, and says so", async () => {
        const res = await find(`marlin breakwater survey ${RUN}`)
        expect(res.data).toEqual([
            expect.objectContaining({ opportunity_id: withoutSo.id, sor_code: withoutSo.sor_code, sales_reference: null }),
        ])
    })

    it("returns the SOR number, SO number, project and Stage only, never the customer", async () => {
        const res = await find(refSo)
        expect(res.error).toBeNull()
        expect(res.data).toHaveLength(1)
        expect(Object.keys(res.data[0]).sort()).toEqual(SUMMARY_KEYS)
        expect(res.data[0]).toMatchObject({ opportunity_id: withSo.id, sor_code: withSo.sor_code, sales_reference: refSo })
        expect(JSON.stringify(res.data)).not.toContain(CUSTOMER)
        expect((await find("quillfeather")).data).toEqual([])
    })

    it("still looks up the suggestions by exact SO number", async () => {
        const res = await rpc("outsider", "ipas_find_sors", { p_refs: [refSo.toLowerCase()], p_search: null })
        expect(idsOf(res)).toEqual([withSo.id])
    })

    it("is still refused to everyone without Purchasing access", async () => {
        for (const who of ["finance", "superAdmin", "ipasSigner", "ordinary", "dealOwner"]) {
            const { error } = await rpc(who, "ipas_find_sors", { p_refs: null, p_search: refSo })
            expect(error?.code, who).toBe("42501")
        }
    })
})

describe("ipas_recent_sors", () => {
    it("gives the caller's last five SORs, newest first, as the locked summary", async () => {
        const res = await rpc("outsider", "ipas_recent_sors", {})
        expect(res.error).toBeNull()
        expect(idsOf(res)).toEqual(ownSors.slice(1).reverse().map((s) => s.id))
        expect(Object.keys(res.data[0]).sort()).toEqual(SUMMARY_KEYS)
        expect(res.data[0]).toMatchObject({ sor_code: ownSors[5].sor_code })
        expect(JSON.stringify(res.data)).not.toContain(CUSTOMER)
    })

    it("is the caller's own only", async () => {
        const mine = idsOf(await rpc("outsider", "ipas_recent_sors", {}))
        expect(mine).not.toContain(othersSor.id)

        const theirs = await rpc("support", "ipas_recent_sors", {})
        expect(theirs.error).toBeNull()
        expect(idsOf(theirs)).toEqual([othersSor.id])
    })

    it("leaves out a deleted SOR", async () => {
        const gone = ownSors[5]
        await svc().from("sales_opportunities").update({ is_deleted: true }).eq("id", gone.id)
        try {
            const res = await rpc("outsider", "ipas_recent_sors", {})
            expect(idsOf(res)).not.toContain(gone.id)
            expect(idsOf(res)).toHaveLength(5)
        } finally {
            await svc().from("sales_opportunities").update({ is_deleted: false }).eq("id", gone.id)
        }
    })

    it("is refused to everyone without Purchasing access", async () => {
        for (const who of ["finance", "superAdmin", "ipasSigner", "ordinary", "dealOwner", "warehouse"]) {
            const { error } = await rpc(who, "ipas_recent_sors", {})
            expect(error?.code, who).toBe("42501")
        }
    })
})
