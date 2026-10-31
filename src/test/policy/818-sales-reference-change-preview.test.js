/**
 * Issue #818 (spec #800, ADR 0050) — `sales_reference_change_preview`: what changing or clearing the
 * S0 would do to the products, before it is saved. Read-only; the caller is a signed-in employee
 * who can read the SOR.
 *
 * The deal has four Odoo lines (L1..L4) and one typed line with no Odoo id. Every line has a
 * Requested Item (the request creates them); L3 has two Tender Lines, L1 and L2 one; L4 is already Removed from S0.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor } from "./support/rows.js"

const svc = () => serviceClient()
let sorId
let outsiderSorId
const lines = {}
let requestId
let matrixId

async function ok(promise, what) {
    const { data, error } = await promise
    if (error) throw new Error(`Seeding ${what}: ${error.message}`)
    return data
}

const LINE_IDS = { L1: 818001, L2: 818002, L3: 818003, L4: 818004 }

beforeAll(async () => {
    await ensureCastLoaded()
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    outsiderSorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })

    const rows = [
        { key: "L1", odoo_line_id: LINE_IDS.L1 },
        { key: "L2", odoo_line_id: LINE_IDS.L2 },
        { key: "L3", odoo_line_id: LINE_IDS.L3 },
        { key: "L4", odoo_line_id: LINE_IDS.L4, removed_from_s0: true },
        { key: "TYPED", odoo_line_id: null },
    ]
    for (const [i, r] of rows.entries()) {
        const row = await ok(
            svc()
                .from("sales_opportunity_items")
                .insert({
                    opportunity_id: sorId,
                    product_name: `818 ${r.key}`,
                    unit: "pc",
                    quantity: 1,
                    unit_price: 100,
                    sort_order: i,
                    odoo_line_id: r.odoo_line_id,
                    removed_from_s0: r.removed_from_s0 ?? false,
                })
                .select("id")
                .single(),
            `line ${r.key}`,
        )
        lines[r.key] = row.id
    }

    const request = await ok(svc().from("purchase_requests").insert({ opportunity_id: sorId, created_by: ids.dealOwner }).select("id").single(), "Purchase Request")
    requestId = request.id
    // Creating the request puts one Requested Item on every line of the SOR (the sync, #678).

    const matrix = await ok(svc().from("costing_matrices").insert({ opportunity_id: sorId }).select("id").single(), "matrix")
    matrixId = matrix.id
    const tender = (sorItemId, position) => ({ matrix_id: matrixId, position, tender_specification: `818 t${position}`, sor_item_id: sorItemId })
    await ok(svc().from("costing_tender_lines").insert([tender(lines.L1, 1), tender(lines.L2, 2), tender(lines.L3, 3), tender(lines.L3, 4), tender(null, 5)]), "Tender Lines")
})

afterAll(async () => {
    const s = svc()
    await s.from("costing_matrices").delete().eq("id", matrixId)
    await s.from("purchase_requests").delete().eq("id", requestId)
    await s.from("sales_opportunity_items").delete().eq("opportunity_id", sorId)
    await s.from("sales_opportunities").delete().in("id", [sorId, outsiderSorId])
})

const preview = async (who, sor, newIds) =>
    (await clientFor(who)).rpc("sales_reference_change_preview", { p_opportunity_id: sor, p_new_odoo_line_ids: newIds })

async function snapshot() {
    const [items, reqItems, tender] = await Promise.all([
        svc().from("sales_opportunity_items").select("id, removed_from_s0, odoo_line_id").eq("opportunity_id", sorId).order("id"),
        svc().from("purchase_request_items").select("id, sor_item_id").eq("request_id", requestId).order("id"),
        svc().from("costing_tender_lines").select("id, sor_item_id").eq("matrix_id", matrixId).order("id"),
    ])
    return JSON.stringify([items.data, reqItems.data, tender.data])
}

describe("sales_reference_change_preview", () => {
    it("counts the products that would be removed and what sits on them", async () => {
        // New S0 keeps L1 and L4 (L4 is already removed, so it never counts): L2 and L3 would be removed.
        const { data, error } = await preview("dealOwner", sorId, [String(LINE_IDS.L1), String(LINE_IDS.L4), "999999"])
        expect(error).toBeNull()
        expect(data).toEqual({ removed_products: 2, requested_items: 2, tender_lines: 3 })
    })

    it("counts everything Odoo-sourced when the S0 is cleared, and nothing for the typed line", async () => {
        const cleared = await preview("dealOwner", sorId, [])
        expect(cleared.data).toEqual({ removed_products: 3, requested_items: 3, tender_lines: 4 })
        const nothing = await preview("dealOwner", sorId, null)
        expect(nothing.data).toEqual(cleared.data)
    })

    it("is all zeros when the new S0 has every current line", async () => {
        const { data } = await preview("dealOwner", sorId, Object.values(LINE_IDS).map(String))
        expect(data).toEqual({ removed_products: 0, requested_items: 0, tender_lines: 0 })
    })

    it("changes nothing", async () => {
        const before = await snapshot()
        await preview("dealOwner", sorId, [])
        await preview("dealOwner", sorId, [String(LINE_IDS.L1)])
        expect(await snapshot()).toBe(before)
    })

    it("refuses a caller who cannot read the SOR", async () => {
        const { data, error } = await preview("outsider", sorId, [])
        expect(data).toBeNull()
        expect(error).not.toBeNull()
    })
})
