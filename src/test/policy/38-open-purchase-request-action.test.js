/**
 * Open Purchase Request (#304, part of #209): the Stage Action that opens an
 * SOR's one Purchase Request, and members added to or removed from it.
 *
 * `stageParticipant` is given Purchasing access for this file only. It is the
 * purchasing member; `dealOwner` and `support` are the sales side. Requests are
 * read back with the service role, so a pass is the RPC's doing and not a read
 * policy's.
 *
 * Each action's config is the one saved in the SOR's Flow Snapshot, the way
 * the modal saves it. Whatever config a caller sends along is ignored, so
 * every run here also sends a decoy that would change the outcome if it were
 * read.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()

const NO_ID = "00000000-0000-0000-0000-000000000000"
const DECOY = { buyer_id: null, extra_member_ids: [], left_out_roles: ["deal_owner"], access_until: "terminal" }

let saleTypeId, flowId, stageId, laterStageId, firstActionId, topUpActionId
let snapshotVersion = 9800
const sorIds = []

async function one(query, what) {
    const { data, error } = await query.select("id").single()
    if (error) throw new Error(`${what}: ${error.message}`)
    return data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.stageParticipant)
    if (flag.error) throw flag.error

    saleTypeId = await one(svc().from("sale_types").insert({ name: `${MARKER} Open PR` }), "sale type")
    flowId = await one(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }), "flow")
    stageId = await one(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Stage`, sort_order: 10 }), "stage")
    laterStageId = await one(
        svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Later Stage`, sort_order: 20 }),
        "later stage",
    )
    firstActionId = await one(
        svc().from("flow_stage_actions").insert({ stage_id: stageId, kind: "open_purchase_request" }),
        "action",
    )
    topUpActionId = await one(
        svc().from("flow_stage_actions").insert({ stage_id: stageId, kind: "open_purchase_request" }),
        "second action",
    )
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.stageParticipant)
    await svc().from("purchase_requests").delete().in("opportunity_id", sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sor_action_runs").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_snapshots").delete().eq("flow_id", flowId)
    await svc().from("flow_stage_actions").delete().in("id", [firstActionId, topUpActionId])
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

/**
 * An SOR on the first Stage, under a Flow Snapshot that saves `first` and
 * `topUp` as the two actions' configs.
 */
async function freshSor({ first = {}, topUp = {} } = {}) {
    const id = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        supportSales1Id: ids.support,
        salesDirectorId: ids.head,
        saleTypeId,
        flowStageId: stageId,
    })
    sorIds.push(id)

    snapshotVersion += 1
    const snapshotId = await one(
        svc().from("flow_snapshots").insert({
            flow_id: flowId,
            version: snapshotVersion,
            snapshot_data: {
                actions: [
                    { id: firstActionId, stage_id: stageId, kind: "open_purchase_request", config: first },
                    { id: topUpActionId, stage_id: stageId, kind: "open_purchase_request", config: topUp },
                ],
            },
        }),
        "snapshot",
    )
    const visit = await svc().from("sor_stage_visits").update({ flow_snapshot_id: snapshotId }).eq("opportunity_id", id)
    if (visit.error) throw new Error(visit.error.message)
    return id
}

async function visitOf(sorId) {
    const { data, error } = await svc()
        .from("sor_stage_visits")
        .select("id")
        .eq("opportunity_id", sorId)
        .order("sequence", { ascending: false })
        .limit(1)
        .single()
    if (error) throw new Error(error.message)
    return data.id
}

/** Run the action(s) as the Deal Owner, the way a Stage move does. */
async function run(sorId, actionIds, { confirm = false } = {}) {
    const visitId = await visitOf(sorId)
    const { data, error } = await (await clientFor("dealOwner")).rpc("sor_run_stage_actions", {
        p_opportunity_id: sorId,
        p_stage_id: stageId,
        p_stage_visit_id: visitId,
        p_actions: actionIds.map((id) => ({
            action_id: id,
            kind: "open_purchase_request",
            name: "Open Purchase Request",
            confirm,
            decider: confirm ? [{ type: "role", role: "deal_owner" }] : undefined,
            decider_ids: confirm ? [ids.dealOwner] : undefined,
            purchase_request: DECOY,
        })),
    })
    if (error) throw new Error(error.message)
    return data
}

async function runOf(sorId, actionId) {
    const { data } = await svc()
        .from("sor_action_runs")
        .select("*")
        .eq("opportunity_id", sorId)
        .eq("action_id", actionId)
        .single()
    return data
}

