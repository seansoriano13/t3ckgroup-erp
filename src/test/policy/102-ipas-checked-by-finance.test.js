/**
 * Checked by belongs to Finance (#547, spec #544): the database rules on the IPAS Computation status.
 *
 *   - Purchasing moves the status Encoding -> Encoded -> LC GS Done -> LC Odoo Done and no further
 *   - Purchasing can't give Checked by (42501) and can't move the status away from it
 *   - Finance, and a Super Admin who isn't in Purchasing, give and take back Checked by
 *   - a Super Admin who is also in Purchasing counts as Purchasing, so is refused Checked by
 *
 * `outsider` holds Purchasing access for the file; `finance` is Finance only; `superAdmin` is a Super Admin
 * without Purchasing until a test flags them.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const copyFor = (po) => ({
    po: { id: 810000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_600_000 + poSeq, name: "Checked-by Supplier", contact: null },
    lines: [{ line_id: 820000 + poSeq * 10, product_id: 7400, name: "Item 1", quantity: 2, unit: "Unit", price_unit: 100, price_subtotal: 200, taxes: [], analytic: [], brand: null }],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

async function raise() {
    const po = `P9${String(80000 + (poSeq += 1)).padStart(6, "0")}`
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

const setStatus = (who, ipasId, status, extra = {}) =>
    rpc(who, "ipas_set_header", { p_ipas_id: ipasId, p_fields: { computation_status: status, ...extra } })
const forceStatus = (ipasId, status) => sql().query(`update public.ipas set computation_status = $2 where id = $1`, [ipasId, status])
const statusOf = async (ipasId) => (await svc().from("ipas").select("computation_status").eq("id", ipasId).single()).data.computation_status
const flag = async (who, on) => {
    const { error } = await svc().from("employees").update({ has_purchasing_flow: on }).eq("id", ids[who])
    if (error) throw error
}

beforeAll(async () => {
    await ensureCastLoaded()
    await flag("outsider", true)
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).in("id", [ids.outsider, ids.superAdmin, ids.finance])
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("Purchasing and the Computation status", () => {
    it("moves the status through every step up to LC Odoo Done", async () => {
        const ipas = await raise()
        for (const status of ["encoded", "lc_gs_done", "lc_odoo_done"]) {
            expect((await setStatus("outsider", ipas.id, status)).error, status).toBeNull()
            expect(await statusOf(ipas.id)).toBe(status)
        }
        // And back down again.
        expect((await setStatus("outsider", ipas.id, "lc_gs_done")).error).toBeNull()
    })

    it("is refused Checked by, from LC Odoo Done and as a jump", async () => {
        const ipas = await raise()
        await forceStatus(ipas.id, "lc_odoo_done")
        const direct = await setStatus("outsider", ipas.id, "checked")
        expect(direct.error?.code).toBe("42501")
        expect(await statusOf(ipas.id)).toBe("lc_odoo_done")

        await forceStatus(ipas.id, "encoding")
        expect((await setStatus("outsider", ipas.id, "checked")).error?.code).toBe("42501")
        expect((await setStatus("outsider", ipas.id, "checked", { pi_number: "X1" })).error?.code).toBe("42501")
        expect(await statusOf(ipas.id)).toBe("encoding")
    })

    it("is refused moving the status away from Checked by", async () => {
        const ipas = await raise()
        await forceStatus(ipas.id, "checked")
        for (const status of ["lc_odoo_done", "lc_gs_done", "encoded", "encoding"]) {
            expect((await setStatus("outsider", ipas.id, status)).error?.code, status).toBe("42501")
        }
        expect(await statusOf(ipas.id)).toBe("checked")
        // Other header fields are still Purchasing's to change while the status stays Checked by.
        expect((await rpc("outsider", "ipas_set_header", { p_ipas_id: ipas.id, p_fields: { pi_number: "Y2" } })).error).toBeNull()
    })
})

describe("Finance and the Computation status", () => {
    it("gives and takes back Checked by", async () => {
        const ipas = await raise()
        await forceStatus(ipas.id, "lc_odoo_done")
        expect((await setStatus("finance", ipas.id, "checked")).error).toBeNull()
        expect(await statusOf(ipas.id)).toBe("checked")
        expect((await setStatus("finance", ipas.id, "lc_odoo_done")).error).toBeNull()
        expect(await statusOf(ipas.id)).toBe("lc_odoo_done")
    })

    it("moves nothing else", async () => {
        const ipas = await raise()
        await forceStatus(ipas.id, "encoded")
        expect((await setStatus("finance", ipas.id, "checked")).error?.code).toBe("42501")
        expect((await setStatus("finance", ipas.id, "lc_gs_done")).error?.code).toBe("42501")
        expect((await setStatus("ordinary", ipas.id, "lc_gs_done")).error?.code).toBe("42501")
    })
})

describe("a Super Admin", () => {
    it("who isn't in Purchasing gives and takes back Checked by", async () => {
        await flag("superAdmin", false)
        const ipas = await raise()
        await forceStatus(ipas.id, "lc_odoo_done")
        expect((await setStatus("superAdmin", ipas.id, "checked")).error).toBeNull()
        expect(await statusOf(ipas.id)).toBe("checked")
        expect((await setStatus("superAdmin", ipas.id, "lc_odoo_done")).error).toBeNull()
        expect(await statusOf(ipas.id)).toBe("lc_odoo_done")
    })

    it("who is also in Purchasing counts as Purchasing and is refused Checked by", async () => {
        await flag("superAdmin", true)
        try {
            const ipas = await raise()
            await forceStatus(ipas.id, "lc_odoo_done")
            expect((await setStatus("superAdmin", ipas.id, "checked")).error?.code).toBe("42501")
            expect(await statusOf(ipas.id)).toBe("lc_odoo_done")
            expect((await setStatus("superAdmin", ipas.id, "lc_gs_done")).error).toBeNull()

            await forceStatus(ipas.id, "checked")
            expect((await setStatus("superAdmin", ipas.id, "lc_odoo_done")).error?.code).toBe("42501")
        } finally {
            await flag("superAdmin", false)
        }
    })
})
