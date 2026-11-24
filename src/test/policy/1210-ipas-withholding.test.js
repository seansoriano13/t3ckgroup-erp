/**
 * Withholding (2307) on a Local IPAS (#1210, spec #1205): the database rules.
 *
 * `outsider` holds Purchasing access; `ordinary` does not.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P9${String(97000 + (poSeq += 1)).padStart(6, "0")}`

async function raise(source) {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: source,
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: {
            po: { id: 971000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "PHP", origin: null, partner_ref: null },
            supplier: { id: 9_971_000 + poSeq, name: "Withholding Supplier", contact: null },
            lines: [
                { line_id: 971500 + poSeq * 10, product_id: 7800, name: "Item 1", quantity: 10, unit: "Unit", price_unit: 100, price_subtotal: 1000, taxes: [], analytic: [], brand: null },
            ],
            receipts: { status: "pending", done: 0, total: 1 },
            bills: { count: 0, draft: 0 },
        },
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const setWithholding = (who, ipasId, value) => rpc(who, "ipas_set_withholding", { p_ipas_id: ipasId, p_withholding: value })

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("Withholding (2307)", () => {
    it("is saved on a Local IPAS, changed and cleared", async () => {
        const ipas = await raise("local")
        for (const value of ["1", "2", "not_applicable"]) {
            const saved = await setWithholding("outsider", ipas.id, value)
            expect(saved.error).toBeNull()
            expect(saved.data.withholding).toBe(value)
        }
        const cleared = await setWithholding("outsider", ipas.id, null)
        expect(cleared.error).toBeNull()
        expect(cleared.data.withholding).toBeNull()
    })

    it("is refused on an Import IPAS", async () => {
        const ipas = await raise("import")
        const refused = await setWithholding("outsider", ipas.id, "1")
        expect(refused.error?.message).toContain("only for a Local IPAS")
        expect((await svc().from("ipas").select("withholding").eq("id", ipas.id).single()).data.withholding).toBeNull()
    })

    it("is refused on an Import IPAS even when written straight to the table", async () => {
        const ipas = await raise("import")
        const direct = await svc().from("ipas").update({ withholding: "2" }).eq("id", ipas.id)
        expect(direct.error?.message).toContain("only for a Local IPAS")
    })

    it("refuses a value that is not 1, 2 or not applicable", async () => {
        const ipas = await raise("local")
        expect((await setWithholding("outsider", ipas.id, "5")).error).not.toBeNull()
    })

    it("is refused to anyone who may not edit the money fields", async () => {
        const ipas = await raise("local")
        const refused = await setWithholding("ordinary", ipas.id, "1")
        expect(refused.error?.code).toBe("42501")
    })
})