async function requestOf(sorId) {
    const { data } = await svc().from("purchase_requests").select("*").eq("opportunity_id", sorId)
    return data
}

async function membersOf(requestId) {
    const { data } = await svc().from("purchase_request_members").select("employee_id, side").eq("request_id", requestId)
    return Object.fromEntries(data.map((m) => [m.employee_id, m.side]))
}

async function openWindowsOf(sorId, employeeId) {
    const { data } = await svc()
        .from("sor_stage_participants")
        .select("id")
        .eq("opportunity_id", sorId)
        .eq("employee_id", employeeId)
        .is("closed_at", null)
    return data
}

const employee = (id) => ({ type: "employee", id })

describe("running the action", () => {
    it("opens exactly one request, recording each member's side", async () => {
        const sorId = await freshSor({ first: { extras: [employee(ids.ordinary)] } })
        const result = await run(sorId, [firstActionId])
        expect(result.failed).toEqual([])

        const requests = await requestOf(sorId)
        expect(requests).toHaveLength(1)
        expect(requests[0].buyer_id).toBeNull()

        const members = await membersOf(requests[0].id)
        expect(members[ids.stageParticipant]).toBe("purchasing")
        expect(members[ids.dealOwner]).toBe("sales")
        expect(members[ids.support]).toBe("sales")
        expect(members[ids.head]).toBe("sales")
        expect(members[ids.ordinary]).toBe("other")
    })

    it("resolves a saved Group or Team selector to its people", async () => {
        const sorId = await freshSor({ first: { extras: [{ type: "team", team: "LOGISTICS" }] } })
        await run(sorId, [firstActionId])
        const [request] = await requestOf(sorId)
        expect((await membersOf(request.id))[ids.outsider]).toBe("other")
    })

    it("leaves the left-out Deal Team roles out", async () => {
        const sorId = await freshSor({ first: { leaveOutRoles: ["support_sales", "sales_director"] } })
        await run(sorId, [firstActionId])
        const [request] = await requestOf(sorId)
        const members = await membersOf(request.id)
        expect(members[ids.dealOwner]).toBe("sales")
        expect(members[ids.support]).toBeUndefined()
        expect(members[ids.head]).toBeUndefined()
    })

    it("makes the Buyer a member", async () => {
        const sorId = await freshSor({ first: { buyer: employee(ids.stageParticipant) } })
        await run(sorId, [firstActionId])
        const [request] = await requestOf(sorId)
        expect(request.buyer_id).toBe(ids.stageParticipant)
        expect((await membersOf(request.id))[ids.stageParticipant]).toBe("purchasing")
    })

    it("reads the saved config, not the one the caller sends", async () => {
        // The decoy leaves out the Deal Owner and asks for a terminal window.
        const sorId = await freshSor()
        await run(sorId, [firstActionId])
        const [request] = await requestOf(sorId)
        expect((await membersOf(request.id))[ids.dealOwner]).toBe("sales")
        expect(request.access_until).toBe("stage_left")
    })

    it("opens a window on the opening visit for each purchasing member, and no one else", async () => {
        const sorId = await freshSor({ first: { access: { until: "terminal" } } })
        const visitId = await visitOf(sorId)
        await run(sorId, [firstActionId])
        const { data } = await svc()
            .from("sor_stage_participants")
            .select("employee_id, opened_visit_id, source, until_rule")
            .eq("opportunity_id", sorId)
            .eq("source", "purchase_request")
        expect(data.map((p) => p.employee_id)).toContain(ids.stageParticipant)
        expect(data.map((p) => p.employee_id)).not.toContain(ids.dealOwner)
        for (const p of data) {
            expect(p.opened_visit_id).toBe(visitId)
            expect(p.until_rule).toBe("terminal")
        }
    })

    it("re-running the same action opens nothing new and changes nothing", async () => {
        const sorId = await freshSor()
        await run(sorId, [firstActionId])
        const [before] = await requestOf(sorId)
        const membersBefore = await membersOf(before.id)

        await run(sorId, [firstActionId])
        const after = await requestOf(sorId)
        expect(after).toHaveLength(1)
        expect(await membersOf(before.id)).toEqual(membersBefore)
    })

    it("a second action tops up: sets the Buyer if none, adds missing members, never replaces", async () => {
        const sorId = await freshSor({
            first: { leaveOutRoles: ["support_sales"] },
            topUp: { buyer: employee(ids.stageParticipant), extras: [employee(ids.ordinary)] },
        })
        await run(sorId, [firstActionId])
        const [first] = await requestOf(sorId)

        await run(sorId, [topUpActionId])
        const [second] = await requestOf(sorId)
        expect(second.id).toBe(first.id)
        expect(second.buyer_id).toBe(ids.stageParticipant)
        const members = await membersOf(first.id)
        expect(members[ids.ordinary]).toBe("other")
        // The top-up action left nothing out, so it adds the Support Sales the first one skipped.
        expect(members[ids.support]).toBe("sales")

        const sorId2 = await freshSor({ first: { buyer: employee(ids.stageParticipant) }, topUp: { buyer: employee(ids.head) } })
        await run(sorId2, [firstActionId])
        await run(sorId2, [topUpActionId])
        const [kept] = await requestOf(sorId2)
        expect(kept.buyer_id).toBe(ids.stageParticipant)
    })

    it("an Optional Action opens the request once a Decider picks Create", async () => {
        const sorId = await freshSor({ first: { buyer: employee(ids.stageParticipant) } })
        await run(sorId, [firstActionId], { confirm: true })
        expect(await requestOf(sorId)).toHaveLength(0)

        const pending = await runOf(sorId, firstActionId)
        expect(pending.outcome).toBe("pending")

        const client = await clientFor("dealOwner")
        const decided = await client.rpc("sor_decide_action_run", {
            p_run_id: pending.id,
            p_decision: "create",
            p_actor_id: ids.dealOwner,
        })
        expect(decided.error).toBeNull()

        const opened = await client.rpc("sor_open_purchase_request", { p_run_id: pending.id })
        expect(opened.error).toBeNull()
        const [request] = await requestOf(sorId)
        expect(opened.data).toBe(request.id)
        expect(request.buyer_id).toBe(ids.stageParticipant)
        expect((await runOf(sorId, firstActionId)).purchase_request_id).toBe(request.id)
    })
})

