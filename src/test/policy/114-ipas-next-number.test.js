/**
 * The next IPAS number (#600, spec #595).
 *
 * A Super Admin sets the number the next IPAS takes, at any time, so the ERP
 * carries on from the sheet's real last TGIPAS number on go-live day.
 * `ipas_set_next_number` refuses anyone else, refuses any value at or below the
 * highest number already given (a cancelled IPAS counts, since a number is never
 * reused) and writes an audit row. `ipas_next_number` is the read behind
 * Settings > Purchasing.
 *
 * `outsider` holds Purchasing access and raises the IPAS; `superAdmin` sets the
 * number; `ordinary` is nobody to the IPAS. The test only ever moves the series
 * forward, as the function insists, and removes its audit rows afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { FIXTURE_DOMAIN, ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
const nextPo = () => `P9${String(97000 + (poSeq += 1)).padStart(6, "0")}`

const copyFor = (po) => ({
    po: { id: 872000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 9_820_000 + poSeq, name: "Numbering Supplier", contact: null },
    lines: [
        { line_id: 882000 + poSeq * 10, product_id: 7700, name: "Item 1", quantity: 1, unit: "Unit", price_unit: 100, price_subtotal: 100, taxes: [], analytic: [], brand: null },
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

/** The value after `TGIPAS_`. */
const valueOf = (number) => Number(number.slice("TGIPAS_".length))

const auditRows = async () => {
    const { data, error } = await svc().from("system_audit_logs").select("*").eq("entity_type", "IPAS_NUMBER").order("created_at")
    if (error) throw error
    return data
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
})

afterAll(async () => {
    await svc().from("system_audit_logs").delete().eq("entity_type", "IPAS_NUMBER")
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
})

describe("who may set the next IPAS number", () => {
    it("refuses everyone but a Super Admin, and changes nothing", async () => {
        const before = await rpc("superAdmin", "ipas_next_number")
        expect(before.error).toBeNull()
        const target = before.data.next_value + 500

        for (const who of ["outsider", "ordinary"]) {
            const { data, error } = await rpc(who, "ipas_set_next_number", { p_number: target })
            expect(data ?? null, `${who} set the next IPAS number`).toBeNull()
            expect(error?.code, `${who} was not refused with 42501`).toBe("42501")
        }
        const anon = await anonymousClient().rpc("ipas_set_next_number", { p_number: target })
        expect(anon.error).toBeTruthy()

        const after = await rpc("superAdmin", "ipas_next_number")
        expect(after.data.next_value).toBe(before.data.next_value)
        expect((await auditRows()).length).toBe(0)
    })
})

describe("the read", () => {
    it("tells any signed-in employee the next number in TGIPAS_ format, and no one signed out", async () => {
        const seen = await rpc("ordinary", "ipas_next_number")
        expect(seen.error).toBeNull()
        expect(seen.data.number_format).toBe(`TGIPAS_${String(seen.data.next_value).padStart(3, "0")}`)
        expect(seen.data.next_value).toBeGreaterThan(seen.data.highest_given)

        const anon = await anonymousClient().rpc("ipas_next_number")
        expect(anon.error).toBeTruthy()
    })
})

describe("refusing a number already used", () => {
    it("refuses a value at or below the highest number given, a cancelled IPAS included", async () => {
        const ipas = await raise()
        const used = valueOf(ipas.number)

        const cancelled = await rpc("outsider", "ipas_cancel", { p_ipas_id: ipas.id, p_reason: "Raised in error" })
        expect(cancelled.error).toBeNull()

        // The cancelled IPAS still holds its number, so nothing at or below it is open.
        for (const value of [used, used - 1, 1]) {
            const { data, error } = await rpc("superAdmin", "ipas_set_next_number", { p_number: value })
            expect(data ?? null, `TGIPAS ${value} was accepted`).toBeNull()
            expect(error?.code).toBe("22023")
        }
        for (const value of [0, -4, null]) {
            const { error } = await rpc("superAdmin", "ipas_set_next_number", { p_number: value })
            expect(error, `${value} was accepted`).toBeTruthy()
        }

        const read = await rpc("superAdmin", "ipas_next_number")
        expect(read.data.next_value).toBeGreaterThan(used)
        expect(read.data.highest_given).toBeGreaterThanOrEqual(used)
        expect((await auditRows()).length).toBe(0)
    })
})

describe("setting the next number", () => {
    it("writes an audit row with who and when, and the next IPAS raised takes the number", async () => {
        const before = (await rpc("superAdmin", "ipas_next_number")).data
        const target = before.next_value + 20

        const set = await rpc("superAdmin", "ipas_set_next_number", { p_number: target })
        expect(set.error).toBeNull()
        expect(set.data).toMatchObject({ next_value: target, number_format: `TGIPAS_${String(target).padStart(3, "0")}` })

        const rows = await auditRows()
        expect(rows).toHaveLength(1)
        expect(rows[0].author_id).toBe(ids.superAdmin)
        expect(rows[0].created_at).toBeTruthy()
        expect(rows[0].metadata).toMatchObject({ from: before.next_value, to: target })

        expect((await rpc("ordinary", "ipas_next_number")).data.next_value).toBe(target)

        const ipas = await raise()
        expect(valueOf(ipas.number)).toBe(target)

        // And the series carries on from there: the number just given is now the floor.
        const again = await rpc("superAdmin", "ipas_set_next_number", { p_number: target })
        expect(again.error?.code).toBe("22023")
        expect((await rpc("ordinary", "ipas_next_number")).data.next_value).toBe(target + 1)
    })

    it("works any time: a number can be set again after IPAS exist, as long as it moves forward", async () => {
        const now = (await rpc("superAdmin", "ipas_next_number")).data
        const target = now.next_value + 5
        const set = await rpc("superAdmin", "ipas_set_next_number", { p_number: target })
        expect(set.error).toBeNull()
        expect((await rpc("superAdmin", "ipas_next_number")).data.next_value).toBe(target)
        expect((await auditRows()).length).toBeGreaterThanOrEqual(2)
    })
})
