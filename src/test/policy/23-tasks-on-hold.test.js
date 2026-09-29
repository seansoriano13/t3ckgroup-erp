/**
 * Issue #388 (parent #384) — tasks go on hold when the SOR leaves a Stage, and
 * are cancelled on reaching a Terminal Stage. Moves run as a signed-in user;
 * the service role only seeds the flow and reads back the evidence.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

let saleTypeId, flowId, stageA, stageB, stageTerminal, actionId
const sorIds = []
const svc = () => serviceClient()

async function stage(name, sortOrder, extra = {}) {
    const { data, error } = await svc()
        .from("flow_stages")
        .insert({ flow_id: flowId, name: `${MARKER} ${name}`, sort_order: sortOrder, ...extra })
        .select("id")
        .single()
    if (error) throw new Error(error.message)
    return data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    const st = await svc().from("sale_types").insert({ name: `${MARKER} Hold` }).select("id").single()
    saleTypeId = st.data.id
    flowId = (await svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()).data.id
    stageA = await stage("A", 10)
    stageB = await stage("B", 20)
    stageTerminal = await stage("Terminal", 30, { is_terminal: true })
    actionId = (await svc().from("flow_stage_actions").insert({ stage_id: stageA, kind: "create_individual_task" }).select("id").single()).data.id
})

afterAll(async () => {
    await svc().from("tasks").delete().in("opportunity_id", sorIds)
    await svc().from("committee_tasks").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stage_actions").delete().eq("id", actionId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

async function sorWithTasks() {
    const id = await makeSor({
        registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, closingSalesId: ids.closingSales, saleTypeId, flowStageId: stageA,
    })
    sorIds.push(id)
    const { data: visit } = await svc().from("sor_stage_visits").select("id").eq("opportunity_id", id).single()
    const mk = (status, extra = {}) =>
        svc().from("tasks")
            .insert({ logged_by: ids.closingSales, opportunity_id: id, stage_visit_id: visit.id, task_description: `${MARKER} t`, status, ...extra })
            .select("id").single().then((r) => r.data.id)
    return {
        id, visit: visit.id,
        open: await mk("INCOMPLETE", { stage_action_id: actionId }),
        done: await mk("COMPLETED", { stage_action_id: actionId }),
        manual: await mk("INCOMPLETE"),
    }
}

async function moveTo(sorId, stageId) {
    const client = await clientFor("dealOwner")
    const { error } = await client.from("sales_opportunities").update({ flow_stage_id: stageId }).eq("id", sorId)
    if (error) throw new Error(error.message)
}
const task = async (id) => (await svc().from("tasks").select("*").eq("id", id).single()).data

describe("tasks on hold", () => {
    it("puts open action-created tasks on hold when the Stage is left, recording when and from where", async () => {
        const s = await sorWithTasks()
        await moveTo(s.id, stageB)
        const held = await task(s.open)
        expect(held.status).toBe("ON_HOLD")
        expect(held.held_at).not.toBeNull()
        expect(held.held_from_visit_id).toBe(s.visit)
        expect((await task(s.done)).status).toBe("COMPLETED")
        expect((await task(s.manual)).status).toBe("INCOMPLETE")
    })

    it("holds group tasks too", async () => {
        const s = await sorWithTasks()
        const ct = await svc().from("committee_tasks")
            .insert({ title: `${MARKER} g`, created_by: ids.dealOwner, opportunity_id: s.id, stage_visit_id: s.visit, stage_action_id: actionId })
            .select("id").single()
        await moveTo(s.id, stageB)
        expect((await svc().from("committee_tasks").select("status").eq("id", ct.data.id).single()).data.status).toBe("ON_HOLD")
    })

    it("cancels every held task on entering a Terminal Stage, with a reason", async () => {
        const s = await sorWithTasks()
        await moveTo(s.id, stageB)
        await moveTo(s.id, stageTerminal)
        const t = await task(s.open)
        expect(t.status).toBe("DELETED")
        expect(t.cancel_reason).toMatch(/Terminal Stage/)
        expect(t.cancel_reason).toContain(`${MARKER} Terminal`)
        // The hold is kept on the cancelled row, so a Revert can put it back.
        expect(t.held_from_visit_id).toBe(s.visit)
    })

    it("a Revert off a Terminal Stage puts a task held before it back on hold", async () => {
        const s = await sorWithTasks()
        await moveTo(s.id, stageB)
        await moveTo(s.id, stageTerminal)
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_revert_stage", { p_opportunity_id: s.id })).error).toBeNull()
        const t = await task(s.open)
        expect(t.status).toBe("ON_HOLD")
        expect(t.cancel_reason).toBeNull()
        expect(t.held_from_visit_id).toBe(s.visit)
        expect(t.held_prev_status).toBe("INCOMPLETE")
    })

    it("a Revert off a Terminal Stage brings back live what the move into it held", async () => {
        const s = await sorWithTasks()
        await moveTo(s.id, stageTerminal)
        expect((await task(s.open)).status).toBe("DELETED")
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_revert_stage", { p_opportunity_id: s.id })).error).toBeNull()
        const t = await task(s.open)
        expect(t.status).toBe("INCOMPLETE")
        expect(t.cancel_reason).toBeNull()
        expect(t.held_at).toBeNull()
    })

    it("a Revert off a Terminal Stage puts held group tasks back on hold", async () => {
        const s = await sorWithTasks()
        const ct = await svc().from("committee_tasks")
            .insert({ title: `${MARKER} g`, created_by: ids.dealOwner, opportunity_id: s.id, stage_visit_id: s.visit, stage_action_id: actionId })
            .select("id").single()
        await moveTo(s.id, stageB)
        await moveTo(s.id, stageTerminal)
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_revert_stage", { p_opportunity_id: s.id })).error).toBeNull()
        const row = (await svc().from("committee_tasks").select("status, cancel_reason").eq("id", ct.data.id).single()).data
        expect(row).toEqual({ status: "ON_HOLD", cancel_reason: null })
    })

    it("a Revert brings back what the reverted move held", async () => {
        const s = await sorWithTasks()
        await moveTo(s.id, stageB)
        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_revert_stage", { p_opportunity_id: s.id })).error).toBeNull()
        const t = await task(s.open)
        expect(t.status).toBe("INCOMPLETE")
        expect(t.held_at).toBeNull()
    })
})

describe("held group tasks at a Terminal Stage", () => {
    it("cancels them too", async () => {
        const s = await sorWithTasks()
        const ct = await svc().from("committee_tasks")
            .insert({ title: `${MARKER} g`, created_by: ids.dealOwner, opportunity_id: s.id, stage_visit_id: s.visit, stage_action_id: actionId })
            .select("id").single()
        await moveTo(s.id, stageB)
        await moveTo(s.id, stageTerminal)
        const row = (await svc().from("committee_tasks").select("status, cancel_reason").eq("id", ct.data.id).single()).data
        expect(row.status).toBe("CANCELLED")
        expect(row.cancel_reason).toContain(`${MARKER} Terminal`)
    })
})

describe("actions that carry on past the stage (#389)", () => {
    let versionSeq = 9000
    /**
     * Seeds an action + a snapshot freezing `config` for it, an SOR on that
     * snapshot with one open task (and a group task) from the action, runs
     * `beforeMove`, then moves the SOR off Stage A. `snapshotConfig` undefined
     * means no snapshot at all.
     */
    async function moveOnUnder(config, { beforeMove, noSnapshot = false } = {}) {
        const carryId = (await svc().from("flow_stage_actions").insert({ stage_id: stageA, kind: "create_individual_task", config }).select("id").single()).data.id
        const s = await sorWithTasks()
        if (!noSnapshot) {
            const snap = await svc().from("flow_snapshots")
                .insert({ flow_id: flowId, version: ++versionSeq, snapshot_data: { actions: [{ id: carryId, stage_id: stageA, config }] } })
                .select("id").single()
            if (snap.error) throw new Error(snap.error.message)
            await svc().from("sales_opportunities").update({ flow_snapshot_id: snap.data.id }).eq("id", s.id)
            await svc().from("sor_stage_visits").update({ flow_snapshot_id: snap.data.id }).eq("id", s.visit)
        }
        const t = (await svc().from("tasks")
            .insert({ logged_by: ids.closingSales, opportunity_id: s.id, stage_visit_id: s.visit, task_description: `${MARKER} c`, status: "INCOMPLETE", stage_action_id: carryId })
            .select("id").single()).data.id
        const g = (await svc().from("committee_tasks")
            .insert({ title: `${MARKER} cg`, created_by: ids.dealOwner, opportunity_id: s.id, stage_visit_id: s.visit, stage_action_id: carryId })
            .select("id").single()).data.id
        if (beforeMove) await beforeMove(carryId)
        await moveTo(s.id, stageB)
        return { s, t, g, carryId }
    }
    const groupStatus = async (id) => (await svc().from("committee_tasks").select("status").eq("id", id).single()).data.status
    const cleanup = async ({ t, g, carryId }) => {
        await svc().from("tasks").delete().eq("id", t)
        await svc().from("committee_tasks").delete().eq("id", g)
        await svc().from("flow_stage_actions").delete().eq("id", carryId)
    }
    const withRun = (config, opts, fn) => async () => {
        const r = await moveOnUnder(config, opts)
        try { await fn(r) } finally { await cleanup(r) }
    }

    it("never holds a carry-on task, and a Terminal Stage leaves it alone", withRun({ carries_on: true }, {}, async (r) => {
        expect((await task(r.t)).status).toBe("INCOMPLETE")
        expect(await groupStatus(r.g)).toBe("ACTIVE")
        expect((await task(r.s.open)).status).toBe("ON_HOLD")
        await moveTo(r.s.id, stageTerminal)
        // the held sibling was cancelled by that move; the carry-on tasks were not
        expect((await task(r.s.open)).status).toBe("DELETED")
        expect((await task(r.t)).status).toBe("INCOMPLETE")
        expect(await groupStatus(r.g)).toBe("ACTIVE")
    }))

    it("holds when the setting is off in the snapshot", withRun({ carries_on: false }, {}, async (r) => {
        expect((await task(r.t)).status).toBe("ON_HOLD")
        expect(await groupStatus(r.g)).toBe("ON_HOLD")
    }))

    it("holds when the snapshot's action has no setting", withRun({}, {}, async (r) => {
        expect((await task(r.t)).status).toBe("ON_HOLD")
    }))

    it("holds when the visit has no snapshot", withRun({ carries_on: true }, { noSnapshot: true }, async (r) => {
        expect((await task(r.t)).status).toBe("ON_HOLD")
    }))

    it("reads the SOR's own snapshot, not the live action", withRun(
        { carries_on: true },
        { beforeMove: (id) => svc().from("flow_stage_actions").update({ config: { carries_on: false } }).eq("id", id) },
        async (r) => {
            expect((await task(r.t)).status).toBe("INCOMPLETE")
        },
    ))
})
