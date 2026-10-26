/**
 * #506: every purchasing RPC answers to a `purchase_request_` name, and the
 * old `pr_*` names stay as thin aliases so an older frontend keeps working.
 * Nothing is dropped. The aliases must match their new name in signature,
 * security and grants, and give the same answers.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded, anonymousClient } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const NO_ID = "00000000-0000-0000-0000-000000000000"
const RENAMED = [
    "actor_side",
    "can_add_substitute",
    "set_item_status",
    "add_substitute",
    "take",
    "set_buyer",
    "item_po_lines",
    "pick_po_lines",
    "queue",
]
const requests = []
const sors = []
let requestId

async function insert(table, row) {
    const { data, error } = await svc().from(table).insert(row).select("id").single()
    if (error) throw new Error(`Seeding ${table}: ${error.message}`)
    return data.id
}

const newItem = () =>
    insert("purchase_request_items", {
        request_id: requestId,
        source: "new",
        name: `${MARKER} Shackle`,
        quantity: 1,
        requested_by: ids.dealOwner,
    })

beforeAll(async () => {
    await ensureCastLoaded()
    const sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sors.push(sorId)
    requestId = await insert("purchase_requests", { opportunity_id: sorId, created_by: ids.dealOwner })
    requests.push(requestId)
    await insert("purchase_request_members", { request_id: requestId, employee_id: ids.dealOwner, side: "sales" })
})

afterAll(async () => {
    if (requests.length) await svc().from("purchase_requests").delete().in("id", requests)
    if (sors.length) await svc().from("sales_opportunities").delete().in("id", sors)
})

describe("the catalog", () => {
    it.each(RENAMED)("pr_%s is a thin alias of purchase_request_%s", async (fn) => {
        const { rows } = await sql().query(
            `select p.proname, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as result,
                    p.provolatile, p.prosecdef, p.proconfig, p.prosrc,
                    has_function_privilege('anon', p.oid, 'execute') as anon,
                    has_function_privilege('authenticated', p.oid, 'execute') as authed
             from pg_proc p
             where p.pronamespace = 'public'::regnamespace and p.proname = any ($1)`,
            [[`pr_${fn}`, `purchase_request_${fn}`]],
        )
        const old = rows.find((r) => r.proname === `pr_${fn}`)
        const next = rows.find((r) => r.proname === `purchase_request_${fn}`)
        expect(rows).toHaveLength(2)
        for (const key of ["args", "result", "provolatile", "proconfig"]) expect(old[key]).toEqual(next[key])
        for (const r of [old, next]) expect([r.prosecdef, r.anon, r.authed]).toEqual([true, false, true])
        expect(old.prosrc).toContain(`public.purchase_request_${fn}(`)
    })
})

describe("old and new names answer alike", () => {
    it.each(["superAdmin", "dealOwner", "ordinary"])("for %s", async (who) => {
        const client = await clientFor(who)
        for (const fn of ["actor_side", "can_add_substitute", "queue"]) {
            const old = await client.rpc(`pr_${fn}`, { p_request_id: requestId })
            const next = await client.rpc(`purchase_request_${fn}`, { p_request_id: requestId })
            expect(old.error).toBeNull()
            expect(next.error).toBeNull()
            expect(old.data).toEqual(next.data)
        }
    })

    it.each([
        ["take", { p_request_id: NO_ID }],
        ["set_buyer", { p_request_id: NO_ID, p_employee_id: null }],
        ["set_item_status", { p_item_id: NO_ID, p_status: "cancelled" }],
        ["add_substitute", { p_item_id: NO_ID, p_name: "x", p_quantity: 1 }],
        ["item_po_lines", { p_item_id: NO_ID }],
        ["pick_po_lines", { p_item_id: NO_ID, p_line_ids: [1] }],
    ])("both names refuse %s alike", async (fn, args) => {
        const client = await clientFor("superAdmin")
        const old = await client.rpc(`pr_${fn}`, args)
        const next = await client.rpc(`purchase_request_${fn}`, args)
        expect(next.error).not.toBeNull()
        expect([old.error?.code, old.error?.message]).toEqual([next.error.code, next.error.message])
    })

    it("both names move an item", async () => {
        const client = await clientFor("superAdmin")
        const item = await newItem()
        const moved = await client.rpc("purchase_request_set_item_status", { p_item_id: item, p_status: "to_purchase" })
        expect(moved.error).toBeNull()
        expect(moved.data.status).toBe("to_purchase")
        const again = await client.rpc("pr_set_item_status", { p_item_id: item, p_status: "still_canvassing" })
        expect(again.error).toBeNull()
        expect(again.data.status).toBe("still_canvassing")
    })
})

describe("someone not signed in", () => {
    it.each(RENAMED.flatMap((fn) => [`pr_${fn}`, `purchase_request_${fn}`]))("cannot call %s", async (fn) => {
        const { error } = await anonymousClient().rpc(fn, { p_request_id: NO_ID })
        expect(error).not.toBeNull()
    })
})
