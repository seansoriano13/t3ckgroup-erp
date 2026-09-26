/**
 * Issue #385 (parent #384) — an action run can be closed off, and fire-once is
 * enforced among live runs only.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

let sorId
let saleTypeId
let flowId
let stageId
let actionId

const begin = () =>
    serviceClient().rpc("sor_begin_action_run", { p_opportunity_id: sorId, p_stage_id: stageId, p_action_id: actionId })

beforeAll(async () => {
    await ensureCastLoaded()
    const svc = serviceClient()
    const saleType = await svc.from("sale_types").insert({ name: `${MARKER} Closed-off runs` }).select("id").single()
    if (saleType.error) throw new Error(saleType.error.message)
    saleTypeId = saleType.data.id
    const flow = await svc.from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()
    if (flow.error) throw new Error(flow.error.message)
    flowId = flow.data.id
    const stage = await svc
        .from("flow_stages")
        .insert({ flow_id: flowId, name: `${MARKER} Stage`, sort_order: 1, is_terminal: false })
        .select("id")
        .single()
    if (stage.error) throw new Error(stage.error.message)
    stageId = stage.data.id
    const action = await svc.from("flow_stage_actions").insert({ stage_id: stageId, kind: "create_individual_task" }).select("id").single()
    if (action.error) throw new Error(`Seeding an Action: ${action.error.message}`)
    actionId = action.data.id
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("sor_action_runs").delete().eq("opportunity_id", sorId)
    await svc.from("sales_opportunities").delete().eq("id", sorId)
    await svc.from("flow_stage_actions").delete().eq("id", actionId)
    await svc.from("flow_stages").delete().eq("id", stageId)
    await svc.from("sales_flows").delete().eq("id", flowId)
    await svc.from("sale_types").delete().eq("id", saleTypeId)
})

describe("action run fire-once among live runs", () => {
    it("a run starts live, and beginning again returns the same live run", async () => {
        const first = await begin()
        expect(first.error).toBeNull()
        expect(first.data.closed_off_at).toBeNull()
        const again = await begin()
        expect(again.data.id).toBe(first.data.id)
    })

    it("two live runs cannot coexist", async () => {
        const { error } = await serviceClient()
            .from("sor_action_runs")
            .insert({ opportunity_id: sorId, stage_id: stageId, action_id: actionId })
        expect(error?.code).toBe("23505")
    })

    it("a closed-off run lets a new one begin, and records when and why", async () => {
        const svc = serviceClient()
        const live = (await begin()).data
        const closed = await svc
            .from("sor_action_runs")
            .update({ closed_off_at: new Date().toISOString(), closed_off_reason: "start_fresh" })
            .eq("id", live.id)
            .select("closed_off_at, closed_off_reason")
            .single()
        expect(closed.data.closed_off_reason).toBe("start_fresh")
        expect(closed.data.closed_off_at).not.toBeNull()

        const next = await begin()
        expect(next.error).toBeNull()
        expect(next.data.id).not.toBe(live.id)
        expect(next.data.closed_off_at).toBeNull()
        expect((await begin()).data.id).toBe(next.data.id)
    })
})
