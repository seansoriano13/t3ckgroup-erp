/**
 * Code-review fixes for #209's Purchase Request functions: anon can't execute
 * the access helpers, Deal Team members (any side) and the Buyer may add items,
 * and the Buyer may add a substitute whatever their side.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const requests = []
const sors = []

async function newRequest(buyer, members) {
    const sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    sors.push(sorId)
    const { data, error } = await svc()
        .from("purchase_requests")
        .insert({ opportunity_id: sorId, created_by: ids.dealOwner, buyer_id: buyer ? ids[buyer] : null })
        .select("id")
        .single()
    if (error) throw new Error(error.message)
    requests.push(data.id)
    for (const [who, side] of members) {
        const r = await svc().from("purchase_request_members").insert({ request_id: data.id, employee_id: ids[who], side })
        if (r.error) throw new Error(r.error.message)
    }
    return data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
})

afterAll(async () => {
    if (requests.length) await svc().from("purchase_requests").delete().in("id", requests)
    if (sors.length) await svc().from("sales_opportunities").delete().in("id", sors)
})

describe("grants", () => {
    it("no #209 function is executable by anon or public", async () => {
        const { rows } = await sql().query(`
            select p.oid::regprocedure::text as fn,
                   has_function_privilege('anon', p.oid, 'execute') as anon,
                   has_function_privilege('authenticated', p.oid, 'execute') as authed
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname ~ '^(pr_|purchase_request|_purchase_request|_ipas_|sor_purchase_request|sor_open_purchase_request|is_purchase_request|can_read_purchase_request|has_purchasing_access|_employee_has_purchasing_access)'`)
        expect(rows.length).toBeGreaterThan(20)
        expect(rows.filter((r) => r.anon).map((r) => r.fn)).toEqual([])
        for (const fn of ["has_purchasing_access()", "is_purchase_request_member(uuid)", "can_read_purchase_request(uuid)"]) {
            expect(rows.find((r) => r.fn === fn)?.authed).toBe(true)
        }
    })
})

describe("who may add items", () => {
    it.each([
        ["a Deal Team member who also has Purchasing access", "dealOwner", "purchasing", null, true],
        ["a Deal Team member", "dealOwner", "sales", null, true],
        ["the Buyer, whatever their side", "hr", "other", "hr", true],
        ["a purchasing member who isn't on the Deal Team or the Buyer", "outsider", "purchasing", null, false],
    ])("%s: %s", async (_, who, side, buyer, can) => {
        const id = await newRequest(buyer, [[who, side]])
        const { data, error } = await (await clientFor(who)).rpc("purchase_request_can_add_items", { p_request_id: id })
        expect(error).toBeNull()
        expect(data).toBe(can)
    })
})

describe("who may add a substitute", () => {
    it.each([
        ["the Buyer on the other side", "hr", "other", "hr", true],
        ["the Buyer on the sales side", "dealOwner", "sales", "dealOwner", true],
        ["a purchasing member who isn't the Buyer", "outsider", "purchasing", null, false],
    ])("%s: %s", async (_, who, side, buyer, can) => {
        const id = await newRequest(buyer, [[who, side]])
        const { data, error } = await (await clientFor(who)).rpc("purchase_request_can_add_substitute", { p_request_id: id })
        expect(error).toBeNull()
        expect(data).toBe(can)
    })
})
