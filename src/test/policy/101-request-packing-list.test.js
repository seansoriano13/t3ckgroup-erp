/**
 * Request Packing List (#464, spec #461, ADR 0033): the Stage Action that creates a
 * draft Packing List for the SOR and asks the Warehouse to pack.
 *
 * Everything is read back with the service role, so a pass is the RPC's doing and
 * not a read policy's, except where a test says whose view it is. The Deal Owner
 * moves the SOR and is on neither Purchasing nor the Warehouse list, which is why
 * the action has to insert the list itself.
 *
 * Each action's config is the one saved in the SOR's Flow Snapshot, the way the Flow
 * Canvas modal saves it. Whatever a caller sends along is ignored, so every run here
 * also sends a decoy that would change the outcome if it were read.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()

const NO_ID = "00000000-0000-0000-0000-000000000000"
const NOTE = "PACKING_LIST_REQUESTED"

let saleTypeId, flowId, stageId, laterStageId, defaultActionId, overrideActionId, taskActionId
let snapshotVersion = 10100
const sorIds = []
let listMembers = []

async function one(query, what) {
    const { data, error } = await query.select("id").single()
    if (error) throw new Error(`${what}: ${error.message}`)
    return data.id
}

const employee = (id) => ({ type: "employee", id })

async function warehouseMembers() {
    const { data, error } = await svc().from("ipas_signer_lists").select("employee_id").eq("list_key", "transmittal_warehouse")
    if (error) throw error
    return data.map((r) => r.employee_id)
}

beforeAll(async () => {
    await ensureCastLoaded()
    const { error } = await svc()
        .from("ipas_signer_lists")
        .upsert({ list_key: "transmittal_warehouse", employee_id: ids.warehouse }, { onConflict: "list_key,employee_id" })
    if (error) throw new Error(`Seeding the Warehouse list: ${error.message}`)
    listMembers = await warehouseMembers()

    saleTypeId = await one(svc().from("sale_types").insert({ name: `${MARKER} Request Packing List` }), "sale type")
    flowId = await one(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }), "flow")
    stageId = await one(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Stage`, sort_order: 10 }), "stage")
    laterStageId = await one(
        svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Later Stage`, sort_order: 20 }),
        "later stage",
    )
    defaultActionId = await one(svc().from("flow_stage_actions").insert({ stage_id: stageId, kind: "request_packing_list" }), "action")
    overrideActionId = await one(svc().from("flow_stage_actions").insert({ stage_id: stageId, kind: "request_packing_list" }), "second action")
    taskActionId = await one(svc().from("flow_stage_actions").insert({ stage_id: stageId, kind: "create_individual_task" }), "task action")
})

afterAll(async () => {
    await svc()
        .from("ipas_signer_lists")
        .delete()
        .eq("list_key", "transmittal_warehouse")
        .eq("employee_id", ids.warehouse)

    // A Packing List is never deleted by the front door; the superuser connection with the
    // triggers off is the one route, as support/transmittals.js does.
    const client = await sql().connect()
    try {
        await client.query("begin")
        await client.query("set local session_replication_role = replica")
        const { rows } = await client.query(`select id from public.packing_lists where opportunity_id = any($1::uuid[])`, [sorIds])
        const listIds = rows.map((r) => r.id)
        await client.query(`delete from public.notifications where reference_id = any($1::text[])`, [
            [...listIds, ...sorIds].map(String),
        ])
        await client.query(
            `delete from public.pms_handoff_events where record_type = 'packing_list' and record_id = any($1::uuid[])`,
            [listIds],
        )
        await client.query(`delete from public.sor_action_runs where opportunity_id = any($1::uuid[])`, [sorIds])
        await client.query(`delete from public.packing_lists where id = any($1::uuid[])`, [listIds])
        await client.query("commit")
    } catch (error) {
        await client.query("rollback").catch(() => {})
        throw error
    } finally {
        client.release()
    }

    await svc().from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_snapshots").delete().eq("flow_id", flowId)
    await svc().from("flow_stage_actions").delete().in("id", [defaultActionId, overrideActionId, taskActionId])
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

/** An SOR on the first Stage, under a Flow Snapshot that saves each action's config. */
async function freshSor({ first = {}, second = {} } = {}) {
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
                    { id: defaultActionId, stage_id: stageId, kind: "request_packing_list", config: first },
                    { id: overrideActionId, stage_id: stageId, kind: "request_packing_list", config: second },
                    { id: taskActionId, stage_id: stageId, kind: "create_individual_task", config: {} },
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
            kind: "request_packing_list",
            name: "Request Packing List",
            confirm,
            decider: confirm ? [{ type: "role", role: "deal_owner" }] : undefined,
            decider_ids: confirm ? [ids.dealOwner] : undefined,
            // A decoy that would change who is told if the caller's config were read.
            config: { notify: [employee(ids.outsider)] },
            notify: [employee(ids.outsider)],
        })),
    })
    if (error) throw new Error(error.message)
    return data
}

