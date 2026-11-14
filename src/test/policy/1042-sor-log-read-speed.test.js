/**
 * SOR history read speed (#1042, spec #1031 tracker S1).
 *
 * `sales_opportunity_logs` for many SORs at once timed out for a Sales user because sor_log_read ran the
 * access functions per row. The fix keeps the answer and changes the shape (once per query). Stage-scoped
 * visibility (ADR 0021) is covered by 13/14/15; this file checks speed and that outsiders still get nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const BUDGET_MS = 5000
const COUNT = 15
let sorIds = []

beforeAll(async () => {
    await ensureCastLoaded()
    const svc = serviceClient()
    for (let i = 0; i < COUNT; i++) {
        const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
        sorIds.push(id)
        const rows = Array.from({ length: 10 }, (_, n) => ({
            opportunity_id: id,
            author_id: ids.dealOwner,
            type: "COMMENT",
            content: `${MARKER} log ${n}`,
        }))
        const { error } = await svc.from("sales_opportunity_logs").insert(rows)
        if (error) throw new Error(`Seeding logs: ${error.message}`)
    }
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("sales_opportunity_logs").delete().in("opportunity_id", sorIds)
    await svc.from("sales_opportunities").delete().in("id", sorIds)
})

describe("SOR history read as a Sales user (#1042)", () => {
    it("reads the logs of 15 SORs inside the statement timeout", async () => {
        const client = await clientFor("dealOwner")
        const started = Date.now()
        const { data, error } = await client.rpc("sor_logs_for_sors", { p_opportunity_ids: sorIds })
        const took = Date.now() - started
        expect(error).toBeNull()
        expect(took).toBeLessThan(BUDGET_MS)
        expect(data).toHaveLength(COUNT * 10)
    })

    it("still gives someone with no access none of the rows through the RPC", async () => {
        const client = await clientFor("outsider")
        const { data, error } = await client.rpc("sor_logs_for_sors", { p_opportunity_ids: sorIds })
        expect(error).toBeNull()
        expect(data).toEqual([])
    })
})
