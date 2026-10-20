/**
 * The SOR's IPAS summary (#249, spec #241): the database rules.
 *
 * `ipas_summaries_for_sor(opportunity_id)` gives whoever can read an SOR a
 * summary of each Project IPAS naming it, and nothing else of the IPAS:
 * never payments, charges, bank details or Landed Cost. The gate is the SOR
 * read rule in force (`sor_access_level = 'full'`), so this file asks that
 * function of every identity in the cast and holds the summary to it in both
 * directions.
 *
 * `outsider` holds Purchasing access for the file and is the purchaser;
 * `dealOwner` is on the Deal Team with no Purchasing or Finance access (the
 * reader the feature exists for); `ordinary` is nobody to the SOR; `finance`
 * and `superAdmin` read every IPAS.
 *
 * Everything runs through the real `ipas_create`, `ipas_add_payment`,
 * `ipas_add_charge`, `ipas_set_bank_details`, `ipas_set_typed_status` and
 * `ipas_sign`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { makeSor } from "./support/rows.js"
import { purgeFixtureIpas, raiseAsPurchaser } from "./support/ipas.js"

const svc = () => serviceClient()

let poSeq = 0
/** A PO number nothing else in the tier uses. */
const nextPo = () => `P9${String(50000 + (poSeq += 1)).padStart(6, "0")}`

let supplierSeq = 0
const nextSupplier = () => 9_500_000 + (supplierSeq += 1)

const AMOUNT = 123456.78
const ACCOUNT_NUMBER = "7788 9900 1122"
const BANK_NAME = "Summary Test Bank"
const PROOF_URL = "https://res.cloudinary.com/demo/policy-summary-proof.png"

const copyFor = (po, supplierId) => ({
    po: { id: 750000 + poSeq, name: po, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
    supplier: { id: supplierId, name: "Summary Supplier", contact: null },
    lines: [
        { line_id: 780000 + poSeq * 10, product_id: 7300, name: "Rope", quantity: 4, unit: "Unit", price_unit: 900, price_subtotal: 3600, taxes: [], analytic: [], brand: null },
    ],
    receipts: { status: "pending", done: 0, total: 1 },
    bills: { count: 0, draft: 0 },
})

const rpc = async (who, name, args) => (await clientFor(who)).rpc(name, args)

async function raise({ purpose = "project", sorIds = [], source = "local" } = {}) {
    const po = nextPo()
    const { data, error } = await raiseAsPurchaser({
        p_po_number: po,
        p_priority: "high",
        p_source: source,
        p_purpose: purpose,
        p_sor_ids: sorIds,
        p_remarks: null,
        p_odoo_copy: copyFor(po, nextSupplier()),
    })
    if (error) throw new Error(`ipas_create ${po}: ${error.message}`)
    return data
}

async function ok(promise, what) {
    const { data, error } = await promise
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
}

async function optionId(list, label) {
    const { data, error } = await svc().from("ipas_options").select("id").eq("list", list).eq("label", label).maybeSingle()
    if (error) throw error
    if (!data) throw new Error(`Option ${list}/${label} isn't seeded`)
    return data.id
}

const summaries = async (who, sorId) => {
    const { data, error } = await (await clientFor(who)).rpc("ipas_summaries_for_sor", { p_opportunity_id: sorId })
    if (error) throw new Error(`ipas_summaries_for_sor as ${who}: ${error.message}`)
    return data
}

const levelOf = async (who, sorId) => {
    const { data, error } = await (await clientFor(who)).rpc("sor_access_level", { p_opportunity_id: sorId })
    if (error) throw new Error(`sor_access_level as ${who}: ${error.message}`)
    return data
}

let sorA, sorB, sorQuiet
let both, onlyA, cancelled, inventory

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error

    sorA = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorB = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sorQuiet = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })

    both = await raise({ sorIds: [sorA, sorB] })
    onlyA = await raise({ sorIds: [sorA], source: "import" })
    cancelled = await raise({ sorIds: [sorA] })
    inventory = await raise({ purpose: "inventory" })

    // Money and bank details on `both`: none of it may reach the summary.
    const methodId = await optionId("payment_method", "Dated Check")
    const chargeKindId = await optionId("charge_kind", "Brokerage Fee")
    await ok(
        rpc("outsider", "ipas_add_payment", {
            p_ipas_id: both.id,
            p_kind: "down_payment",
            p_paid_on: "2026-10-01",
            p_amount: AMOUNT,
            p_php_debited: null,
            p_charge_fee_php: 0,
            p_method_id: methodId,
            p_check_no: null,
            p_proof_url: PROOF_URL,
        }),
        "ipas_add_payment",
    )
    await ok(
        rpc("outsider", "ipas_add_charge", { p_ipas_id: both.id, p_kind_id: chargeKindId, p_charged_on: "2026-10-05", p_amount_php: 4321.5 }),
        "ipas_add_charge",
    )
    await ok(
        rpc("outsider", "ipas_set_bank_details", {
            p_ipas_id: both.id,
            p_bank_name: BANK_NAME,
            p_account_name: "Summary Supplier Inc.",
            p_account_number: ACCOUNT_NUMBER,
        }),
        "ipas_set_bank_details",
    )
    await ok(rpc("outsider", "ipas_set_typed_status", { p_ipas_id: both.id, p_status: "delivered", p_date: "2026-10-08" }), "delivered")
    await ok(rpc("outsider", "ipas_set_header", { p_ipas_id: both.id, p_fields: { computation_status: "encoded" } }), "encoded")
    await ok(rpc("outsider", "ipas_sign", { p_ipas_id: both.id, p_section: 1, p_role: "prepared" }), "section 1 prepared")

    await ok(rpc("outsider", "ipas_cancel", { p_ipas_id: cancelled.id, p_reason: "Wrong PO" }), "ipas_cancel")
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    await svc().from("sales_opportunities").delete().in("id", [sorA, sorB, sorQuiet].filter(Boolean))
})

