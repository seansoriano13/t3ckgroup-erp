/**
 * A mention on any SOR lets the mentioned person open it read-only.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { makeSor, MARKER } from "./support/rows.js"

let oldSor, scopedSor, saleTypeId, flowId, stageId

beforeAll(async () => {
    await ensureCastLoaded()
    const svc = serviceClient()
    oldSor = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })

    // A real flow stage, so inserting the SOR on it records a Stage Visit
    // (the second SOR is Stage-scoped).
    const st = await svc.from("sale_types").insert({ name: `${MARKER} Mention Grant Sale Type` }).select("id").single()
    if (st.error) throw new Error(st.error.message)
    saleTypeId = st.data.id
    const flow = await svc.from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()
    if (flow.error) throw new Error(flow.error.message)
    flowId = flow.data.id
    const stage = await svc.from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Stage`, sort_order: 10 }).select("id").single()
    if (stage.error) throw new Error(stage.error.message)
    stageId = stage.data.id
    scopedSor = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    const { data: visits } = await svc.from("sor_stage_visits").select("id").eq("opportunity_id", scopedSor)
    if (!visits?.length) throw new Error("fixture: the Stage-scoped SOR recorded no Stage Visit")
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("sor_mention_viewers").delete().in("opportunity_id", [oldSor, scopedSor])
    await svc.from("sales_opportunities").delete().in("id", [oldSor, scopedSor])
    await svc.from("flow_stages").delete().eq("id", stageId)
    await svc.from("sales_flows").delete().eq("id", flowId)
    await svc.from("sale_types").delete().eq("id", saleTypeId)
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

    it("a Stage-scoped SOR grants the same read-only access, never Stage Visit data", async () => {
        const owner = await clientFor("dealOwner")
        const { error } = await owner.rpc("sor_grant_mention_view", { p_opportunity_id: scopedSor, p_employee_ids: [ids.ordinary] })
        expect(error).toBeNull()
        const c = await clientFor("ordinary")
        expect(await access(c, scopedSor)).toBe("participant")
        const direct = await c.from("sales_opportunities").select("id").eq("id", scopedSor)
        expect(direct.data?.length ?? 0).toBe(0)
    })

    it("someone who already reaches the SOR gets no grant row", async () => {
        const owner = await clientFor("dealOwner")
        await owner.rpc("sor_grant_mention_view", { p_opportunity_id: oldSor, p_employee_ids: [ids.dealOwner, ids.superAdmin] })
        const { data } = await serviceClient().from("sor_mention_viewers").select("employee_id").eq("opportunity_id", oldSor)
        const got = (data || []).map((r) => r.employee_id)
        expect(got).not.toContain(ids.dealOwner)
        expect(got).not.toContain(ids.superAdmin)
    })
})
