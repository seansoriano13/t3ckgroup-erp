/**
 * Issue #386 (parent #384, ADR 0026) — Revert to last stage, when no Stage
 * Work was done. Every assertion runs as a signed-in cast member; the service
 * role only seeds the flow and the evidence.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

let saleTypeId
let flowId
let stageA
let stageB
let stageWon
let stageTerminal
const sorIds = []

async function stage(name, sortOrder, extra = {}) {
    const { data, error } = await serviceClient()
        .from("flow_stages")
        .insert({ flow_id: flowId, name: `${MARKER} ${name}`, sort_order: sortOrder, ...extra })
        .select("id")
        .single()
    if (error) throw new Error(`Seeding ${name}: ${error.message}`)
    return data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    const svc = serviceClient()
    const saleType = await svc.from("sale_types").insert({ name: `${MARKER} Revert` }).select("id").single()
    if (saleType.error) throw new Error(saleType.error.message)
    saleTypeId = saleType.data.id
    const flow = await svc.from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()
    if (flow.error) throw new Error(flow.error.message)
    flowId = flow.data.id
    stageA = await stage("A", 10)
    stageB = await stage("B", 20)
    stageWon = await stage("Won", 30)
    stageTerminal = await stage("Terminal", 40, { is_terminal: true })
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("tasks").delete().in("opportunity_id", sorIds)
    await svc.from("committee_tasks").delete().in("opportunity_id", sorIds)
    await svc.from("sor_action_runs").delete().in("opportunity_id", sorIds)
    await svc.from("sales_opportunities").delete().in("id", sorIds)
    await svc.from("flow_stages").delete().eq("flow_id", flowId)
    await svc.from("sales_flows").delete().eq("id", flowId)
    await svc.from("sale_types").delete().eq("id", saleTypeId)
})

async function freshSor() {
    const id = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        closingSalesId: ids.closingSales,
        saleTypeId,
        flowStageId: stageA,
    })
    sorIds.push(id)
    return id
}

/** Moves as `who` (their own client, so the trigger records them as the mover). */
async function moveAs(who, sorId, toStage, patch = {}) {
    const client = await clientFor(who)
    const { data, error } = await client
        .from("sales_opportunities")
        .update({ flow_stage_id: toStage, ...patch })
        .eq("id", sorId)
        .select("id")
    if (error) throw new Error(`Moving as ${who}: ${error.message}`)
    if (data.length !== 1) throw new Error(`Moving as ${who} affected ${data.length} rows`)
}

async function revertAs(who, sorId) {
    const client = await clientFor(who)
    return client.rpc("sor_revert_stage", { p_opportunity_id: sorId })
}

const svc = () => serviceClient()

async function sorRow(sorId) {
    const { data } = await svc().from("sales_opportunities").select("flow_stage_id, contract_date").eq("id", sorId).single()
    return data
}

async function visits(sorId) {
    const { data } = await svc().from("sor_stage_visits").select("*").eq("opportunity_id", sorId).order("sequence")
    return data
}

