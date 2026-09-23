/**
 * SOR S07229 (High Angle Rescue Safety Equipment) had its Product List — and
 * therefore its Estimated Value — silently double on 2026-09-23, with no
 * corresponding change in Odoo. Cause: SorModal auto-syncs an SOR's items
 * from Odoo on every open (issue #53), and `opportunityService.replaceItems`
 * used to do that as two separate, unsynchronized round trips — DELETE all
 * items, then INSERT the freshly pulled ones — with nothing locking the row
 * in between. Two overlapping opens (two tabs, or two people both checking a
 * large active deal) could interleave as delete_A, delete_B (no-op, already
 * empty), insert_A, insert_B: both inserts land, doubling the rows and
 * therefore `sor_recalc_expected_value`'s sum.
 *
 * `sor_replace_items` (20260929030000_atomic_sor_items_replace.sql) fixes
 * this by taking `FOR UPDATE` on the parent sales_opportunities row before
 * doing the delete+insert, inside one function call. This is invisible to
 * the fake database (a plpgsql function, and real Postgres row locking), so
 * it can only be proven here, against the real thing, by actually racing two
 * concurrent replaces against the same SOR and checking that the loser's
 * rows never coexist with the winner's — not merely that a single call
 * behaves.
 *
 * Fallout from that fix (20260929040000_sor_replace_items_returns_previous.sql):
 * expected_value stopped doubling, but the timeline started logging "Added
 * product(s): <the whole list>" on *every* open, forever, for some
 * employees — reproduced live: never for a Super Admin, always for an
 * ordinary one. Cause: opportunityService.updateOpportunity built its
 * "before" snapshot with a plain select on sales_opportunity_items, gated by
 * sor_items_read (super admin, deal team, always_sees, or HR) — narrower
 * than sor_can_edit_opportunity (deal team, or is_head, or super admin),
 * the check sor_replace_items itself uses to authorize the write. A
 * department head who can edit a deal only via is_head — not personally on
 * its team — passes the write check but the read policy silently returns
 * zero rows for them, so every product looks newly added, every time.
 * sor_replace_items now returns the rows it deleted, captured inside the
 * same SECURITY DEFINER call that already bypasses RLS to perform the
 * write, so the caller's own read access no longer matters for the diff log.
 *
 * That RPC-return workaround didn't fix the Product List's actual on-screen
 * display, though — ItemsTab and everything else that renders it still read
 * sales_opportunity_items with a plain select, so the same is_head-only
 * editor who could edit fine still saw an empty list rendered, even though
 * the row was really there (reproduced live: Super Admin sees it, an
 * ordinary employee opening the identical SOR doesn't).
 * 20260929050000_sor_items_read_matches_edit.sql widens sor_items_read
 * itself to grant read access to anyone sor_can_edit_opportunity already
 * lets write — the two were never supposed to diverge — so a plain select
 * now works for that same editor directly, no RPC detour required.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

let sorId

beforeAll(async () => {
    await ensureCastLoaded()
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, supportSales1Id: ids.support })
})

afterAll(async () => {
    if (sorId) await serviceClient().from("sales_opportunities").delete().eq("id", sorId)
})

describe("sor_replace_items — atomic Product List replace", () => {
    it("a single call replaces the set and expected_value matches its own total, not a sum with the prior set", async () => {
        const dealOwner = await clientFor("dealOwner")

        const first = await dealOwner.rpc("sor_replace_items", {
            p_opportunity_id: sorId,
            p_items: [{ product_name: `${MARKER} Full Body Harness`, unit: "pc", quantity: 10, unit_price: 59981.03 }],
        })
        expect(first.error).toBeNull()

        const second = await dealOwner.rpc("sor_replace_items", {
            p_opportunity_id: sorId,
            p_items: [{ product_name: `${MARKER} Rope Access Kit`, unit: "set", quantity: 2, unit_price: 300000 }],
        })
        expect(second.error).toBeNull()

        const { data: items, error: itemsError } = await serviceClient()
            .from("sales_opportunity_items")
            .select("product_name, quantity, unit_price")
            .eq("opportunity_id", sorId)
        expect(itemsError).toBeNull()
        expect(items).toHaveLength(1)
        expect(items[0].product_name).toBe(`${MARKER} Rope Access Kit`)

        const { data: sor, error: sorError } = await serviceClient()
            .from("sales_opportunities")
            .select("expected_value")
            .eq("id", sorId)
            .single()
        expect(sorError).toBeNull()
        expect(Number(sor.expected_value)).toBe(600000)
    })

    it("two concurrent replaces (simulating two overlapping opens) serialize into exactly one winner's set — never both", async () => {
        const dealOwner = await clientFor("dealOwner")
        const support = await clientFor("support")

        const payloadA = [
            { product_name: `${MARKER} Harness A`, unit: "pc", quantity: 10, unit_price: 59981.03 },
            { product_name: `${MARKER} Kit A`, unit: "set", quantity: 2, unit_price: 300000 },
        ]
        const totalA = 10 * 59981.03 + 2 * 300000
        const payloadB = [{ product_name: `${MARKER} Solo Line B`, unit: "pc", quantity: 3, unit_price: 45000 }]
        const totalB = 3 * 45000

        const [resultA, resultB] = await Promise.all([
            dealOwner.rpc("sor_replace_items", { p_opportunity_id: sorId, p_items: payloadA }),
            support.rpc("sor_replace_items", { p_opportunity_id: sorId, p_items: payloadB }),
        ])
        expect(resultA.error).toBeNull()
        expect(resultB.error).toBeNull()

        const { data: items, error: itemsError } = await serviceClient()
            .from("sales_opportunity_items")
            .select("product_name")
            .eq("opportunity_id", sorId)
        expect(itemsError).toBeNull()

        const { data: sor, error: sorError } = await serviceClient()
            .from("sales_opportunities")
            .select("expected_value")
            .eq("id", sorId)
            .single()
        expect(sorError).toBeNull()

        // Whichever call's lock acquisition ran last wins — that set is the
        // one left standing, cleanly, with no trace of the other.
        const wonA = items.length === payloadA.length && Number(sor.expected_value) === totalA
        const wonB = items.length === payloadB.length && Number(sor.expected_value) === totalB
        expect(wonA || wonB).toBe(true)

        // The bug this test exists to catch: both calls' inserts landing on
        // top of each other, doubling the rows and the total.
        expect(items.length).not.toBe(payloadA.length + payloadB.length)
        expect(Number(sor.expected_value)).not.toBe(totalA + totalB)
    })
})

describe("sor_replace_items — the returned 'before' snapshot bypasses sor_items_read", () => {
    let editOnlySorId

    beforeAll(async () => {
        // `head` deliberately left off every deal-team column: their only
        // route to editing this record is sor_can_edit_opportunity's is_head
        // clause, which sor_items_read does not grant read access through.
        editOnlySorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
        const seeded = await serviceClient()
            .from("sales_opportunity_items")
            .insert({
                opportunity_id: editOnlySorId,
                product_name: `${MARKER} Pre-existing Line`,
                unit: "pc",
                quantity: 1,
                unit_price: 500,
            })
        if (seeded.error) throw new Error(`Seeding a pre-existing item: ${seeded.error.message}`)
    })

    afterAll(async () => {
        if (editOnlySorId) await serviceClient().from("sales_opportunities").delete().eq("id", editOnlySorId)
    })

    it("a plain select on sales_opportunity_items now works for an is_head-only editor too", async () => {
        const head = await clientFor("head")
        const { data, error } = await head
            .from("sales_opportunity_items")
            .select("product_name")
            .eq("opportunity_id", editOnlySorId)
        expect(error).toBeNull()
        expect(data).toEqual([{ product_name: `${MARKER} Pre-existing Line` }])
    })

    it("and sor_replace_items still hands that same editor the true previous row directly, not an empty list", async () => {
        const head = await clientFor("head")
        const { data, error } = await head.rpc("sor_replace_items", {
            p_opportunity_id: editOnlySorId,
            p_items: [{ product_name: `${MARKER} Pre-existing Line`, unit: "pc", quantity: 1, unit_price: 500 }],
        })
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
        expect(data[0].product_name).toBe(`${MARKER} Pre-existing Line`)
    })
})
