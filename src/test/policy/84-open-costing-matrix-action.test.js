/**
 * Open Costing Matrix (#462, spec #266, ADR 0033): the Stage Action that mounts an
 * SOR's one Costing Matrix, copying Open Purchase Request (#304).
 *
 * `stageParticipant` is given Purchasing access for this file only (it is the
 * Purchasing Incharge the config names); `dealOwner` and `support` are the Deal Team.
 * Everything is read back with the service role, so a pass is the RPC's doing and not
 * a read policy's, except where a test says whose view it is.
 *
 * Each action's config is the one saved in the SOR's Flow Snapshot, the way the Flow
 * Canvas modal saves it. Whatever a caller sends along is ignored, so every run here
 * also sends a decoy that would change the outcome if it were read.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { purgeCostingForSors } from "./support/costing.js"

const svc = () => serviceClient()

const NO_ID = "00000000-0000-0000-0000-000000000000"
// Built on use: the cast's ids are only known once it is loaded.
const decoy = () => ({
    salesIncharge: { type: "employee", id: ids.ordinary },
    purchasingIncharge: { type: "employee", id: ids.ordinary },
    extras: [{ type: "employee", id: ids.outsider }],
    access: { until: "terminal" },
})

let saleTypeId, flowId, stageId, laterStageId, firstActionId, topUpActionId, prActionId
let presetId, otherPresetId, offPresetId
let snapshotVersion = 9900
const sorIds = []

async function one(query, what) {
    const { data, error } = await query.select("id").single()
    if (error) throw new Error(`${what}: ${error.message}`)
    return data.id
}

const employee = (id) => ({ type: "employee", id })

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.stageParticipant)
    if (flag.error) throw flag.error

    saleTypeId = await one(svc().from("sale_types").insert({ name: `${MARKER} Open Costing Matrix` }), "sale type")
    flowId = await one(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }), "flow")
    stageId = await one(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Stage`, sort_order: 10 }), "stage")
    laterStageId = await one(
        svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Later Stage`, sort_order: 20 }),
        "later stage",
    )
    firstActionId = await one(svc().from("flow_stage_actions").insert({ stage_id: stageId, kind: "open_costing_matrix" }), "action")
    topUpActionId = await one(svc().from("flow_stage_actions").insert({ stage_id: stageId, kind: "open_costing_matrix" }), "second action")
    prActionId = await one(svc().from("flow_stage_actions").insert({ stage_id: stageId, kind: "open_purchase_request" }), "PR action")

    presetId = await one(
        svc().from("costing_markup_presets").insert({ label: `${MARKER} Government`, factor: 1.35 }),
        "preset",
    )
    otherPresetId = await one(
        svc().from("costing_markup_presets").insert({ label: `${MARKER} Private`, factor: 1.5 }),
        "other preset",
    )
    offPresetId = await one(
        svc().from("costing_markup_presets").insert({ label: `${MARKER} Retired`, factor: 1.1, active: false }),
        "switched-off preset",
    )
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.stageParticipant)
    await svc().from("purchase_requests").delete().in("opportunity_id", sorIds)
    await svc().from("notifications").delete().in("reference_id", sorIds)
    await purgeCostingForSors(sorIds)
    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sor_action_runs").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_snapshots").delete().eq("flow_id", flowId)
    await svc().from("flow_stage_actions").delete().in("id", [firstActionId, topUpActionId, prActionId])
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
    await svc().from("costing_markup_presets").delete().in("id", [presetId, otherPresetId, offPresetId])
})

/** An SOR on the first Stage, under a Flow Snapshot that saves each action's config. */
async function freshSor({ first = {}, topUp = {}, pr = {} } = {}) {
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
                    { id: firstActionId, stage_id: stageId, kind: "open_costing_matrix", config: first },
                    { id: topUpActionId, stage_id: stageId, kind: "open_costing_matrix", config: topUp },
                    { id: prActionId, stage_id: stageId, kind: "open_purchase_request", config: pr },
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
async function run(sorId, actionIds, { confirm = false, kind = "open_costing_matrix" } = {}) {
    const visitId = await visitOf(sorId)
    const { data, error } = await (await clientFor("dealOwner")).rpc("sor_run_stage_actions", {
        p_opportunity_id: sorId,
        p_stage_id: stageId,
        p_stage_visit_id: visitId,
        p_actions: actionIds.map((id) => ({
            action_id: id,
            kind: id === prActionId ? "open_purchase_request" : kind,
            name: "Open Costing Matrix",
            confirm,
            decider: confirm ? [{ type: "role", role: "deal_owner" }] : undefined,
            decider_ids: confirm ? [ids.dealOwner] : undefined,
            costing_matrix: decoy(),
        })),
    })
    if (error) throw new Error(error.message)
    return data
}

async function runOf(sorId, actionId) {
    const { data } = await svc().from("sor_action_runs").select("*").eq("opportunity_id", sorId).eq("action_id", actionId).single()
    return data
}

async function matricesOf(sorId) {
    const { data } = await svc().from("costing_matrices").select("*").eq("opportunity_id", sorId)
    return data
}

async function moneyOf(matrixId) {
    const { data } = await svc().from("costing_matrix_money").select("*").eq("matrix_id", matrixId).single()
    return data
}

async function windowsOf(sorId, { open = true } = {}) {
    let query = svc().from("sor_stage_participants").select("*").eq("opportunity_id", sorId).eq("source", "costing_matrix")
    if (open) query = query.is("closed_at", null)
    const { data } = await query
    return data
}

async function neededNotes(sorId) {
    const { data } = await svc()
        .from("notifications")
        .select("recipient_id")
        .eq("reference_id", sorId)
        .eq("type", "OPPORTUNITY_COSTING_INCHARGE_NEEDED")
    return data.map((n) => n.recipient_id).sort()
}

describe("running the action", () => {
    it("creates exactly one matrix with the configured Incharges and markup default", async () => {
        const sorId = await freshSor({
            first: { purchasingIncharge: employee(ids.stageParticipant), markupPresetId: presetId },
        })
        const result = await run(sorId, [firstActionId])
        expect(result.failed).toEqual([])

        const matrices = await matricesOf(sorId)
        expect(matrices).toHaveLength(1)
        expect(matrices[0].sales_incharge_id).toBe(ids.dealOwner)
        expect(matrices[0].purchasing_incharge_id).toBe(ids.stageParticipant)

        const money = await moneyOf(matrices[0].id)
        expect(Number(money.default_factor)).toBe(1.35)
        expect(money.default_preset_id).toBe(presetId)

        const record = await runOf(sorId, firstActionId)
        expect(record.outcome).toBe("created")
        expect(record.costing_matrix_id).toBe(matrices[0].id)
        expect(result.created).toEqual([
            { action_id: firstActionId, kind: "open_costing_matrix", matrix_id: matrices[0].id },
        ])
    })

    it("takes the Sales Incharge from the configured role or person, the Deal Owner role by default", async () => {
        const byRole = await freshSor({ first: { salesIncharge: { type: "role", role: "sales_director" } } })
        await run(byRole, [firstActionId])
        expect((await matricesOf(byRole))[0].sales_incharge_id).toBe(ids.head)

        const byPerson = await freshSor({ first: { salesIncharge: employee(ids.support) } })
        await run(byPerson, [firstActionId])
        expect((await matricesOf(byPerson))[0].sales_incharge_id).toBe(ids.support)

        const byDefault = await freshSor({ first: {} })
        await run(byDefault, [firstActionId])
        expect((await matricesOf(byDefault))[0].sales_incharge_id).toBe(ids.dealOwner)
    })

    it("reads the saved config, not the one the caller sends", async () => {
        const sorId = await freshSor()
        await run(sorId, [firstActionId])
        const [matrix] = await matricesOf(sorId)
        expect(matrix.sales_incharge_id).toBe(ids.dealOwner)
        expect(matrix.purchasing_incharge_id).toBeNull()
        expect(await windowsOf(sorId)).toHaveLength(0)
    })

    it("calls in the extra members with a window on the opening visit, and no one else", async () => {
        const sorId = await freshSor({
            first: { extras: [employee(ids.ordinary), { type: "team", team: "LOGISTICS" }], access: { until: "terminal" } },
        })
        const visitId = await visitOf(sorId)
        await run(sorId, [firstActionId])
        const [matrix] = await matricesOf(sorId)

        const windows = await windowsOf(sorId)
        const people = windows.map((w) => w.employee_id)
        expect(people).toContain(ids.ordinary)
        expect(people).toContain(ids.outsider)
        expect(people).not.toContain(ids.dealOwner)
        for (const w of windows) {
            expect(w.opened_visit_id).toBe(visitId)
            expect(w.until_rule).toBe("terminal")
            expect(w.source_id).toBe(matrix.id)
        }
    })

    it("lets a called-in member read the matrix without money, and tells them", async () => {
        const sorId = await freshSor({ first: { extras: [employee(ids.ordinary)], markupPresetId: presetId } })
        await run(sorId, [firstActionId])

        const client = await clientFor("ordinary")
        const tier = await client.rpc("costing_tier", { p_opportunity_id: sorId })
        expect(tier.data).toBe("participant")
        const read = await client.rpc("costing_matrix_read", { p_opportunity_id: sorId })
        expect(read.error).toBeNull()
        expect(read.data.tier).toBe("participant")
        expect(JSON.stringify(read.data)).not.toMatch(/default_factor|default_preset_id/)

        const { data: notes } = await svc()
            .from("notifications")
            .select("type")
            .eq("recipient_id", ids.ordinary)
            .eq("reference_id", sorId)
        expect(notes.map((n) => n.type)).toContain("SOR_STAGE_PARTICIPANT_ADDED")
    })

    it("does not take a switched-off preset", async () => {
        const sorId = await freshSor({ first: { markupPresetId: offPresetId } })
        await run(sorId, [firstActionId])
        const [matrix] = await matricesOf(sorId)
        const money = await moneyOf(matrix.id)
        expect(money.default_factor).toBeNull()
        expect(money.default_preset_id).toBeNull()
    })

    it("re-running the same action opens nothing new and changes nothing", async () => {
        const sorId = await freshSor({ first: { extras: [employee(ids.ordinary)], markupPresetId: presetId } })
        await run(sorId, [firstActionId])
        const [before] = await matricesOf(sorId)
        const windowsBefore = await windowsOf(sorId)

        await run(sorId, [firstActionId])
        expect(await matricesOf(sorId)).toEqual([before])
        expect((await windowsOf(sorId)).map((w) => w.id).sort()).toEqual(windowsBefore.map((w) => w.id).sort())
    })
})

describe("a second action on the same SOR", () => {
    it("creates none, fills only what is empty and adds only the members it is missing", async () => {
        const sorId = await freshSor({
            first: { extras: [employee(ids.ordinary)] },
            topUp: {
                salesIncharge: employee(ids.support),
                purchasingIncharge: employee(ids.stageParticipant),
                markupPresetId: presetId,
                extras: [employee(ids.ordinary), employee(ids.outsider)],
            },
        })
        await run(sorId, [firstActionId])
        const [first] = await matricesOf(sorId)
        expect(first.purchasing_incharge_id).toBeNull()
        const ordinaryWindow = (await windowsOf(sorId))[0]

        await run(sorId, [topUpActionId])
        const matrices = await matricesOf(sorId)
        expect(matrices).toHaveLength(1)
        expect(matrices[0].id).toBe(first.id)
        // The blank Purchasing Incharge is filled; the Sales Incharge the first run set stays.
        expect(matrices[0].purchasing_incharge_id).toBe(ids.stageParticipant)
        expect(matrices[0].sales_incharge_id).toBe(ids.dealOwner)
        const money = await moneyOf(first.id)
        expect(Number(money.default_factor)).toBe(1.35)

        // Only the missing member is added; the one already in keeps the same window.
        const windows = await windowsOf(sorId)
        expect(windows.map((w) => w.employee_id).sort()).toEqual([ids.ordinary, ids.outsider].sort())
        expect(windows.find((w) => w.employee_id === ids.ordinary).id).toBe(ordinaryWindow.id)
        expect((await runOf(sorId, topUpActionId)).costing_matrix_id).toBe(first.id)
    })

    it("never replaces an Incharge, a typed factor or a chosen preset", async () => {
        const sorId = await freshSor({
            first: { purchasingIncharge: employee(ids.stageParticipant), markupPresetId: presetId },
            topUp: {
                salesIncharge: employee(ids.support),
                purchasingIncharge: employee(ids.head),
                markupPresetId: otherPresetId,
                extras: [employee(ids.ordinary)],
            },
        })
        await run(sorId, [firstActionId])
        await run(sorId, [topUpActionId])
        const [matrix] = await matricesOf(sorId)
        expect(matrix.sales_incharge_id).toBe(ids.dealOwner)
        expect(matrix.purchasing_incharge_id).toBe(ids.stageParticipant)
        const money = await moneyOf(matrix.id)
        expect(Number(money.default_factor)).toBe(1.35)
        expect(money.default_preset_id).toBe(presetId)

        // A factor typed by hand is not replaced by a preset either.
        const typed = await freshSor({ topUp: { markupPresetId: presetId } })
        await run(typed, [firstActionId])
        const [typedMatrix] = await matricesOf(typed)
        await svc().from("costing_matrix_money").update({ default_factor: 1.2 }).eq("matrix_id", typedMatrix.id)
        await run(typed, [topUpActionId])
        const typedMoney = await moneyOf(typedMatrix.id)
        expect(Number(typedMoney.default_factor)).toBe(1.2)
        expect(typedMoney.default_preset_id).toBeNull()
    })

    it("removes and closes nothing", async () => {
        const sorId = await freshSor({ first: { extras: [employee(ids.ordinary)] }, topUp: {} })
        await run(sorId, [firstActionId])
        await run(sorId, [topUpActionId])
        const all = await windowsOf(sorId, { open: false })
        expect(all).toHaveLength(1)
        expect(all[0].closed_at).toBeNull()
    })
})

describe("no Purchasing Incharge", () => {
    it("opens the matrix without one and tells the people who assign it", async () => {
        const sorId = await freshSor({
            first: { assigners: [employee(ids.head), employee(ids.support)] },
        })
        const result = await run(sorId, [firstActionId])
        expect(result.failed).toEqual([])
        const [matrix] = await matricesOf(sorId)
        expect(matrix.purchasing_incharge_id).toBeNull()
        expect(await neededNotes(sorId)).toEqual([ids.head, ids.support].sort())

        const { data: note } = await svc()
            .from("notifications")
            .select("title, message")
            .eq("reference_id", sorId)
            .eq("recipient_id", ids.head)
            .eq("type", "OPPORTUNITY_COSTING_INCHARGE_NEEDED")
            .single()
        expect(note.title).toMatch(/Purchasing Incharge/)
    })

    it("does not tell anyone when a Purchasing Incharge is named, or when the list is empty", async () => {
        const named = await freshSor({
            first: { purchasingIncharge: employee(ids.stageParticipant), assigners: [employee(ids.head)] },
        })
        await run(named, [firstActionId])
        expect(await neededNotes(named)).toEqual([])

        const nobody = await freshSor({ first: {} })
        await run(nobody, [firstActionId])
        expect(await neededNotes(nobody)).toEqual([])
    })

    it("tells them once: a later run does not tell them again", async () => {
        const sorId = await freshSor({
            first: { assigners: [employee(ids.head)] },
            topUp: { assigners: [employee(ids.head)] },
        })
        await run(sorId, [firstActionId])
        await run(sorId, [topUpActionId])
        expect(await neededNotes(sorId)).toEqual([ids.head])
    })
})

describe("an Optional Action", () => {
    it("opens the matrix once a Decider picks Create", async () => {
        const sorId = await freshSor({ first: { purchasingIncharge: employee(ids.stageParticipant) } })
        await run(sorId, [firstActionId], { confirm: true })
        expect(await matricesOf(sorId)).toHaveLength(0)

        const pending = await runOf(sorId, firstActionId)
        expect(pending.outcome).toBe("pending")

        const client = await clientFor("dealOwner")
        const decided = await client.rpc("sor_decide_action_run", {
            p_run_id: pending.id,
            p_decision: "create",
            p_actor_id: ids.dealOwner,
        })
        expect(decided.error).toBeNull()

        const opened = await client.rpc("sor_open_costing_matrix", { p_run_id: pending.id })
        expect(opened.error).toBeNull()
        const [matrix] = await matricesOf(sorId)
        expect(opened.data).toBe(matrix.id)
        expect(matrix.purchasing_incharge_id).toBe(ids.stageParticipant)
        expect((await runOf(sorId, firstActionId)).costing_matrix_id).toBe(matrix.id)
    })
})

describe("who may run it", () => {
    it("is not callable as costing_open_matrix by a signed-in client, nor insertable", async () => {
        const sorId = await freshSor()
        const client = await clientFor("dealOwner")
        const call = await client.rpc("costing_open_matrix", { p_opportunity_id: sorId, p_config: {} })
        expect(call.error?.message).toMatch(/permission denied/i)

        const insert = await client.from("costing_matrices").insert({ opportunity_id: sorId })
        expect(insert.error).not.toBeNull()
        expect(await matricesOf(sorId)).toHaveLength(0)

        const superCall = await (await clientFor("superAdmin")).rpc("costing_open_matrix", { p_opportunity_id: sorId, p_config: {} })
        expect(superCall.error?.message).toMatch(/permission denied/i)
    })

    it("refuses a run that already opened its matrix, so a Deal Team member cannot re-run it with their own config", async () => {
        const sorId = await freshSor()
        await run(sorId, [firstActionId])
        const [before] = await matricesOf(sorId)
        const runRow = await runOf(sorId, firstActionId)

        const { error } = await (await clientFor("support")).rpc("sor_open_costing_matrix", {
            p_run_id: runRow.id,
            p_config: { purchasingIncharge: employee(ids.support) },
        })
        expect(error?.code).toBe("42501")
        const [after] = await matricesOf(sorId)
        expect(after.purchasing_incharge_id).toBe(before.purchasing_incharge_id)
    })

    it("refuses someone with no access to the SOR", async () => {
        const sorId = await freshSor()
        await run(sorId, [firstActionId], { confirm: true })
        const pending = await runOf(sorId, firstActionId)
        const { error } = await (await clientFor("ordinary")).rpc("sor_open_costing_matrix", { p_run_id: pending.id })
        expect(error?.code).toBe("42501")
        expect(await matricesOf(sorId)).toHaveLength(0)
    })

    it("refuses a run whose action is not an Open Costing Matrix", async () => {
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
            const { error } = await (await clientFor("dealOwner")).rpc("sor_open_costing_matrix", { p_run_id: runId })
            expect(error).not.toBeNull()
            expect(await matricesOf(sorId)).toHaveLength(0)
        } finally {
            await svc().from("sor_action_runs").delete().eq("action_id", taskActionId)
            await svc().from("flow_stage_actions").delete().eq("id", taskActionId)
        }
    })

    it("cannot be called by someone not signed in", async () => {
        const open = await anonymousClient().rpc("sor_open_costing_matrix", { p_run_id: NO_ID })
        expect(open.error?.message).toMatch(/permission denied/i)
        const raw = await anonymousClient().rpc("costing_open_matrix", { p_opportunity_id: NO_ID })
        expect(raw.error?.message).toMatch(/permission denied/i)
    })
})