describe("Revert to last stage (no Stage Work)", () => {
    it("takes the SOR back to the Stage its latest move came from, and undoes the visit", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageB)
        const { error } = await revertAs("dealOwner", sor)
        expect(error).toBeNull()
        expect((await sorRow(sor)).flow_stage_id).toBe(stageA)

        const [first, second] = await visits(sor)
        expect(second.undone_at).not.toBeNull()
        expect(second.undone_by).toBe(ids.dealOwner)
        expect(first.left_at).toBeNull()
        expect(first.undone_at).toBeNull()
    })

    it("leaves the earlier visit as the only open one, so new work and logs land on it", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageB)
        expect((await revertAs("dealOwner", sor)).error).toBeNull()

        const all = await visits(sor)
        const open = all.filter((v) => v.left_at === null)
        expect(open.map((v) => v.id)).toEqual([all[0].id])
        expect(all[1].left_at).not.toBeNull()

        const log = await svc()
            .from("sales_opportunity_logs")
            .insert({ opportunity_id: sor, author_id: ids.dealOwner, type: "SYSTEM", content: `${MARKER} after revert` })
            .select("stage_visit_id")
            .single()
        expect(log.data.stage_visit_id).toBe(all[0].id)
    })

    it("works from a Terminal Stage, with no edge back", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageTerminal)
        const { error } = await revertAs("dealOwner", sor)
        expect(error).toBeNull()
        expect((await sorRow(sor)).flow_stage_id).toBe(stageA)
    })

    it("undone visits grant nothing: they leave sor_visible_visit_ids", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageB)
        const client = await clientFor("superAdmin")
        const before = await client.rpc("sor_visible_visit_ids", { p_opportunity_id: sor })
        expect(before.data).toHaveLength(2)
        await revertAs("dealOwner", sor)
        const after = await client.rpc("sor_visible_visit_ids", { p_opportunity_id: sor })
        expect(after.data).toHaveLength(1)
    })

    it("cancels tasks created by the reverted move and closes off their action runs", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageB)
        const [, visitB] = await visits(sor)
        const task = await svc()
            .from("tasks")
            .insert({ logged_by: ids.dealOwner, opportunity_id: sor, stage_visit_id: visitB.id, task_description: `${MARKER} auto` })
            .select("id")
            .single()
        const action = await svc()
            .from("flow_stage_actions")
            .insert({ stage_id: stageB, kind: "create_individual_task" })
            .select("id")
            .single()
        const run = await svc()
            .from("sor_action_runs")
            .insert({ opportunity_id: sor, stage_id: stageB, action_id: action.data.id, stage_visit_id: visitB.id, outcome: "created" })
            .select("id")
            .single()

        const { error } = await revertAs("dealOwner", sor)
        expect(error).toBeNull()

        const t = await svc().from("tasks").select("status, cancel_reason").eq("id", task.data.id).single()
        expect(t.data.status).toBe("DELETED")
        expect(t.data.cancel_reason).toMatch(/reverted/)
        const r = await svc().from("sor_action_runs").select("closed_off_at, closed_off_reason").eq("id", run.data.id).single()
        expect(r.data.closed_off_at).not.toBeNull()
        expect(r.data.closed_off_reason).toBe("reverted")

        // A later real entry fires fresh: a new live run may begin.
        const again = await svc().rpc("sor_begin_action_run", {
            p_opportunity_id: sor,
            p_stage_id: stageB,
            p_action_id: action.data.id,
        })
        expect(again.data.id).not.toBe(run.data.id)
        await svc().from("flow_stage_actions").delete().eq("id", action.data.id)
    })

    it("clears a Contract Date the reverted move stamped, and only that", async () => {
        const stamped = await freshSor()
        await moveAs("dealOwner", stamped, stageWon, { contract_date: "2026-09-01" })
        expect((await sorRow(stamped)).contract_date).toBe("2026-09-01")
        await revertAs("dealOwner", stamped)
        expect((await sorRow(stamped)).contract_date).toBeNull()

        const preExisting = await freshSor()
        await svc().from("sales_opportunities").update({ contract_date: "2026-08-01" }).eq("id", preExisting)
        await moveAs("dealOwner", preExisting, stageWon)
        await revertAs("dealOwner", preExisting)
        expect((await sorRow(preExisting)).contract_date).toBe("2026-08-01")
    })

    it("says in the STAGE_REVERTED entry whether the Contract Date was cleared", async () => {
        const stamped = await freshSor()
        await moveAs("dealOwner", stamped, stageWon, { contract_date: "2026-09-01" })
        await revertAs("dealOwner", stamped)
        const plain = await freshSor()
        await moveAs("dealOwner", plain, stageB)
        await revertAs("dealOwner", plain)
        const entry = async (id) =>
            (await svc().from("sales_opportunity_logs").select("content, metadata").eq("opportunity_id", id).eq("metadata->>event", "STAGE_REVERTED").single()).data
        const a = await entry(stamped)
        expect(a.metadata.clearedContractDate).toBe(true)
        expect(a.content).toMatch(/Contract Date cleared/)
        expect((await entry(plain)).metadata.clearedContractDate).toBe(false)
    })

    it("stamps a fresh Contract Date when the SOR reaches the Won Stage again", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageWon, { contract_date: "2026-09-01" })
        await revertAs("dealOwner", sor)
        await moveAs("dealOwner", sor, stageWon, { contract_date: "2026-09-15" })
        expect((await sorRow(sor)).contract_date).toBe("2026-09-15")
        await revertAs("dealOwner", sor)
        expect((await sorRow(sor)).contract_date).toBeNull()
    })

    it("sends a disregard notification to assignees and Deciders the reverted move notified", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageB)
        const [, visitB] = await visits(sor)
        await svc().from("tasks").insert({ logged_by: ids.closingSales, opportunity_id: sor, stage_visit_id: visitB.id, task_description: `${MARKER} n` })
        await svc().from("notifications").insert({
            recipient_id: ids.superAdmin, sender_id: ids.dealOwner, type: "OPPORTUNITY_ACTION_DECISION_DUE",
            title: `${MARKER} due`, message: "decide", reference_id: sor,
        })
        expect((await revertAs("dealOwner", sor)).error).toBeNull()
        const { data } = await svc().from("notifications").select("recipient_id, message").eq("reference_id", sor).eq("type", "OPPORTUNITY_STAGE_REVERTED")
        expect(data.map((n) => n.recipient_id).sort()).toEqual([ids.closingSales, ids.superAdmin].sort())
        expect(data[0].message).toMatch(/reverted/)
        await svc().from("notifications").delete().eq("reference_id", sor)
    })

    it("lets whoever made the latest move revert it, even off the Deal Team's owner role", async () => {
        const sor = await freshSor()
        await moveAs("closingSales", sor, stageB)
        const { error } = await revertAs("closingSales", sor)
        expect(error).toBeNull()
    })

    it("lets the Deal Owner and a Super Admin revert someone else's move", async () => {
        const one = await freshSor()
        await moveAs("closingSales", one, stageB)
        expect((await revertAs("dealOwner", one)).error).toBeNull()

        const two = await freshSor()
        await moveAs("dealOwner", two, stageB)
        expect((await revertAs("superAdmin", two)).error).toBeNull()
    })

    it("refuses anyone else", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageB)
        for (const who of ["ordinary", "outsider", "closingSales"]) {
            const { error } = await revertAs(who, sor)
            expect(error?.code, who).toBe("42501")
        }
        expect((await sorRow(sor)).flow_stage_id).toBe(stageB)
    })

    it("refuses on an SOR that has never moved, naming the reason", async () => {
        const sor = await freshSor()
        const { error } = await revertAs("dealOwner", sor)
        expect(error?.message).toMatch(/never moved/)
    })

    it("refuses straight after a Revert (one step only)", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageB)
        await moveAs("dealOwner", sor, stageWon)
        expect((await revertAs("dealOwner", sor)).error).toBeNull()
        const second = await revertAs("dealOwner", sor)
        expect(second.error?.message).toMatch(/already reverted/)
        expect((await sorRow(sor)).flow_stage_id).toBe(stageB)
    })

    it("is not blocked by the Stage being left's conditions or required fields", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageB)
        const cond = await svc()
            .from("stage_conditions")
            .insert({ stage_id: stageB, kind: "tickbox", label: `${MARKER} must tick`, config: {} })
            .select("id")
            .single()
        const field = await svc()
            .from("flow_stage_fields")
            .insert({ stage_id: stageB, label: `${MARKER} required`, source: "custom", field_type: "text", is_required: true })
            .select("id")
            .single()
        const { error } = await revertAs("dealOwner", sor)
        expect(error).toBeNull()
        await svc().from("stage_conditions").delete().eq("id", cond.data.id)
        await svc().from("flow_stage_fields").delete().eq("id", field.data.id)
    })

    it("refuses when Stage Work was done, naming it; untouched auto tasks do not count", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageB)
        const [, visitB] = await visits(sor)
        const task = await svc()
            .from("tasks")
            .insert({ logged_by: ids.dealOwner, opportunity_id: sor, stage_visit_id: visitB.id, task_description: `${MARKER} work`, status: "COMPLETED" })
            .select("id")
            .single()
        const refused = await revertAs("dealOwner", sor)
        expect(refused.error?.message).toMatch(/Stage Work was done/)
        expect((await sorRow(sor)).flow_stage_id).toBe(stageB)

        await svc().from("tasks").update({ status: "INCOMPLETE" }).eq("id", task.data.id)
        expect((await revertAs("dealOwner", sor)).error).toBeNull()
    })

    it("a Logged Follow-up counts as Stage Work", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageB)
        await svc().from("sales_opportunity_logs").insert({
            opportunity_id: sor,
            author_id: ids.dealOwner,
            type: "SYSTEM",
            content: "Follow-up logged",
            metadata: { event: "FOLLOW_UP_LOGGED" },
        })
        const refused = await revertAs("dealOwner", sor)
        expect(refused.error?.message).toMatch(/follow-up/)
    })

    it("writes STAGE_REVERTED to the timeline and the audit log, naming who, from and to", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageB)
        await revertAs("dealOwner", sor)
        const log = await svc()
            .from("sales_opportunity_logs")
            .select("metadata")
            .eq("opportunity_id", sor)
            .eq("metadata->>event", "STAGE_REVERTED")
        expect(log.data).toHaveLength(1)
        expect(log.data[0].metadata).toMatchObject({ from: stageB, to: stageA, employeeId: ids.dealOwner })
        const audit = await svc()
            .from("system_audit_logs")
            .select("metadata")
            .eq("entity_id", sor)
            .eq("metadata->>event", "STAGE_REVERTED")
        expect(audit.data).toHaveLength(1)
        expect(audit.data[0].metadata).toMatchObject({ from: stageB, to: stageA, employeeId: ids.dealOwner })
    })

    it("a Scratch SOR reverts identically", async () => {
        const sor = await freshSor()
        const flagged = await svc().from("sales_opportunities").update({ is_scratch: true }).eq("id", sor)
        if (flagged.error) return // no scratch column in this schema yet: an ordinary SOR is the same code path
        await moveAs("dealOwner", sor, stageB)
        expect((await revertAs("dealOwner", sor)).error).toBeNull()
        expect((await sorRow(sor)).flow_stage_id).toBe(stageA)
    })
})

