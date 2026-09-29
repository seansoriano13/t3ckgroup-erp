/**
 * Issue #413 (found in #401, parent #384) — certifying a tickbox condition
 * used to resolve "the current visit" and write the satisfaction as two
 * separate client requests. A Revert landing between them moved the SOR off
 * the Stage in between, and the write still landed — stamped with a visit
 * that had already closed. `sor_certify_condition` does both in one
 * transaction and refuses outright once the SOR has left the condition's
 * own Stage.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

let saleTypeId, flowId, stageA, stageB, conditionA
const sorIds = []
const conditionIds = []
const svc = () => serviceClient()

async function stage(name, sortOrder) {
    const { data, error } = await svc()
        .from("flow_stages")
        .insert({ flow_id: flowId, name: `${MARKER} ${name}`, sort_order: sortOrder })
        .select("id")
        .single()
    if (error) throw new Error(error.message)
    return data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    saleTypeId = (await svc().from("sale_types").insert({ name: `${MARKER} CertifyVisit` }).select("id").single()).data.id
    flowId = (await svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()).data.id
    stageA = await stage("A", 10)
    stageB = await stage("B", 20)
    const cond = await svc().from("stage_conditions").insert({ stage_id: stageA, kind: "tickbox", label: `${MARKER} ok` }).select("id").single()
    if (cond.error) throw new Error(cond.error.message)
    conditionA = cond.data.id
    conditionIds.push(conditionA)
})

afterAll(async () => {
    await svc().from("sor_condition_status").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("stage_conditions").delete().in("id", conditionIds)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

async function moveTo(sorId, stageId, who = "dealOwner") {
    const client = await clientFor(who)
    const { error } = await client.from("sales_opportunities").update({ flow_stage_id: stageId }).eq("id", sorId)
    if (error) throw new Error(error.message)
}

describe("sor_certify_condition", () => {
    it("satisfies a tickbox condition on the SOR's current visit, recording who and when", async () => {
        const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageA })
        sorIds.push(id)
        const visit = (await svc().from("sor_stage_visits").select("id").eq("opportunity_id", id).single()).data.id

        const client = await clientFor("dealOwner")
        const { data, error } = await client.rpc("sor_certify_condition", {
            p_opportunity_id: id, p_condition_id: conditionA, p_stage_id: stageA, p_actor_id: ids.dealOwner,
        })
        expect(error).toBeNull()
        const row = data[0]
        expect(row.satisfied_by).toBe(ids.dealOwner)
        expect(row.satisfied_at).toBeTruthy()
        expect(row.stage_visit_id).toBe(visit)
        expect(row.was_new).toBe(true)
    })

    it("is idempotent — certifying an already-satisfied condition again keeps the original satisfier", async () => {
        const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageA })
        sorIds.push(id)
        const client = await clientFor("dealOwner")
        const other = await clientFor("closingSales")

        const first = await client.rpc("sor_certify_condition", {
            p_opportunity_id: id, p_condition_id: conditionA, p_stage_id: stageA, p_actor_id: ids.dealOwner,
        })
        expect(first.error).toBeNull()

        const second = await other.rpc("sor_certify_condition", {
            p_opportunity_id: id, p_condition_id: conditionA, p_stage_id: stageA, p_actor_id: ids.closingSales,
        })
        expect(second.error).toBeNull()
        expect(second.data[0].id).toBe(first.data[0].id)
        expect(second.data[0].satisfied_by).toBe(ids.dealOwner)
        expect(second.data[0].was_new).toBe(false)
    })

    it("issue #413: refuses once the SOR has left the condition's own Stage", async () => {
        const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageA })
        sorIds.push(id)
        await moveTo(id, stageB)

        const client = await clientFor("dealOwner")
        const { error } = await client.rpc("sor_certify_condition", {
            p_opportunity_id: id, p_condition_id: conditionA, p_stage_id: stageA, p_actor_id: ids.dealOwner,
        })
        expect(error?.message).toMatch(/left this condition's Stage/)

        const rows = await svc().from("sor_condition_status").select("id").eq("opportunity_id", id).eq("condition_id", conditionA)
        expect(rows.data).toEqual([])
    })

    it("scopes to a fresh visit after a loop back — an earlier certify on the same Stage doesn't count again", async () => {
        const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageA })
        sorIds.push(id)
        const visit1 = (await svc().from("sor_stage_visits").select("id").eq("opportunity_id", id).single()).data.id
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_certify_condition", {
            p_opportunity_id: id, p_condition_id: conditionA, p_stage_id: stageA, p_actor_id: ids.dealOwner,
        })).error).toBeNull()

        await moveTo(id, stageB)
        await moveTo(id, stageA)
        const visit3 = (await svc().from("sor_stage_visits").select("id").eq("opportunity_id", id).order("sequence", { ascending: false }).limit(1).single()).data.id
        expect(visit3).not.toBe(visit1)

        const { data, error } = await client.rpc("sor_certify_condition", {
            p_opportunity_id: id, p_condition_id: conditionA, p_stage_id: stageA, p_actor_id: ids.dealOwner,
        })
        expect(error).toBeNull()
        expect(data[0].was_new).toBe(true)
        expect(data[0].stage_visit_id).toBe(visit3)

        const rows = await svc().from("sor_condition_status").select("stage_visit_id").eq("opportunity_id", id).eq("condition_id", conditionA)
        expect(rows.data.map((r) => r.stage_visit_id).sort()).toEqual([visit1, visit3].sort())
    })

    it("keeps the opportunity-wide read for a legacy pipeline deal with no Stage", async () => {
        // sales_opportunities_flow_pairing_chk requires sale_type_id and
        // flow_stage_id to be null together — a genuinely legacy deal has neither.
        const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId: null, flowStageId: null })
        sorIds.push(id)
        const client = await clientFor("dealOwner")
        const { data, error } = await client.rpc("sor_certify_condition", {
            p_opportunity_id: id, p_condition_id: conditionA, p_stage_id: stageA, p_actor_id: ids.dealOwner,
        })
        expect(error).toBeNull()
        expect(data[0].stage_visit_id).toBeNull()
        expect(data[0].was_new).toBe(true)
    })
})
