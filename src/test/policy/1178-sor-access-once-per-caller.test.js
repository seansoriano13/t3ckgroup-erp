/**
 * SOR access worked out once per caller (#1178, Bugsink T3CKGROUP-ERP-2).
 *
 * The SORs list asks sor_logs_for_sors about every open SOR. It timed out on prod for a Finance Assistant
 * (324 SORs) because the rule functions looked the caller up again for every SOR and every Stage Visit.
 * The rules now take the caller from one lookup. Who sees what is unchanged (13/14/15 and 1042 cover the
 * rules); this file checks a long list and that the private helpers stay private.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const BUDGET_MS = 5000
const COUNT = 150
let sorIds = []

beforeAll(async () => {
    await ensureCastLoaded()
    const svc = serviceClient()
    for (let i = 0; i < COUNT; i++) {
        sorIds.push(await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner }))
    }
    const rows = sorIds.flatMap((id) =>
        Array.from({ length: 3 }, (_, n) => ({
            opportunity_id: id,
            author_id: ids.dealOwner,
            type: "COMMENT",
            content: `${MARKER} log ${n}`,
        })),
    )
    const { error } = await svc.from("sales_opportunity_logs").insert(rows)
    if (error) throw new Error(`Seeding logs: ${error.message}`)
}, 300_000)

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("sales_opportunity_logs").delete().in("opportunity_id", sorIds)
    await svc.from("sales_opportunities").delete().in("id", sorIds)
})

describe("SOR history for a long list (#1178)", () => {
    it("reads the logs of 150 SORs inside the budget", async () => {
        const client = await clientFor("dealOwner")
        const started = Date.now()
        const { data, error } = await client.rpc("sor_logs_for_sors", { p_opportunity_ids: sorIds })
        const took = Date.now() - started
        expect(error).toBeNull()
        expect(took).toBeLessThan(BUDGET_MS)
        expect(data).toHaveLength(COUNT * 3)
    })

    it("gives someone with no access none of the 150 SORs' rows", async () => {
        const client = await clientFor("outsider")
        const { data, error } = await client.rpc("sor_logs_for_sors", { p_opportunity_ids: sorIds })
        expect(error).toBeNull()
        expect(data).toEqual([])
    })

    it("still answers the single-SOR rules the same way", async () => {
        const owner = await clientFor("dealOwner")
        const outsider = await clientFor("outsider")
        const mine = await owner.rpc("sor_access_level", { p_opportunity_id: sorIds[0] })
        const theirs = await outsider.rpc("sor_access_level", { p_opportunity_id: sorIds[0] })
        expect(mine.error).toBeNull()
        expect(mine.data).toBe("full")
        expect(theirs.error).toBeNull()
        expect(theirs.data).toBe("none")
    })
})

describe("the private helpers stay private (#1178)", () => {
    // They trust the employee id they are given, so a signed-in user calling them could pose as anyone.
    it("refuses _sor_access_level_as to a signed-in user", async () => {
        const client = await clientFor("outsider")
        const { data, error } = await client.rpc("_sor_access_level_as", {
            p_opportunity_id: sorIds[0],
            p_employee_id: ids.dealOwner,
            p_is_super_admin: true,
            p_costing_lister: null,
        })
        expect(error).not.toBeNull()
        expect(data).toBeNull()
    })

    it("refuses _sor_visible_visit_ids_as to a signed-in user", async () => {
        const client = await clientFor("outsider")
        const { data, error } = await client.rpc("_sor_visible_visit_ids_as", {
            p_opportunity_id: sorIds[0],
            p_employee_id: ids.dealOwner,
            p_is_super_admin: true,
        })
        expect(error).not.toBeNull()
        expect(data).toBeNull()
    })
})
