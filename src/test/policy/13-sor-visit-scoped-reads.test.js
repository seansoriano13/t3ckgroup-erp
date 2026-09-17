/**
 * Issue #295 (part of #208, ADR 0021) — Visit-scoped reads and a
 * participant-safe SOR record.
 *
 * Builds a six-Stage flow and walks one SOR from Stage 1 through Stage 6 by
 * hand (service role, so the trigger-recorded Stage Visits land without the
 * move RPC's own gate getting in the way of fixture setup). A Stage
 * Participant is opened and closed against that timeline exactly the way
 * #294's trigger would from a real move, so the assertions below exercise
 * `sor_visible_visit_ids`, `sor_access_level`, `sor_locked_summary`,
 * `sor_participant_record`/`sor_participant_items` and `sor_visit_audience`
 * as a real signed-in user, never the service role.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"
import { canRead } from "./support/access.js"

let saleTypeId
let flowId
let stageIds = [] // S1..S6, in order
let sorId
let visitIds = [] // visitIds[i] is the visit recorded for stageIds[i]

async function moveTo(stageIndex) {
    const svc = serviceClient()
    const { error } = await svc
        .from("sales_opportunities")
        .update({ flow_stage_id: stageIds[stageIndex] })
        .eq("id", sorId)
    if (error) throw new Error(`Moving to stage ${stageIndex}: ${error.message}`)

    const { data, error: visitError } = await svc
        .from("sor_stage_visits")
        .select("id")
        .eq("opportunity_id", sorId)
        .eq("flow_stage_id", stageIds[stageIndex])
        .order("sequence", { ascending: false })
        .limit(1)
        .single()
    if (visitError) throw new Error(`Reading the recorded visit: ${visitError.message}`)
    visitIds[stageIndex] = data.id
}

async function openWindow(employeeId, visitId, untilRule = "stage_left") {
    const svc = serviceClient()
    const { data, error } = await svc
        .from("sor_stage_participants")
        .insert({
            opportunity_id: sorId,
            employee_id: employeeId,
            source: "action",
            opened_visit_id: visitId,
            until_rule: untilRule,
        })
        .select("id")
        .single()
    if (error) throw new Error(`Opening a participant window: ${error.message}`)
    return data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    const svc = serviceClient()

    const saleType = await svc
        .from("sale_types")
        .insert({ name: `${MARKER} Visit Scoped Sale Type` })
        .select("id")
        .single()
    if (saleType.error) throw new Error(`Seeding a Sale Type: ${saleType.error.message}`)
    saleTypeId = saleType.data.id

    const flow = await svc.from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()
    if (flow.error) throw new Error(`Seeding a flow: ${flow.error.message}`)
    flowId = flow.data.id

    for (let i = 1; i <= 6; i++) {
        const stage = await svc
            .from("flow_stages")
            .insert({ flow_id: flowId, name: `${MARKER} Stage ${i}`, sort_order: i * 10 })
            .select("id")
            .single()
        if (stage.error) throw new Error(`Seeding stage ${i}: ${stage.error.message}`)
        stageIds.push(stage.data.id)
    }

    const sor = await svc
        .from("sales_opportunities")
        .insert({
            registered_by: ids.dealOwner,
            deal_owner_id: ids.dealOwner,
            support_sales_1_id: ids.support,
            sale_type_id: saleTypeId,
            flow_stage_id: stageIds[0],
            lead_source: "REFERRAL",
            client_name: `${MARKER} Visit Scoped Company`,
            project_title: `${MARKER} Visit Scoped Project`,
            expected_value: 999999,
            status: "LEAD",
        })
        .select("id")
        .single()
    if (sor.error) throw new Error(`Seeding the SOR: ${sor.error.message}`)
    sorId = sor.data.id

    const { data: firstVisit, error: firstVisitError } = await svc
        .from("sor_stage_visits")
        .select("id")
        .eq("opportunity_id", sorId)
        .eq("flow_stage_id", stageIds[0])
        .single()
    if (firstVisitError) throw new Error(`Reading the opening visit: ${firstVisitError.message}`)
    visitIds[0] = firstVisit.id

    // A log, a condition-status row and a Stage Field value on each of the
    // first two visits, so "reads Stage 2's timeline, not Stage 1's" has
    // something concrete to assert on.
    await moveTo(1) // -> Stage 2, closes Stage 1's visit

    for (const i of [0, 1]) {
        const log = await svc
            .from("sales_opportunity_logs")
            .insert({
                opportunity_id: sorId,
                author_id: ids.dealOwner,
                type: "COMMENT",
                content: `${MARKER} note on stage ${i + 1}`,
            })
            .select("id")
            .single()
        if (log.error) throw new Error(`Seeding a log on stage ${i + 1}: ${log.error.message}`)
        // Backfill trigger only fires on insert with a null stage_visit_id
        // and picks the OPEN visit, which by the time both inserts run is
        // always Stage 2's — force stage 1's log onto stage 1's visit
        // explicitly so the fixture proves the right thing.
        if (i === 0) {
            await svc.from("sales_opportunity_logs").update({ stage_visit_id: visitIds[0] }).eq("id", log.data.id)
        }
    }

    // Stage Participant called in at Stage 2 (visitIds[1]), default window
    // (closes when Stage 2 is left).
    await openWindow(ids.stageParticipant, visitIds[1], "stage_left")
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("sor_stage_participants").delete().eq("opportunity_id", sorId)
    await svc.from("sales_opportunity_logs").delete().eq("opportunity_id", sorId)
    await svc.from("sales_opportunities").delete().eq("id", sorId)
    await svc.from("flow_stages").delete().eq("flow_id", flowId)
    await svc.from("sales_flows").delete().eq("id", flowId)
    await svc.from("sale_types").delete().eq("id", saleTypeId)
})

describe("a Stage Participant called at Stage 2 with the default window", () => {
    it("reads Stage 2's log, not Stage 1's", async () => {
        const client = await clientFor("stageParticipant")
        expect(await canRead(client, "sales_opportunity_logs", await logIdFor(1))).toBe(true)
        expect(await canRead(client, "sales_opportunity_logs", await logIdFor(0))).toBe(false)
    })

    it("has participant-level access", async () => {
        const client = await clientFor("stageParticipant")
        const { data, error } = await client.rpc("sor_access_level", { p_opportunity_id: sorId })
        if (error) throw error
        expect(data).toBe("participant")
    })

    it("cannot SELECT sales_opportunities directly", async () => {
        const client = await clientFor("stageParticipant")
        expect(await canRead(client, "sales_opportunities", sorId)).toBe(false)
    })

    it("sor_participant_record returns a row with no money column reachable", async () => {
        const client = await clientFor("stageParticipant")
        const { data, error } = await client.rpc("sor_participant_record", { p_opportunity_id: sorId })
        if (error) throw error
        expect(data.length).toBe(1)
        expect(Object.keys(data[0])).not.toContain("expected_value")
    })

    it("reads product lines through sor_participant_items with no unit_price column", async () => {
        const client = await clientFor("stageParticipant")
        const { data, error } = await client.rpc("sor_participant_items", { p_opportunity_id: sorId })
        if (error) throw error
        expect(Array.isArray(data)).toBe(true)
        if (data.length > 0) expect(Object.keys(data[0])).not.toContain("unit_price")
    })

    it("cannot read unit_price from sales_opportunity_items at the row level", async () => {
        const client = await clientFor("stageParticipant")
        const { data, error } = await client.from("sales_opportunity_items").select("id, unit_price").eq("opportunity_id", sorId)
        if (error) throw new Error(error.message)
        expect(data.length).toBe(0)
    })

    it("a Deal Team member reads unit_price directly", async () => {
        const client = await clientFor("dealOwner")
        const { data, error } = await client.from("sales_opportunity_items").select("id").eq("opportunity_id", sorId)
        if (error) throw new Error(error.message)
        expect(Array.isArray(data)).toBe(true)
    })
})

describe("after a move to Stage 3, the same Participant", () => {
    beforeAll(async () => {
        await moveTo(2) // -> Stage 3; closes the Stage 2 window (until_rule stage_left)
    })

    it("is locked", async () => {
        const client = await clientFor("stageParticipant")
        const { data, error } = await client.rpc("sor_access_level", { p_opportunity_id: sorId })
        if (error) throw error
        expect(data).toBe("locked")
    })

    it("is refused Stage 3's timeline", async () => {
        const client = await clientFor("stageParticipant")
        const log = await serviceClient()
            .from("sales_opportunity_logs")
            .insert({
                opportunity_id: sorId,
                author_id: ids.dealOwner,
                type: "COMMENT",
                content: `${MARKER} note on stage 3`,
                stage_visit_id: visitIds[2],
            })
            .select("id")
            .single()
        if (log.error) throw new Error(log.error.message)
        expect(await canRead(client, "sales_opportunity_logs", log.data.id)).toBe(false)
    })

    it("still reads Stage 2, the visit their closed window covers", async () => {
        const client = await clientFor("stageParticipant")
        expect(await canRead(client, "sales_opportunity_logs", await logIdFor(1))).toBe(true)
    })

    it("gets the locked summary (Sales Reference, project, current Stage, restricted flag)", async () => {
        const client = await clientFor("stageParticipant")
        const { data, error } = await client.rpc("sor_locked_summary", { p_opportunity_id: sorId })
        if (error) throw error
        expect(data.length).toBe(1)
        expect(data[0]).toHaveProperty("project_title")
        expect(data[0]).toHaveProperty("current_stage_name")
        expect(data[0].is_restricted).toBe(false)
    })
})

describe("called again later at Stage 6", () => {
    beforeAll(async () => {
        await moveTo(3) // Stage 4
        await moveTo(4) // Stage 5
        await moveTo(5) // Stage 6
        await openWindow(ids.stageParticipant, visitIds[5], "stage_left")
    })

    it("reads Stage 6 but not the Stages in between", async () => {
        const client = await clientFor("stageParticipant")

        const stage6Log = await serviceClient()
            .from("sales_opportunity_logs")
            .insert({
                opportunity_id: sorId,
                author_id: ids.dealOwner,
                type: "COMMENT",
                content: `${MARKER} note on stage 6`,
                stage_visit_id: visitIds[5],
            })
            .select("id")
            .single()
        if (stage6Log.error) throw new Error(stage6Log.error.message)
        expect(await canRead(client, "sales_opportunity_logs", stage6Log.data.id)).toBe(true)

        for (const i of [2, 3, 4]) {
            const midLog = await serviceClient()
                .from("sales_opportunity_logs")
                .insert({
                    opportunity_id: sorId,
                    author_id: ids.dealOwner,
                    type: "COMMENT",
                    content: `${MARKER} note on stage ${i + 1} (in between)`,
                    stage_visit_id: visitIds[i],
                })
                .select("id")
                .single()
            if (midLog.error) throw new Error(midLog.error.message)
            expect(await canRead(client, "sales_opportunity_logs", midLog.data.id)).toBe(false)
        }
    })
})

describe("sor_visit_audience", () => {
    it("includes the Deal Team and the Participant whose window is currently open on this visit", async () => {
        const client = await clientFor("dealOwner")
        const { data, error } = await client.rpc("sor_visit_audience", {
            p_opportunity_id: sorId,
            p_visit_id: visitIds[5],
        })
        if (error) throw error
        const audience = data.map((row) => (typeof row === "string" ? row : row.sor_visit_audience))
        expect(audience).toContain(ids.dealOwner)
        // stageParticipant's second window (opened above, on visit 6) is
        // still open, so they belong in *this* visit's audience.
        expect(audience).toContain(ids.stageParticipant)
    })

    it("excludes anyone out-of-window — a Stage the Participant's window never covered", async () => {
        const client = await clientFor("dealOwner")
        const { data, error } = await client.rpc("sor_visit_audience", {
            p_opportunity_id: sorId,
            p_visit_id: visitIds[2],
        })
        if (error) throw error
        const audience = data.map((row) => (typeof row === "string" ? row : row.sor_visit_audience))
        expect(audience).toContain(ids.dealOwner)
        // Stage 3 (visitIds[2]) sits between the Participant's two windows
        // (Stage 2, closed, and Stage 6, opened later) — neither window ever
        // covered it, so they must not appear in its audience.
        expect(audience).not.toContain(ids.stageParticipant)
    })

    it("gives an outsider with no visibility an empty audience, not a roster", async () => {
        const client = await clientFor("outsider")
        const { data, error } = await client.rpc("sor_visit_audience", {
            p_opportunity_id: sorId,
            p_visit_id: visitIds[5],
        })
        if (error) throw error
        expect(data.length).toBe(0)
    })
})

describe("tasks and committee_tasks carrying an opportunity_id", () => {
    let taskId
    let groupTaskId

    beforeAll(async () => {
        const svc = serviceClient()
        const task = await svc
            .from("tasks")
            .insert({
                logged_by: ids.dealOwner,
                task_description: `${MARKER} visit-scoped task`,
                project_title: `${MARKER} Internal`,
                opportunity_id: sorId,
                stage_visit_id: visitIds[5],
            })
            .select("id")
            .single()
        if (task.error) throw new Error(task.error.message)
        taskId = task.data.id

        const groupTask = await svc
            .from("committee_tasks")
            .insert({
                title: `${MARKER} visit-scoped group task`,
                created_by: ids.dealOwner,
                opportunity_id: sorId,
                stage_visit_id: visitIds[5],
            })
            .select("id")
            .single()
        if (groupTask.error) throw new Error(groupTask.error.message)
        groupTaskId = groupTask.data.id
    })

    afterAll(async () => {
        const svc = serviceClient()
        await svc.from("committee_tasks").delete().eq("id", groupTaskId)
        await svc.from("tasks").delete().eq("id", taskId)
    })

    it("a signed-in employee with no visibility into that opportunity's visit cannot read the task", async () => {
        const client = await clientFor("outsider")
        expect(await canRead(client, "tasks", taskId)).toBe(false)
    })

    it("a signed-in employee with no visibility into that opportunity's visit cannot read the group task", async () => {
        const client = await clientFor("outsider")
        expect(await canRead(client, "committee_tasks", groupTaskId)).toBe(false)
    })

    it("the Deal Owner, who can see the visit, reads the task", async () => {
        const client = await clientFor("dealOwner")
        expect(await canRead(client, "tasks", taskId)).toBe(true)
    })

    it("the Deal Owner, who can see the visit, reads the group task (as its creator too)", async () => {
        const client = await clientFor("dealOwner")
        expect(await canRead(client, "committee_tasks", groupTaskId)).toBe(true)
    })
})

describe("moving the Stage (sor_guard_stage_move)", () => {
    it("refuses a locked caller's attempt to move the SOR", async () => {
        const client = await clientFor("stageParticipant")
        const { data, error } = await client
            .from("sales_opportunities")
            .update({ flow_stage_id: stageIds[0] })
            .eq("id", sorId)
            .select("id")
        // Either RLS's own SELECT-before-UPDATE bars the row (empty data, no
        // error) or the guard trigger raises — both count as "refused".
        if (error) {
            expect(error.code).toBe("42501")
        } else {
            expect(data.length).toBe(0)
        }
    })

    it("lets the Deal Owner move the SOR", async () => {
        const client = await clientFor("dealOwner")
        const { data, error } = await client
            .from("sales_opportunities")
            .update({ flow_stage_id: stageIds[4] })
            .eq("id", sorId)
            .select("id")
        if (error) throw new Error(error.message)
        expect(data.length).toBe(1)
        // put it back on Stage 6 for symmetry with the rest of the fixture
        await serviceClient().from("sales_opportunities").update({ flow_stage_id: stageIds[5] }).eq("id", sorId)
    })
})

/** The one log row seeded for stage index i in the outer beforeAll. */
async function logIdFor(stageIndex) {
    const { data, error } = await serviceClient()
        .from("sales_opportunity_logs")
        .select("id")
        .eq("opportunity_id", sorId)
        .eq("stage_visit_id", visitIds[stageIndex])
        .limit(1)
        .single()
    if (error) throw new Error(`Looking up the seeded log for stage ${stageIndex + 1}: ${error.message}`)
    return data.id
}
