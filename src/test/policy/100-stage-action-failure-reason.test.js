/**
 * Issue #896 — a Stage Action that fails says why. sor_run_stage_actions
 * (supabase/migrations/20261121050003_896_stage_action_failure_reason.sql):
 *
 *   - a Group Task whose member is no longer an employee fails with
 *     "member no longer exists", not a foreign-key error;
 *   - the run row keeps that reason in failure_reason;
 *   - the call returns it in failed_reasons, beside the failed names.
 *
 * The fake database re-implements this in src/test/stubs/actionRunRpc.js; this
 * test is the one that proves the plpgsql itself.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { randomUUID } from "crypto"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

let saleTypeId, flowId, stageId, actionId
const sorIds = []
const svc = () => serviceClient()

beforeAll(async () => {
    await ensureCastLoaded()
    saleTypeId = (await svc().from("sale_types").insert({ name: `${MARKER} ActionFailureReason` }).select("id").single()).data.id
    flowId = (await svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()).data.id
    stageId = (await svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Stage`, sort_order: 10 }).select("id").single()).data.id
    actionId = (
        await svc()
            .from("flow_stage_actions")
            .insert({ stage_id: stageId, kind: "create_group_task", config: { title: "DELCOM - Kickoff" }, sort_order: 0 })
            .select("id")
            .single()
    ).data.id
})

afterAll(async () => {
    await svc().from("committee_tasks").delete().in("opportunity_id", sorIds)
    await svc().from("sor_action_runs").delete().in("opportunity_id", sorIds)
    await svc().from("system_audit_logs").delete().in("entity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stage_actions").delete().eq("id", actionId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("sor_run_stage_actions: a failed Group Task says why (#896)", () => {
    it("fails a Group Task whose member was deleted, with the reason on the run and in failed_reasons", async () => {
        const sorId = await makeSor({
            registeredBy: ids.dealOwner,
            dealOwnerId: ids.dealOwner,
            saleTypeId,
            flowStageId: stageId,
        })
        sorIds.push(sorId)
        const goneEmployee = randomUUID() // no employees row has this id

        const client = await clientFor("dealOwner")
        const { data, error } = await client.rpc("sor_run_stage_actions", {
            p_opportunity_id: sorId,
            p_stage_id: stageId,
            p_stage_visit_id: null,
            p_actions: [
                {
                    action_id: actionId,
                    kind: "create_group_task",
                    name: "DELCOM - Kickoff",
                    confirm: false,
                    group_title: "DELCOM - Kickoff",
                    group_description: "",
                    members: [{ employee_id: goneEmployee, task_description: "Check", role: null, custom_role: null, checklist: null }],
                },
            ],
        })
        expect(error).toBeNull()

        expect(data.failed).toEqual(["DELCOM - Kickoff"])
        expect(data.failed_reasons).toEqual([
            { action_id: actionId, name: "DELCOM - Kickoff", reason: "member no longer exists" },
        ])

        const { data: run } = await svc()
            .from("sor_action_runs")
            .select("outcome, failure_reason")
            .eq("opportunity_id", sorId)
            .eq("action_id", actionId)
            .single()
        expect(run).toEqual({ outcome: "failed", failure_reason: "member no longer exists" })
    })
})
