/**
 * Where an SOR's orders stand (#265, spec #261): the database rules.
 *
 * `ipas_standing_for_sor(opportunity_id)` gives whoever can read an SOR the dates
 * and Transmittal facts its IPAS section needs to say where each order stands.
 * It has the same gate as `ipas_summaries_for_sor` (`sor_access_level = 'full'`)
 * and carries no money or bank column. Someone who cannot read the SOR gets no
 * rows. `ipas_summaries_for_sor` itself is untouched; file 63 holds its key set.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, FIXTURE_DOMAIN, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor } from "./support/rows.js"
import { purgeFixtureIpas } from "./support/ipas.js"

const svc = () => serviceClient()
const PO = "P9960001"

const KEYS = [
    "actual_checking_at", "actual_checking_stamped", "arrived_in_ph_on", "arrived_in_whs_on", "costs_completed_at",
    "created_at", "delivered_on", "import_clearance_on", "ipas_id", "onboard_on", "proof_paid_on", "shipped_out_on",
    "slips", "source", "updated_at",
]

const standing = async (who, sorId) => {
    const { data, error } = await (await clientFor(who)).rpc("ipas_standing_for_sor", { p_opportunity_id: sorId })
    if (error) throw new Error(`ipas_standing_for_sor as ${who}: ${error.message}`)
    return data
}

const levelOf = async (who, sorId) => {
    const { data, error } = await (await clientFor(who)).rpc("sor_access_level", { p_opportunity_id: sorId })
    if (error) throw new Error(`sor_access_level as ${who}: ${error.message}`)
    return data
}

let sor, ipas

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
    if (flag.error) throw flag.error
    sor = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    const { data, error } = await (await clientFor("outsider")).rpc("ipas_create", {
        p_po_number: PO,
        p_priority: "high",
        p_source: "local",
        p_purpose: "project",
        p_sor_ids: [sor],
        p_remarks: null,
        p_odoo_copy: {
            po: { id: 759601, name: PO, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
            supplier: { id: 9_600_001, name: "Standing Supplier", contact: null },
            lines: [{ line_id: 789601, product_id: 7300, name: "Rope", quantity: 4, unit: "Unit", price_unit: 900, price_subtotal: 3600, taxes: [], analytic: [], brand: null }],
            receipts: { status: "pending", done: 0, total: 1 },
            bills: { count: 0, draft: 0 },
        },
    })
    if (error) throw new Error(`ipas_create: ${error.message}`)
    ipas = data
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)
    await svc().from("sales_opportunities").delete().in("id", [sor].filter(Boolean))
})

describe("the standing facts of an SOR's IPAS", () => {
    it("gives a Deal Team member with no flags a row with exactly the agreed key set, no money or bank column", async () => {
        const rows = await standing("dealOwner", sor)

        expect(rows.map((row) => row.ipas_id)).toEqual([ipas.id])
        expect(Object.keys(rows[0]).sort()).toEqual(KEYS)
        expect(rows[0].slips).toEqual([])
    })

    it("gives a row to exactly those who read the SOR in full, across the cast", async () => {
        const seen = { withRows: 0, without: 0 }
        for (const who of CAST_KEYS) {
            const level = await levelOf(who, sor)
            const rows = await standing(who, sor)
            if (level === "full") {
                expect(rows.length, `${who} reads the SOR in full and got no row`).toBe(1)
                seen.withRows += 1
            } else {
                expect(rows, `${who} (${level}) was given a row`).toEqual([])
                seen.without += 1
            }
        }
        expect(seen.withRows).toBeGreaterThan(0)
        expect(seen.without).toBeGreaterThan(0)
    })

    it("gives someone who cannot read the SOR no rows, whatever else they hold", async () => {
        expect(await levelOf("ordinary", sor)).toBe("none")
        expect(await standing("ordinary", sor)).toEqual([])
        expect(await standing("outsider", sor)).toEqual([]) // Purchasing access alone is not SOR access
    })
})