describe("the summary of an SOR's IPAS", () => {
    it("gives a Deal Team member with no Purchasing or Finance access the summary of each Project IPAS naming it", async () => {
        const flags = await svc().from("employees").select("has_purchasing_flow, has_finance_flow, is_super_admin").eq("id", ids.dealOwner).single()
        expect(flags.data).toMatchObject({ has_purchasing_flow: false, has_finance_flow: false })

        const rows = await summaries("dealOwner", sorA)
        expect(new Set(rows.map((r) => r.ipas_id))).toEqual(new Set([both.id, onlyA.id, cancelled.id]))
        expect(rows.map((r) => r.number).sort()).toEqual([both.number, onlyA.number, cancelled.number].sort())
        expect(rows.find((r) => r.ipas_id === both.id)).toMatchObject({
            number: both.number,
            po_number: both.po_number,
            supplier: "Summary Supplier",
            purpose: "project",
            state: "open",
            computation_status: "encoded",
        })
    })

    it("lists open IPAS first, then filed, then cancelled", async () => {
        const rows = await summaries("dealOwner", sorA)
        expect(rows.at(-1)).toMatchObject({ ipas_id: cancelled.id, state: "cancelled" })
        expect(rows.slice(0, -1).every((r) => r.state === "open")).toBe(true)
    })

    it("can't be turned into the money: the same reader can read none of ipas, ipas_payments, ipas_charges or ipas_bank_details", async () => {
        const client = await clientFor("dealOwner")
        for (const table of ["ipas", "ipas_payments", "ipas_charges", "ipas_bank_details", "ipas_signoffs", "ipas_documents", "ipas_events"]) {
            const column = table === "ipas" ? "id" : "ipas_id"
            const { data, error } = await client.from(table).select("*").eq(column, both.id)
            expect(error, `${table} errored for a Deal Team member`).toBeNull()
            expect(data, `${table} readable by a Deal Team member`).toEqual([])
        }
        // The service role sees them, so the empties above are the policies' doing.
        for (const table of ["ipas_payments", "ipas_charges", "ipas_bank_details"]) {
            const { data } = await svc().from(table).select("ipas_id").eq("ipas_id", both.id)
            expect(data, `${table} has nothing seeded`).toHaveLength(1)
        }
    })

    it("has exactly the agreed key set: no payment or bank column, Landed Cost only as total and mark (#283)", async () => {
        const [row] = await summaries("dealOwner", sorA)
        expect(Object.keys(row).sort()).toEqual([
            "buyer_track",
            "computation_status",
            "ipas_id",
            "landed_cost_mark",
            "landed_cost_total_php",
            "number",
            "po_number",
            "purpose",
            "signoffs",
            "state",
            "supplier",
        ])
        for (const item of row.buyer_track) expect(Object.keys(item).sort()).toEqual(["key", "partial", "ticked"])
        expect(Object.keys(row.signoffs).sort()).toEqual(["1", "3", "7"])
        expect(Object.keys(row.signoffs["1"]).sort()).toEqual(["approved", "prepared"])
        expect(Object.keys(row.signoffs["7"]).sort()).toEqual(["approved", "checked", "noted", "received"])
    })

    it("carries none of the IPAS's money or bank values, whatever is on file", async () => {
        // Ids are random UUIDs, whose hex digits can contain a short sentinel like "7788" by chance.
        // Drop them so only real values are searched; money and bank values are never UUID-shaped.
        const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
        const text = JSON.stringify(await summaries("dealOwner", sorA)).replace(UUID, "")
        for (const secret of [String(AMOUNT), "123456", "4321", ACCOUNT_NUMBER, "7788", BANK_NAME, "Supplier Inc.", PROOF_URL, "cloudinary"]) {
            expect(text, `the summary mentions ${secret}`).not.toContain(secret)
        }
    })

    it("reflects the buyer track, computation status and live sign-offs", async () => {
        const rows = await summaries("dealOwner", sorA)
        const track = Object.fromEntries(rows.find((r) => r.ipas_id === both.id).buyer_track.map((i) => [i.key, i]))
        expect(track.purchase_order.ticked).toBe(true)
        expect(track.with_pop.ticked).toBe(true) // a payment carries proof; the link isn't returned
        expect(track.delivered.ticked).toBe(true)
        expect(track.create_bill.ticked).toBe(false)
        expect(track.received_in_odoo).toMatchObject({ ticked: false, partial: false })
        expect(track.actual_checking.ticked).toBe(false)
        expect(track).not.toHaveProperty("import_clearance") // a Local IPAS has none

        const both1 = rows.find((r) => r.ipas_id === both.id)
        expect(both1.signoffs["1"]).toEqual({ prepared: true, approved: false })
        expect(both1.signoffs["3"]).toEqual({ prepared: false, approved: false })

        const importTrack = rows.find((r) => r.ipas_id === onlyA.id).buyer_track.map((i) => i.key)
        expect(importTrack).toContain("import_clearance")
        expect(rows.find((r) => r.ipas_id === onlyA.id).buyer_track.find((i) => i.key === "with_pop").ticked).toBe(false)
    })
})

