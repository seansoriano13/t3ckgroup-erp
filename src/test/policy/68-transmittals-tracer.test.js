/**
 * Transmittals (TG03, #252, spec #251): the database rules of the tracer bullet.
 *
 * `outsider` holds Purchasing access and is the purchaser who raises the IPAS
 * the slips carry. `warehouse`, `technical`, `logistics` and `checkByTwo` are
 * plain employees (no flags) put on their Transmittal staff list here. `ordinary`
 * is nobody to Transmittals or the IPAS. `superAdmin` sets the first number.
 *
 * Every slip is raised through the real `transmittal_create`, submitted through
 * `transmittal_submit` and cancelled through `transmittal_cancel`. The freezes
 * and the history are proven against the service role, which bypasses row level
 * security but not a trigger.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded, castEmail } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { canRead } from "./support/access.js"

const svc = () => serviceClient()
const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

let poSeq = 0
/** A PO number nothing else in the tier uses. */
const nextPo = () => `P8${String(10000 + (poSeq += 1)).padStart(6, "0")}`

const odooCopy = (po, company = "T3ck Trading") => ({
    po: { id: 881000 + poSeq, name: po, state: "purchase", company, company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: 553, name: "Scorpe Technologies", contact: null },
    lines: [
        { line_id: 911000 + poSeq * 10, product_id: 5350, name: "Cutter", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [], brand: "SCORPE" },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

/** Raises a live IPAS for a fresh PO as the purchaser. */
async function raiseIpas(company) {
    const po = nextPo()
    const { data, error } = await rpc("outsider", "ipas_create", {
        p_po_number: po,
        p_priority: "high",
        p_source: "local",
        p_purpose: "inventory",
        p_sor_ids: [],
        p_remarks: null,
        p_odoo_copy: odooCopy(po, company),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

const HEADER = {
    origin: "purchasing",
    check_warehouse: true,
    check_technical: true,
    priority: "high",
    entity: "T3ck Trading",
}

const lineOn = (ipas) => ({ kind: "po_line", ipas_id: ipas.id, odoo_po_line_id: ipas.odoo_copy.lines[0].line_id, quantity: 6 })

/** Raises a draft as `who` (default: the warehouse member), returning its id and number. */
async function raiseSlip(ipas, { who = "warehouse", header = HEADER } = {}) {
    const { data, error } = await rpc(who, "transmittal_create", {
        p_fields: header,
        p_product_ids: [],
        p_reference_ids: [],
        p_lines: [lineOn(ipas)],
    })
    if (error) throw new Error(`transmittal_create: ${error.message}`)
    return data
}

async function rowOf(table, id) {
    const { data, error } = await svc().from(table).select("*").eq("id", id).maybeSingle()
    if (error) throw error
    return data
}

const STAFF = [
    ["warehouse", "transmittal_warehouse"],
    ["technical", "transmittal_technical"],
    ["logistics", "transmittal_logistics"],
    ["checkByTwo", "transmittal_check_by"],
]

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    for (const [who, listKey] of STAFF) {
        const { error } = await svc()
            .from("ipas_signer_lists")
            .upsert({ list_key: listKey, employee_id: ids[who] }, { onConflict: "list_key,employee_id" })
        if (error) throw new Error(`Seeding ${listKey} for ${castEmail(who)}: ${error.message}`)
    }
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await svc().from("ipas_signer_lists").delete().in("employee_id", STAFF.map(([who]) => ids[who]))
})

describe("the Transmittal tables are protected", () => {
    it.each([["transmittals"], ["transmittal_lines"], ["transmittal_stages"], ["pms_handoff_events"]])(
        "reads through a policy, with no direct write grant: %s",
        async (table) => {
            const { data, error } = await (await clientFor("ordinary")).from(table).insert({}).select("id")
            expect(data ?? null).toBeNull()
            expect(error, `${table} accepted a direct write from a signed-in employee`).toBeTruthy()
        },
    )
})

describe("who reads a Transmittal", () => {
    it("is read by the preparer, every staff list member, and an IPAS reader; never by a plain employee", async () => {
        const ipas = await raiseIpas()
        const slip = await raiseSlip(ipas, { who: "warehouse" })

        expect(await canRead(await clientFor("warehouse"), "transmittals", slip.id)).toBe(true)
        expect(await canRead(await clientFor("technical"), "transmittals", slip.id)).toBe(true)
        expect(await canRead(await clientFor("logistics"), "transmittals", slip.id)).toBe(true)
        expect(await canRead(await clientFor("checkByTwo"), "transmittals", slip.id)).toBe(true)
        expect(await canRead(await clientFor("outsider"), "transmittals", slip.id)).toBe(true)
        expect(await canRead(await clientFor("ordinary"), "transmittals", slip.id)).toBe(false)
    })

    it("lets every staff list member read the slip's option lists, and no other IPAS option list", async () => {
        const options = async (who) => {
            const { data, error } = await (await clientFor(who)).from("ipas_options").select("list")
            if (error) throw error
            return new Set(data.map((r) => r.list))
        }
        for (const [who] of STAFF) {
            const lists = await options(who)
            expect(lists, `${who} reads the Product list`).toContain("transmittal_product")
            expect(lists, `${who} reads the Reference Checklist`).toContain("transmittal_reference")
            expect(lists, `${who} reads Item Locations`).toContain("item_location")
            expect(lists, `${who} reads an IPAS-only list`).not.toContain("payment_method")
        }
        expect((await options("ordinary")).size).toBe(0)
    })

    it("does not give a Transmittal staff list member the IPAS (no prices)", async () => {
        const ipas = await raiseIpas()
        expect(await canRead(await clientFor("warehouse"), "ipas", ipas.id)).toBe(false)
        expect(await canRead(await clientFor("technical"), "ipas", ipas.id)).toBe(false)
    })
})

describe("who raises a Transmittal", () => {
    it("lets Purchasing access and the Warehouse or Logistics list raise, and refuses everyone else", async () => {
        const ipas = await raiseIpas()
        const ok = await rpc("logistics", "transmittal_create", {
            p_fields: HEADER,
            p_product_ids: [],
            p_reference_ids: [],
            p_lines: [{ kind: "typed", description: "Sample", unit: "Unit", quantity: 1 }],
        })
        expect(ok.error).toBeNull()
        expect(ok.data.number).toMatch(/^TG03-\d+$/)

        const refused = await rpc("ordinary", "transmittal_create", {
            p_fields: HEADER,
            p_product_ids: [],
            p_reference_ids: [],
            p_lines: [lineOn(ipas)],
        })
        expect(refused.error).toBeTruthy()
        // The Technical list can read but not prepare.
        const technical = await rpc("technical", "transmittal_create", {
            p_fields: HEADER,
            p_product_ids: [],
            p_reference_ids: [],
            p_lines: [lineOn(ipas)],
        })
        expect(technical.error).toBeTruthy()
    })

    it("returns PO lines with no money, supplier or bank column", async () => {
        await raiseIpas()
        const { data, error } = await rpc("warehouse", "transmittal_pickable_po_lines", { p_search: null })
        expect(error).toBeNull()
        expect(data.length).toBeGreaterThan(0)
        for (const row of data) {
            for (const key of Object.keys(row)) {
                expect(key).not.toMatch(/price|supplier|bank|subtotal|tax/i)
            }
        }
        const refused = await rpc("ordinary", "transmittal_pickable_po_lines", { p_search: null })
        expect(refused.error).toBeTruthy()
    })

    it("refuses a PO line that isn't on its IPAS's Odoo copy, and warns on a PO line of another Company", async () => {
        const ipas = await raiseIpas()
        const missing = await rpc("warehouse", "transmittal_create", {
            p_fields: HEADER,
            p_product_ids: [],
            p_reference_ids: [],
            p_lines: [{ ...lineOn(ipas), odoo_po_line_id: 1 }],
        })
        expect(missing.error).toBeTruthy()

        const other = await raiseIpas("TG Enterprise")
        const warned = await rpc("warehouse", "transmittal_create", {
            p_fields: HEADER,
            p_product_ids: [],
            p_reference_ids: [],
            p_lines: [lineOn(other)],
        })
        expect(warned.error).toBeNull()
        expect(warned.data.warnings).toEqual([expect.objectContaining({ kind: "entity", entity: "TG Enterprise" })])
    })

    it("refuses a slip with neither Warehouse nor TCA Technical ticked", async () => {
        const ipas = await raiseIpas()
        const { error } = await rpc("warehouse", "transmittal_create", {
            p_fields: { ...HEADER, check_warehouse: false, check_technical: false },
            p_product_ids: [],
            p_reference_ids: [],
            p_lines: [lineOn(ipas)],
        })
        expect(error).toBeTruthy()
    })
})

describe("numbers", () => {
    it("never reuse a TG03 number, and the first number can't change once a Transmittal exists", async () => {
        const ipas = await raiseIpas()
        const first = await raiseSlip(ipas)
        const second = await raiseSlip(ipas)
        // "TG03-<n>": the number is what follows the prefix.
        expect(Number(second.number.slice("TG03-".length))).toBeGreaterThan(Number(first.number.slice("TG03-".length)))

        const byPreparer = await rpc("warehouse", "transmittal_set_first_number", { p_number: 1 })
        expect(byPreparer.error).toBeTruthy()
        const bySuperAdmin = await rpc("superAdmin", "transmittal_set_first_number", { p_number: 1 })
        expect(bySuperAdmin.error).toBeTruthy()
    })
})

describe("submit, the freezes and cancel", () => {
    it("opens Warehouse checking on a Warehouse-and-Technical slip, and fixes its lines", async () => {
        const ipas = await raiseIpas()
        const slip = await raiseSlip(ipas)
        const submitted = await rpc("warehouse", "transmittal_submit", { p_transmittal_id: slip.id })
        expect(submitted.error).toBeNull()
        expect(submitted.data).toMatchObject({ state: "warehouse_checking", notify_list: "transmittal_warehouse" })

        const stages = await svc().from("transmittal_stages").select("stage").eq("transmittal_id", slip.id)
        expect(stages.data.map((s) => s.stage).sort()).toEqual(["technical_inspection", "warehouse_checking", "warehouse_releasing"].sort())

        const line = await svc().from("transmittal_lines").select("id").eq("transmittal_id", slip.id).limit(1).single()
        const changed = await svc().from("transmittal_lines").update({ quantity: 99 }).eq("id", line.data.id)
        expect(changed.error?.message ?? "").toMatch(/submitted/)
    })

    it("refuses a header change once submitted, and refuses any change to a cancelled slip", async () => {
        const ipas = await raiseIpas()
        const slip = await raiseSlip(ipas)
        await rpc("warehouse", "transmittal_submit", { p_transmittal_id: slip.id })

        const header = await svc().from("transmittals").update({ origin: "logistics" }).eq("id", slip.id)
        expect(header.error?.message ?? "").toMatch(/header is fixed/)

        const cancelled = await rpc("warehouse", "transmittal_cancel", { p_transmittal_id: slip.id, p_reason: "Raised twice" })
        expect(cancelled.error).toBeNull()
        const after = await svc().from("transmittals").update({ priority: "low" }).eq("id", slip.id)
        expect(after.error).toBeTruthy()
    })

    it("needs a reason to cancel", async () => {
        const ipas = await raiseIpas()
        const slip = await raiseSlip(ipas)
        const blank = await rpc("warehouse", "transmittal_cancel", { p_transmittal_id: slip.id, p_reason: "   " })
        expect(blank.error).toBeTruthy()
        const row = await rowOf("transmittals", slip.id)
        expect(row.state).toBe("draft")
    })
})

describe("history", () => {
    it("is append-only for every role, the service role included", async () => {
        const ipas = await raiseIpas()
        const slip = await raiseSlip(ipas)
        const event = await svc().from("pms_handoff_events").select("id").eq("record_id", slip.id).limit(1).single()
        expect(event.data).toBeTruthy()

        const updated = await svc().from("pms_handoff_events").update({ kind: "edited" }).eq("id", event.data.id)
        expect(updated.error).toBeTruthy()
        const deleted = await svc().from("pms_handoff_events").delete().eq("id", event.data.id)
        expect(deleted.error).toBeTruthy()
    })
})