describe("calling sor_open_purchase_request directly", () => {
    it("refuses a run that already opened its request, so a sales-side member cannot re-run it with their own config", async () => {
        const sorId = await freshSor()
        await run(sorId, [firstActionId])
        const [before] = await requestOf(sorId)
        const runRow = await runOf(sorId, firstActionId)

        const { error } = await (await clientFor("support")).rpc("sor_open_purchase_request", {
            p_run_id: runRow.id,
            p_config: { buyer_id: ids.support, extra_member_ids: [ids.outsider] },
        })
        expect(error?.code).toBe("42501")
        const [after] = await requestOf(sorId)
        expect(after.buyer_id).toBe(before.buyer_id)
        expect((await membersOf(before.id))[ids.outsider]).toBeUndefined()
    })

    it("refuses a run whose action is not an Open Purchase Request", async () => {
        const sorId = await freshSor()
        const taskActionId = await one(
            svc().from("flow_stage_actions").insert({ stage_id: stageId, kind: "create_individual_task" }),
            "task action",
        )
        try {
            const runId = await one(
                svc().from("sor_action_runs").insert({
                    opportunity_id: sorId,
                    stage_id: stageId,
                    action_id: taskActionId,
                    stage_visit_id: await visitOf(sorId),
                }),
                "task run",
            )
            const { error } = await (await clientFor("dealOwner")).rpc("sor_open_purchase_request", { p_run_id: runId })
            expect(error).not.toBeNull()
            expect(await requestOf(sorId)).toHaveLength(0)
        } finally {
            await svc().from("sor_action_runs").delete().eq("action_id", taskActionId)
            await svc().from("flow_stage_actions").delete().eq("id", taskActionId)
        }
    })
})

describe("someone not signed in", () => {
    it.each([
        ["purchase_request_member_side", () => ({ p_opportunity_id: NO_ID, p_employee_id: ids.dealOwner })],
        ["sor_open_purchase_request", () => ({ p_run_id: NO_ID })],
        ["purchase_request_can_manage_members", () => ({ p_request_id: NO_ID })],
        ["purchase_request_add_member", () => ({ p_request_id: NO_ID, p_employee_id: ids.outsider })],
        ["purchase_request_remove_member", () => ({ p_request_id: NO_ID, p_employee_id: ids.outsider })],
    ])("cannot call %s at all", async (fn, args) => {
        const { error } = await anonymousClient().rpc(fn, args())
        expect(error?.message).toMatch(/permission denied/i)
    })
})