describe("who gets rows: the SOR read rule", () => {
    it("gives a row to exactly those who read the SOR in full, in both directions, across the cast", async () => {
        const seen = { withRows: 0, without: 0 }
        for (const who of CAST_KEYS) {
            const level = await levelOf(who, sorA)
            const rows = await summaries(who, sorA)
            if (level === "full") {
                expect(rows.length, `${who} reads the SOR in full and got no summary`).toBe(3)
                seen.withRows += 1
            } else {
                expect(rows, `${who} (${level}) was given a summary`).toEqual([])
                seen.without += 1
            }
        }
        // Both directions were actually exercised.
        expect(seen.withRows).toBeGreaterThan(0)
        expect(seen.without).toBeGreaterThan(0)
    })

    it("gives the Deal Team and Super Admins rows, and someone with no part in the SOR none", async () => {
        expect(await levelOf("ordinary", sorA)).toBe("none")
        expect(await summaries("ordinary", sorA)).toEqual([])
        expect(await summaries("outsider", sorA)).toEqual([]) // Purchasing access alone is not SOR access
        expect((await summaries("dealOwner", sorA)).length).toBe(3)
        expect((await summaries("superAdmin", sorA)).length).toBe(3)
    })

    it("gives a full IPAS reader who is also on the deal the same summary the table can open", async () => {
        const dealOwnerRows = await summaries("dealOwner", sorA)
        const superRows = await summaries("superAdmin", sorA)
        // Landed Cost is cost (#546): the Super Admin (closed_book) may get it, the Deal Team never.
        const withoutLandedCost = (rows) => rows.map(({ landed_cost_total_php, landed_cost_mark, ...rest }) => rest)
        expect(withoutLandedCost(superRows)).toEqual(withoutLandedCost(dealOwnerRows))
        const { data } = await (await clientFor("superAdmin")).from("ipas").select("id").eq("id", both.id)
        expect(data).toHaveLength(1)
    })

    it("is refused to the signed-out", async () => {
        const { error } = await anonymousClient().rpc("ipas_summaries_for_sor", { p_opportunity_id: sorA })
        expect(error).not.toBeNull()
    })

    it("returns nothing for an SOR that doesn't exist", async () => {
        const { data, error } = await (await clientFor("superAdmin")).rpc("ipas_summaries_for_sor", {
            p_opportunity_id: "00000000-0000-0000-0000-000000000000",
        })
        expect(error).toBeNull()
        expect(data).toEqual([])
    })
})

