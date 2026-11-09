/**
 * IPAS required documents are checked at every sign-off of a section (#936, spec #927),
 * not only the first: a file removed after "Send for signing" stops the Approve.
 * Section 1 on a Local IPAS needs the Quotation (Local).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser, readyToSign } from "./support/ipas.js"

const svc = () => serviceClient()
const CAST_IDS = () => CAST_KEYS.map((k) => ids[k])

let poSeq = 0
const copyFor = (po) => ({
    po: { id: 936000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_360_000 + poSeq, name: "Every Signoff Supplier", contact: null },
    lines: [{ line_id: 936100 + poSeq * 10, product_id: 7600, name: "Item 1", quantity: 2, unit: "Unit", price_unit: 100, price_subtotal: 200, taxes: [], analytic: [], brand: null }],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise() {
    const po = `P9${String(93000 + (poSeq += 1)).padStart(6, "0")}`
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: copyFor(po),
    })
    if (error) throw new Error(`ipas_raise ${po}: ${error.message}`)
    return data
}

const sign = async (who, ipasId, section, role, { ready = true } = {}) => {
    if (ready) await readyToSign(ipasId, section, role)
    return (await clientFor(who)).rpc("ipas_sign", { p_ipas_id: ipasId, p_section: section, p_role: role })
}

const clearLists = async () => {
    const { error } = await svc().from("ipas_signer_lists").delete().in("employee_id", CAST_IDS())
    if (error) throw error
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

beforeEach(async () => {
    await clearLists()
    const { error } = await svc().from("ipas_signer_lists").insert({ list_key: "s1_approved", employee_id: ids.ipasSigner })
    if (error) throw error
})

afterAll(async () => {
    await clearLists()
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", CAST_IDS())
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("required documents at a later sign-off", () => {
    it("refuses the Approve when a required file was removed after Send for signing, naming it", async () => {
        const ipas = await raise()
        const prepared = await sign("outsider", ipas.id, 1, "prepared")
        expect(prepared.error).toBeNull()

        await sql().query(`update public.ipas_documents set attachment_url = null where ipas_id = $1`, [ipas.id])

        const refused = await sign("ipasSigner", ipas.id, 1, "approved", { ready: false })
        expect(refused.error?.code).toBe("22023")
        expect(refused.error?.message).toMatch(/Quotation \(Local\)/)
    })

    it("lets the Approve through once the file is back", async () => {
        const ipas = await raise()
        expect((await sign("outsider", ipas.id, 1, "prepared")).error).toBeNull()

        await sql().query(`update public.ipas_documents set attachment_url = null where ipas_id = $1`, [ipas.id])
        expect((await sign("ipasSigner", ipas.id, 1, "approved", { ready: false })).error?.code).toBe("22023")

        const approved = await sign("ipasSigner", ipas.id, 1, "approved")
        expect(approved.error).toBeNull()
    })
})