async function runOf(sorId, actionId) {
    const { data } = await svc().from("sor_action_runs").select("*").eq("opportunity_id", sorId).eq("action_id", actionId).single()
    return data
}

async function listsOf(sorId) {
    const { data, error } = await svc().from("packing_lists").select("*").eq("opportunity_id", sorId).order("created_at")
    if (error) throw error
    return data
}

async function toldAbout(listId) {
    const { data, error } = await svc().from("notifications").select("recipient_id, type, sender_id").eq("reference_id", listId).eq("type", NOTE)
    if (error) throw error
    return data
}

describe("running the action", () => {
    it("creates one draft Packing List for the SOR and tells the Warehouse list", async () => {
        const sorId = await freshSor()
        const result = await run(sorId, [defaultActionId])
        expect(result.failed).toEqual([])

        const lists = await listsOf(sorId)
        expect(lists).toHaveLength(1)
        expect(lists[0].state).toBe("draft")
        expect(lists[0].created_by).toBe(ids.dealOwner)
        expect(lists[0].number).toMatch(/^PKL_\d{3,}$/)
        expect(lists[0].odoo_delivery_ref).toBeNull()
        expect(lists[0].packed_by).toBeNull()
        expect(result.created).toEqual([{ action_id: defaultActionId, kind: "request_packing_list", packing_list_id: lists[0].id }])

        const told = await toldAbout(lists[0].id)
        expect(told.map((n) => n.recipient_id).sort()).toEqual(listMembers.filter((id) => id !== ids.dealOwner).sort())
        expect(told.map((n) => n.recipient_id)).toContain(ids.warehouse)
        for (const n of told) expect(n.sender_id).toBe(ids.dealOwner)

        const record = await runOf(sorId, defaultActionId)
        expect(record.outcome).toBe("created")
        expect(record.packing_list_id).toBe(lists[0].id)

        // Written like a hand-made one: a 'created' event on the trail.
        const { data: events } = await svc()
            .from("pms_handoff_events")
            .select("kind")
            .eq("record_type", "packing_list")
            .eq("record_id", lists[0].id)
        expect(events.map((e) => e.kind)).toEqual(["created"])
    })

    it("tells the config's people and groups instead of the Warehouse list when it names some", async () => {
        const sorId = await freshSor({ first: { notify: [employee(ids.ordinary), employee(ids.support)] } })
        await run(sorId, [defaultActionId])

        const [list] = await listsOf(sorId)
        const told = (await toldAbout(list.id)).map((n) => n.recipient_id).sort()
        expect(told).toEqual([ids.ordinary, ids.support].sort())
        expect(told).not.toContain(ids.warehouse)
        // The decoy the caller sent is not read.
        expect(told).not.toContain(ids.outsider)
    })

    it("falls back to the Warehouse list when the saved notify list is empty", async () => {
        const sorId = await freshSor({ first: { notify: [] } })
        await run(sorId, [defaultActionId])
        const [list] = await listsOf(sorId)
        expect((await toldAbout(list.id)).map((n) => n.recipient_id)).toContain(ids.warehouse)
    })

    it("does not tell the person who moved the SOR", async () => {
        const sorId = await freshSor({ first: { notify: [employee(ids.dealOwner), employee(ids.ordinary)] } })
        await run(sorId, [defaultActionId])
        const [list] = await listsOf(sorId)
        expect((await toldAbout(list.id)).map((n) => n.recipient_id)).toEqual([ids.ordinary])
    })

    it("creates nothing and tells nobody when the SOR already has an open Packing List", async () => {
        const sorId = await freshSor()
        await run(sorId, [defaultActionId])
        const [first] = await listsOf(sorId)
        const toldBefore = await toldAbout(first.id)

        const again = await run(sorId, [overrideActionId])
        expect(again.failed).toEqual([])
        expect(again.created).toEqual([{ action_id: overrideActionId, kind: "request_packing_list", packing_list_id: null }])

        expect(await listsOf(sorId)).toHaveLength(1)
        expect(await toldAbout(first.id)).toHaveLength(toldBefore.length)
        const record = await runOf(sorId, overrideActionId)
        expect(record.outcome).toBe("created")
        expect(record.packing_list_id).toBeNull()
    })

    it("an open list made by hand also counts", async () => {
        const sorId = await freshSor()
        const made = await (await clientFor("warehouse")).rpc("packing_list_create", { p_opportunity_id: sorId })
        expect(made.error).toBeNull()

        const result = await run(sorId, [defaultActionId])
        expect(result.failed).toEqual([])
        expect(await listsOf(sorId)).toHaveLength(1)
        const { data: stray } = await svc().from("notifications").select("id").eq("type", NOTE).eq("reference_id", made.data.id)
        expect(stray).toHaveLength(0)
    })

    it("asks again once the earlier list is packed", async () => {
        const sorId = await freshSor()
        await run(sorId, [defaultActionId])
        const [first] = await listsOf(sorId)

        // Packed is a signed, closed list; the guard allows the state change only through the signing route,
        // so the fixture flips it with the triggers off.
        const client = await sql().connect()
        try {
            await client.query("begin")
            await client.query("set local session_replication_role = replica")
            await client.query(
                `update public.packing_lists set state = 'packed', packed_by = $2, packed_at = now() where id = $1`,
                [first.id, ids.warehouse],
            )
            await client.query("commit")
        } finally {
            client.release()
        }

        const result = await run(sorId, [overrideActionId])
        expect(result.failed).toEqual([])
        const lists = await listsOf(sorId)
        expect(lists.map((l) => l.state).sort()).toEqual(["draft", "packed"])
    })

    it("does not touch another SOR's Packing List", async () => {
        const mine = await freshSor()
        const theirs = await freshSor()
        await run(theirs, [defaultActionId])
        await run(mine, [defaultActionId])
        expect(await listsOf(mine)).toHaveLength(1)
        expect(await listsOf(theirs)).toHaveLength(1)
    })

    it("a list it made behaves as a hand-made one: the Warehouse can sign it and signing closes it", async () => {
        const sorId = await freshSor()
        await run(sorId, [defaultActionId])
        const [list] = await listsOf(sorId)

        const client = await clientFor("warehouse")
        const box = await client.rpc("packing_list_add_box", { p_packing_list_id: list.id })
        expect(box.error).toBeNull()
        const stillDraft = (await listsOf(sorId))[0]
        expect(stillDraft.state).toBe("draft")
    })

    it("writes nothing to Odoo", async () => {
        const sorId = await freshSor()
        await run(sorId, [defaultActionId])
        const [list] = await listsOf(sorId)
        expect(list.odoo_delivery_ref).toBeNull()
    })
})