describe("which IPAS appear", () => {
    it("lists an IPAS naming two SORs on both", async () => {
        expect((await summaries("dealOwner", sorA)).map((r) => r.ipas_id)).toContain(both.id)
        expect((await summaries("dealOwner", sorB)).map((r) => r.ipas_id)).toEqual([both.id])
    })

    it("gives an SOR no IPAS names no rows", async () => {
        expect(await summaries("dealOwner", sorQuiet)).toEqual([])
    })

    it("never lists an Inventory IPAS on any SOR", async () => {
        for (const who of ["dealOwner", "superAdmin"]) {
            for (const sor of [sorA, sorB, sorQuiet]) {
                const rows = await summaries(who, sor)
                expect(rows.map((r) => r.ipas_id)).not.toContain(inventory.id)
            }
        }
    })

    it("still leaves an Inventory IPAS off even when a stray SOR row names the SOR", async () => {
        // The deferred rule on ipas_sors refuses this row; switch it off for one
        // transaction the way the cleanup does, to prove the function asks for
        // Project itself rather than trusting the rule.
        const client = await sql().connect()
        try {
            await client.query("begin")
            await client.query("set local session_replication_role = replica")
            await client.query("insert into public.ipas_sors (ipas_id, opportunity_id) values ($1, $2)", [inventory.id, sorQuiet])
            await client.query("commit")
        } catch (error) {
            await client.query("rollback").catch(() => {})
            throw error
        } finally {
            client.release()
        }

        expect(await summaries("dealOwner", sorQuiet)).toEqual([])
        expect(await summaries("superAdmin", sorQuiet)).toEqual([])
    })
})

describe("who may call it", () => {
    it("is not executable by anon", async () => {
        const { rows } = await sql().query(
            `select has_function_privilege('anon', 'public.ipas_summaries_for_sor(uuid)', 'execute') as anon,
                    has_function_privilege('authenticated', 'public.ipas_summaries_for_sor(uuid)', 'execute') as authenticated`,
        )
        expect(rows[0]).toEqual({ anon: false, authenticated: true })
    })
})
