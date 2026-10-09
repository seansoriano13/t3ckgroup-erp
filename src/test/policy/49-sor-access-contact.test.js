/**
 * #474 — the prohibited screen's one fact: who the Deal Owner is.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor } from "./support/rows.js"

let sorId

beforeAll(async () => {
    await ensureCastLoaded()
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
})

afterAll(async () => {
    await serviceClient().from("sales_opportunities").delete().eq("id", sorId)
})

describe("sor_access_contact", () => {
    it("tells someone with no access only the Deal Owner's name", async () => {
        const c = await clientFor("outsider")
        expect((await c.rpc("sor_access_level", { p_opportunity_id: sorId })).data).toBe("none")
        const { data, error } = await c.rpc("sor_access_contact", { p_opportunity_id: sorId })
        expect(error).toBeNull()
        expect(data).toEqual([{ deal_owner_name: "Deal Owner" }])
    })

    it("returns nothing for an SOR that does not exist", async () => {
        const c = await clientFor("outsider")
        const { data } = await c.rpc("sor_access_contact", { p_opportunity_id: "00000000-0000-0000-0000-000000000000" })
        expect(data).toEqual([])
    })

    it("is closed to anonymous callers", async () => {
        const { error } = await anonymousClient().rpc("sor_access_contact", { p_opportunity_id: sorId })
        expect(error).not.toBeNull()
    })
})