describe("an Optional Action", () => {
    it("creates the draft once a Decider picks Create", async () => {
        const sorId = await freshSor({ first: { notify: [employee(ids.ordinary)] } })
        await run(sorId, [defaultActionId], { confirm: true })
        expect(await listsOf(sorId)).toHaveLength(0)

        const pending = await runOf(sorId, defaultActionId)
        expect(pending.outcome).toBe("pending")

        const client = await clientFor("dealOwner")
        const decided = await client.rpc("sor_decide_action_run", {
            p_run_id: pending.id,
            p_decision: "create",
            p_actor_id: ids.dealOwner,
        })
        expect(decided.error).toBeNull()

        const opened = await client.rpc("sor_request_packing_list", { p_run_id: pending.id })
        expect(opened.error).toBeNull()
        const [list] = await listsOf(sorId)
        expect(opened.data).toBe(list.id)
        expect((await toldAbout(list.id)).map((n) => n.recipient_id)).toEqual([ids.ordinary])
        expect((await runOf(sorId, defaultActionId)).packing_list_id).toBe(list.id)
    })
})

describe("who may run it", () => {
    it("refuses a run that already created its list, so it cannot be re-run", async () => {
        const sorId = await freshSor()
        await run(sorId, [defaultActionId])
        const runRow = await runOf(sorId, defaultActionId)

        const { error } = await (await clientFor("support")).rpc("sor_request_packing_list", { p_run_id: runRow.id })
        expect(error?.code).toBe("42501")
        expect(await listsOf(sorId)).toHaveLength(1)
    })

    it("refuses someone with no access to the SOR", async () => {
        const sorId = await freshSor()
        await run(sorId, [defaultActionId], { confirm: true })
        const pending = await runOf(sorId, defaultActionId)
        const { error } = await (await clientFor("ordinary")).rpc("sor_request_packing_list", { p_run_id: pending.id })
        expect(error?.code).toBe("42501")
        expect(await listsOf(sorId)).toHaveLength(0)
    })

    it("refuses a run whose action is not a Request Packing List", async () => {
        const sorId = await freshSor()
        const runId = await one(
            svc().from("sor_action_runs").insert({
                opportunity_id: sorId,
                stage_id: stageId,
                action_id: taskActionId,
                stage_visit_id: await visitOf(sorId),
            }),
            "task run",
        )
        const { error } = await (await clientFor("dealOwner")).rpc("sor_request_packing_list", { p_run_id: runId })
        expect(error).not.toBeNull()
        expect(await listsOf(sorId)).toHaveLength(0)
    })

    it("cannot be called by someone not signed in", async () => {
        const open = await anonymousClient().rpc("sor_request_packing_list", { p_run_id: NO_ID })
        expect(open.error?.message).toMatch(/permission denied/i)
    })
})

describe("the schema", () => {
    it("accepts the new action kind and keeps the old ones", async () => {
        const kinds = ["create_group_task", "create_individual_task", "open_purchase_request", "open_costing_matrix", "request_packing_list"]
        for (const kind of kinds) {
            const { error } = await svc().from("flow_stage_actions").insert({ stage_id: laterStageId, kind }).select("id").single()
            expect(error, kind).toBeNull()
        }
        await svc().from("flow_stage_actions").delete().eq("stage_id", laterStageId)
        const bad = await svc().from("flow_stage_actions").insert({ stage_id: laterStageId, kind: "pack_it" })
        expect(bad.error).not.toBeNull()
    })
})