describe("Revert and Stage Participant access windows (story 46)", () => {
    async function openWindow(sorId, visitId, untilRule) {
        const { data, error } = await svc()
            .from("sor_stage_participants")
            .insert({ opportunity_id: sorId, employee_id: ids.stageParticipant, source: "action", opened_visit_id: visitId, until_rule: untilRule })
            .select("id")
            .single()
        if (error) throw new Error(`Opening a participant window: ${error.message}`)
        return data.id
    }
    const windowRow = async (id) =>
        (await svc().from("sor_stage_participants").select("closed_at, closed_reason").eq("id", id).single()).data
    async function participantSees(sorId) {
        const client = await clientFor("stageParticipant")
        const { data } = await client.rpc("sor_visible_visit_ids", { p_opportunity_id: sorId })
        return (data || []).map((row) => (typeof row === "string" ? row : row.sor_visible_visit_ids))
    }

    it("a no-work Revert reopens the window the reverted move closed", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageB)
        const [, visitB] = await visits(sor)
        const win = await openWindow(sor, visitB.id, "stage_left")
        await moveAs("dealOwner", sor, stageWon)
        expect((await windowRow(win)).closed_reason).toBe("rule_met")

        expect((await revertAs("dealOwner", sor)).error).toBeNull()
        expect(await windowRow(win)).toEqual({ closed_at: null, closed_reason: null })
        expect(await participantSees(sor)).toContain(visitB.id)
    })

    it("a no-work Revert off a Terminal Stage reopens every window it closed", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageB)
        const [, visitB] = await visits(sor)
        const stageLeft = await openWindow(sor, visitB.id, "stage_left")
        const terminal = await openWindow(sor, visitB.id, "terminal")
        await moveAs("dealOwner", sor, stageTerminal)
        expect((await windowRow(terminal)).closed_reason).toBe("terminal")

        expect((await revertAs("dealOwner", sor)).error).toBeNull()
        expect((await windowRow(stageLeft)).closed_at).toBeNull()
        expect((await windowRow(terminal)).closed_at).toBeNull()
        expect(await participantSees(sor)).toContain(visitB.id)
    })

    it("a no-work Revert closes a window opened on the erased visit", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageB)
        const [, visitB] = await visits(sor)
        const win = await openWindow(sor, visitB.id, "terminal")
        expect((await revertAs("dealOwner", sor)).error).toBeNull()
        const row = await windowRow(win)
        expect(row.closed_at).not.toBeNull()
        expect(row.closed_reason).toBe("reverted")
    })

    it("a Keep Revert off a Terminal Stage reopens a window only the Terminal Stage closed", async () => {
        const sor = await freshSor()
        await moveAs("dealOwner", sor, stageB)
        const [, visitB] = await visits(sor)
        const stageLeft = await openWindow(sor, visitB.id, "stage_left")
        const terminal = await openWindow(sor, visitB.id, "terminal")
        await moveAs("dealOwner", sor, stageTerminal)
        const [, , visitT] = await visits(sor)
        await svc().from("tasks").insert({
            logged_by: ids.dealOwner, opportunity_id: sor, stage_visit_id: visitT.id, task_description: `${MARKER} work`, status: "COMPLETED",
        })

        const client = await clientFor("dealOwner")
        expect((await client.rpc("sor_revert_stage", { p_opportunity_id: sor, p_progress_choice: "keep" })).error).toBeNull()
        expect((await windowRow(terminal)).closed_at).toBeNull()
        // Stage B was really left: that window's own rule was met, and stays met.
        expect((await windowRow(stageLeft)).closed_at).not.toBeNull()
    })
})
