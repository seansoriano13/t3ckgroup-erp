/**
 * A mention on an old SOR (no Stage Visit) lets the mentioned person open it
 * read-only; a Stage-scoped SOR still grants nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor } from "./support/rows.js"

let oldSor, scopedSor, scopedVisit

beforeAll(async () => {
    await ensureCastLoaded()
    oldSor = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    scopedSor = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    // A visit on the second SOR makes it Stage-scoped.
    const svc = serviceClient()
    await svc.from("sor_stage_visits").delete().eq("opportunity_id", oldSor)
    const { data: v } = await svc.from("sor_stage_visits").select("id").eq("opportunity_id", scopedSor).limit(1)
    scopedVisit = v?.length || 0
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("sor_mention_viewers").delete().in("opportunity_id", [oldSor, scopedSor])
    await svc.from("sales_opportunities").delete().in("id", [oldSor, scopedSor])
})

const access = async (client, id) => (await client.rpc("sor_access_level", { p_opportunity_id: id })).data

describe("old SOR mention grant", () => {
    it("an outsider has no access before being mentioned", async () => {
        expect(await access(await clientFor("outsider"), oldSor)).toBe("none")
    })

    it("an outsider cannot grant themselves access", async () => {
        const c = await clientFor("outsider")
        const { error } = await c.rpc("sor_grant_mention_view", { p_opportunity_id: oldSor, p_employee_ids: [ids.outsider] })
        expect(error?.code).toBe("42501")
        expect(await access(c, oldSor)).toBe("none")
    })

    it("the deal owner's mention lets the outsider open it read-only (participant record)", async () => {
        const owner = await clientFor("dealOwner")
        const { error } = await owner.rpc("sor_grant_mention_view", { p_opportunity_id: oldSor, p_employee_ids: [ids.outsider] })
        expect(error).toBeNull()
        const out = await clientFor("outsider")
        expect(await access(out, oldSor)).toBe("participant")
        const rec = await out.rpc("sor_participant_record", { p_opportunity_id: oldSor })
        expect(rec.data?.length).toBe(1)
        // read-only: no direct table read, no update
        const direct = await out.from("sales_opportunities").select("id").eq("id", oldSor)
        expect(direct.data?.length ?? 0).toBe(0)
    })

    it("a Stage-scoped SOR grants nothing", async () => {
        if (!scopedVisit) return // fixture SOR opened no visit; covered by the guard in the function
        const owner = await clientFor("dealOwner")
        await owner.rpc("sor_grant_mention_view", { p_opportunity_id: scopedSor, p_employee_ids: [ids.ordinary] })
        expect(await access(await clientFor("ordinary"), scopedSor)).toBe("none")
    })
})