describe("a Purchase Request that takes the Costing Purchasing Incharge as its Buyer", () => {
    const costingBuyer = { buyer: { type: "costing_incharge" } }

    it("takes the matrix's Purchasing Incharge", async () => {
        const sorId = await freshSor({ first: { purchasingIncharge: employee(ids.stageParticipant) }, pr: costingBuyer })
        await run(sorId, [firstActionId])
        await run(sorId, [prActionId])
        const { data: requests } = await svc().from("purchase_requests").select("buyer_id").eq("opportunity_id", sorId)
        expect(requests).toHaveLength(1)
        expect(requests[0].buyer_id).toBe(ids.stageParticipant)
    })

    it("has no Buyer when there is no matrix, or the matrix names none", async () => {
        const noMatrix = await freshSor({ pr: costingBuyer })
        await run(noMatrix, [prActionId])
        const { data: first } = await svc().from("purchase_requests").select("buyer_id").eq("opportunity_id", noMatrix)
        expect(first[0].buyer_id).toBeNull()

        const noIncharge = await freshSor({ pr: costingBuyer })
        await run(noIncharge, [firstActionId])
        await run(noIncharge, [prActionId])
        const { data: second } = await svc().from("purchase_requests").select("buyer_id").eq("opportunity_id", noIncharge)
        expect(second[0].buyer_id).toBeNull()
    })
})

describe("the schema", () => {
    it("accepts the new action kind and window source, and keeps the old ones", async () => {
        const kinds = ["create_group_task", "create_individual_task", "open_purchase_request", "open_costing_matrix"]
        for (const kind of kinds) {
            const { error } = await svc().from("flow_stage_actions").insert({ stage_id: laterStageId, kind }).select("id").single()
            expect(error, kind).toBeNull()
        }
        await svc().from("flow_stage_actions").delete().eq("stage_id", laterStageId)
        const bad = await svc().from("flow_stage_actions").insert({ stage_id: laterStageId, kind: "open_something" })
        expect(bad.error).not.toBeNull()
    })
})