describe("members on a live request", () => {
    let sorId, requestId

    beforeAll(async () => {
        sorId = await freshSor({ first: { buyer: employee(ids.stageParticipant), extras: [employee(ids.ordinary)] } })
        await run(sorId, [firstActionId])
        requestId = (await requestOf(sorId))[0].id
    })

    it("a purchasing member adds and removes a member", async () => {
        const client = await clientFor("stageParticipant")
        const added = await client.rpc("purchase_request_add_member", { p_request_id: requestId, p_employee_id: ids.outsider })
        expect(added.error).toBeNull()
        expect((await membersOf(requestId))[ids.outsider]).toBe("other")

        const removed = await client.rpc("purchase_request_remove_member", { p_request_id: requestId, p_employee_id: ids.outsider })
        expect(removed.error).toBeNull()
        expect((await membersOf(requestId))[ids.outsider]).toBeUndefined()
    })

    it("a Super Admin adds a member", async () => {
        const { error } = await (await clientFor("superAdmin")).rpc("purchase_request_add_member", {
            p_request_id: requestId,
            p_employee_id: ids.outsider,
        })
        expect(error).toBeNull()
        await svc().from("purchase_request_members").delete().eq("request_id", requestId).eq("employee_id", ids.outsider)
    })

    it("a sales-side member can neither add nor remove", async () => {
        const client = await clientFor("dealOwner")
        const add = await client.rpc("purchase_request_add_member", { p_request_id: requestId, p_employee_id: ids.outsider })
        expect(add.error?.code).toBe("42501")
        const remove = await client.rpc("purchase_request_remove_member", { p_request_id: requestId, p_employee_id: ids.support })
        expect(remove.error?.code).toBe("42501")
        expect((await membersOf(requestId))[ids.support]).toBe("sales")
    })

    it("refuses to remove the Buyer", async () => {
        const { error } = await (await clientFor("stageParticipant")).rpc("purchase_request_remove_member", {
            p_request_id: requestId,
            p_employee_id: ids.stageParticipant,
        })
        expect(error?.code).toBe("42501")
    })

    it("removing a purchasing member closes their window", async () => {
        const client = await clientFor("superAdmin")
        await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
        try {
            await client.rpc("purchase_request_add_member", { p_request_id: requestId, p_employee_id: ids.outsider })
            expect(await openWindowsOf(sorId, ids.outsider)).toHaveLength(1)

            await client.rpc("purchase_request_remove_member", { p_request_id: requestId, p_employee_id: ids.outsider })
            expect(await openWindowsOf(sorId, ids.outsider)).toHaveLength(0)
        } finally {
            await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
        }
    })

    it("a member who is not on the Deal Team sees the SOR's locked header", async () => {
        const client = await clientFor("ordinary")
        const level = await client.rpc("sor_access_level", { p_opportunity_id: sorId })
        expect(level.data).toBe("locked")
        const summary = await client.rpc("sor_locked_summary", { p_opportunity_id: sorId })
        expect(summary.data).toHaveLength(1)
    })
})

describe("the purchasing window", () => {
    let sorId, requestId, openedVisitId, laterVisitId

    beforeAll(async () => {
        sorId = await freshSor({ first: { buyer: employee(ids.stageParticipant) } })
        openedVisitId = await visitOf(sorId)
        await run(sorId, [firstActionId])
        requestId = (await requestOf(sorId))[0].id

        const moved = await svc().from("sales_opportunities").update({ flow_stage_id: laterStageId }).eq("id", sorId)
        if (moved.error) throw new Error(moved.error.message)
        laterVisitId = await visitOf(sorId)
    })

    it("lets a purchasing member read the visit it was opened on, and not the Stage after", async () => {
        const { data, error } = await (await clientFor("stageParticipant")).rpc("sor_visible_visit_ids", {
            p_opportunity_id: sorId,
        })
        expect(error).toBeNull()
        expect(data).toContain(openedVisitId)
        expect(data).not.toContain(laterVisitId)
    })

    it("gives a purchasing member added after the visit is over no open window", async () => {
        await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.outsider)
        try {
            const { error } = await (await clientFor("superAdmin")).rpc("purchase_request_add_member", {
                p_request_id: requestId,
                p_employee_id: ids.outsider,
            })
            expect(error).toBeNull()
            expect((await membersOf(requestId))[ids.outsider]).toBe("purchasing")
            expect(await openWindowsOf(sorId, ids.outsider)).toHaveLength(0)
        } finally {
            await svc().from("purchase_request_members").delete().eq("request_id", requestId).eq("employee_id", ids.outsider)
            await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.outsider)
        }
    })
})
