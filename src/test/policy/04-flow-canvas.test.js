/**
 * Flow Canvas write policies.
 *
 * Added because `20260908034000_allow_authenticated_flow_canvas_writes.sql`
 * reversed the Super Admin gating that `20260907100000` had introduced the day
 * before, and that reversal shipped with nothing asserting either state. This
 * file is what makes the next change to these tables a deliberate one: whether
 * the rule is "everyone" or "Super Admin only", it is now written down
 * somewhere that fails when it stops being true.
 *
 * The opening is a considered decision, not an oversight — a Sale Type's rules
 * are pinned onto each SOR as a snapshot at registration, and a stage that
 * deals are parked on cannot be deleted (`ON DELETE RESTRICT`). What follows
 * records that decision rather than arguing with it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, rlsStatus } from "./support/stack.js"
import { tryInsert, tryUpdate, tryDelete } from "./support/access.js"
import { MARKER } from "./support/rows.js"

/** The six tables the migration opened to every signed-in employee. */
const OPENED_TO_EVERYONE = [
    "sale_types",
    "sales_flows",
    "flow_stages",
    "flow_edges",
    "flow_stage_actions",
    "stage_conditions",
]

const EVERYONE = CAST_KEYS

let saleTypeId
let flowId
let stageId
let secondStageId

beforeAll(async () => {
    await ensureCastLoaded()
    const svc = serviceClient()

    // The tier builds its own Sale Type rather than borrowing a seeded one: a
    // developer's stack carries the real flows restored from staging, and a
    // test that edits those would corrupt the environment it runs in.
    const saleType = await svc
        .from("sale_types")
        .insert({ name: `${MARKER} Policy Tier Sale Type` })
        .select("id")
        .single()
    if (saleType.error) throw new Error(`Seeding a Sale Type: ${saleType.error.message}`)
    saleTypeId = saleType.data.id

    const flow = await svc
        .from("sales_flows")
        .insert({ sale_type_id: saleTypeId })
        .select("id")
        .single()
    if (flow.error) throw new Error(`Seeding a flow: ${flow.error.message}`)
    flowId = flow.data.id

    const stages = await svc
        .from("flow_stages")
        .insert([
            { flow_id: flowId, name: `${MARKER} Enquiry`, sort_order: 10 },
            { flow_id: flowId, name: `${MARKER} Quoted`, sort_order: 20 },
        ])
        .select("id")
    if (stages.error) throw new Error(`Seeding stages: ${stages.error.message}`)
    ;[stageId, secondStageId] = stages.data.map((s) => s.id)
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("flow_snapshots").delete().eq("flow_id", flowId)
    await svc.from("stage_conditions").delete().in("stage_id", [stageId, secondStageId])
    await svc.from("flow_stage_actions").delete().in("stage_id", [stageId, secondStageId])
    await svc.from("flow_edges").delete().eq("flow_id", flowId)
    await svc.from("flow_stages").delete().eq("flow_id", flowId)
    await svc.from("sales_flows").delete().eq("id", flowId)
    await svc.from("sale_types").delete().eq("id", saleTypeId)
})

// ===========================================================================

describe("the Flow Canvas tables", () => {
    it.each([...OPENED_TO_EVERYONE, "flow_snapshots"])(
        "has row level security turned on and at least one policy: %s",
        async (table) => {
            const { enabled, policies } = await rlsStatus(table)
            expect(enabled, `${table} has RLS switched off`).toBe(true)
            expect(policies, `${table} has RLS on but no policies`).toBeGreaterThan(0)
        },
    )

    it.each(OPENED_TO_EVERYONE)("is readable by an ordinary employee: %s", async (table) => {
        const client = await clientFor("ordinary")
        const { error } = await client.from(table).select("id").limit(1)
        expect(error, `${table}: ${error?.message}`).toBeNull()
    })

    it.each([...OPENED_TO_EVERYONE, "flow_snapshots"])(
        "is unreadable by a caller who is not signed in: %s",
        async (table) => {
            const { data, error } = await anonymousClient().from(table).select("id").limit(1)
            // Granted to `authenticated`, not to `public`.
            expect(error !== null || data.length === 0).toBe(true)
        },
    )
})

describe("editing a flow", () => {
    it.each(EVERYONE)("%s can rename a stage", async (key) => {
        const client = await clientFor(key)
        const result = await tryUpdate(client, "flow_stages", stageId, {
            name: `${MARKER} Renamed by ${key}`,
        })
        expect(result.affected, `${key} was refused`).toBe(1)
    })

    it.each(EVERYONE)("%s can add a stage to a flow", async (key) => {
        const client = await clientFor(key)
        const result = await tryInsert(client, "flow_stages", {
            flow_id: flowId,
            name: `${MARKER} Added by ${key}`,
            sort_order: 90,
        })
        expect(result.ok, `${key} was refused: ${result.message}`).toBe(true)
        await serviceClient().from("flow_stages").delete().eq("id", result.id)
    })

    it.each(EVERYONE)("%s can draw and remove an edge between two stages", async (key) => {
        const client = await clientFor(key)
        const created = await tryInsert(client, "flow_edges", {
            flow_id: flowId,
            from_stage_id: stageId,
            to_stage_id: secondStageId,
        })
        expect(created.ok, `${key} could not draw an edge: ${created.message}`).toBe(true)

        const removed = await tryDelete(client, "flow_edges", created.id)
        expect(removed.affected, `${key} could not remove the edge`).toBe(1)
    })

    it.each(EVERYONE)("%s can attach a condition to a stage", async (key) => {
        const client = await clientFor(key)
        const result = await tryInsert(client, "stage_conditions", {
            stage_id: stageId,
            kind: "tickbox",
            label: `${MARKER} Added by ${key}`,
        })
        expect(result.ok, `${key} was refused: ${result.message}`).toBe(true)
        await serviceClient().from("stage_conditions").delete().eq("id", result.id)
    })

    it.each(EVERYONE)("%s can attach an action to a stage", async (key) => {
        const client = await clientFor(key)
        const result = await tryInsert(client, "flow_stage_actions", {
            stage_id: stageId,
            kind: "create_individual_task",
            config: { title: `${MARKER} ${key}` },
        })
        expect(result.ok, `${key} was refused: ${result.message}`).toBe(true)
        await serviceClient().from("flow_stage_actions").delete().eq("id", result.id)
    })

    it.each(EVERYONE)("%s can create a Sale Type", async (key) => {
        const client = await clientFor(key)
        const result = await tryInsert(client, "sale_types", {
            name: `${MARKER} Created by ${key}`,
        })
        expect(result.ok, `${key} was refused: ${result.message}`).toBe(true)
        await serviceClient().from("sale_types").delete().eq("id", result.id)
    })

    it("a caller who is not signed in can change nothing", async () => {
        const anon = anonymousClient()
        const created = await tryInsert(anon, "flow_stages", {
            flow_id: flowId,
            name: `${MARKER} Anonymous`,
            sort_order: 99,
        })
        expect(created.ok).toBe(false)

        const renamed = await tryUpdate(anon, "flow_stages", stageId, {
            name: `${MARKER} Anonymous rename`,
        })
        expect(renamed.affected).toBe(0)
    })
})

describe("a stage that deals are sitting on", () => {
    it("cannot be deleted, even by a Super Admin", async () => {
        // This is the guard the open write policy leans on. `flow_stage_id` is
        // ON DELETE RESTRICT, so Postgres refuses rather than stranding a deal
        // on a stage that no longer exists. Without it, opening the canvas to
        // everyone would be a much larger decision.
        const svc = serviceClient()
        const parked = await svc
            .from("sales_opportunities")
            .insert({
                registered_by: ids.dealOwner,
                lead_source: "REFERRAL",
                client_name: `${MARKER} Parked On A Stage`,
                project_title: `${MARKER} Parked`,
                expected_value: 1000,
                status: "LEAD",
                sale_type_id: saleTypeId,
                flow_stage_id: stageId,
            })
            .select("id")
            .single()
        if (parked.error) throw new Error(`Seeding a parked SOR: ${parked.error.message}`)

        try {
            const client = await clientFor("superAdmin")
            const result = await tryDelete(client, "flow_stages", stageId)
            expect(result.ok).toBe(false)
            expect(result.message).toMatch(/violates foreign key|still referenced/i)
        } finally {
            await svc.from("sales_opportunities").delete().eq("id", parked.data.id)
        }
    })
})

// ===========================================================================

describe("locking a flow, which is what writes a snapshot", () => {
    it.each(EVERYONE)("%s can publish a snapshot in their own name", async (key) => {
        // Opened by 20260908062650 so that the seventh Flow Canvas table
        // matches the six the previous migration opened. Before that, editing
        // a flow was open to everyone and locking one was not, which stranded
        // any flow a non-Super-Admin tried to lock (#181).
        const client = await clientFor(key)
        const result = await tryInsert(client, "flow_snapshots", {
            flow_id: flowId,
            version: 500 + EVERYONE.indexOf(key),
            snapshot_data: { stages: [], edges: [] },
            created_by: ids[key],
        })
        expect(result.ok, `${key} was refused: ${result.message}`).toBe(true)
        await serviceClient().from("flow_snapshots").delete().eq("id", result.id)
    })

    it.each(EVERYONE)("%s cannot publish a snapshot in somebody else's name", async (key) => {
        // A snapshot records who published that version of the rules. Same
        // shape as the sor_insert "own name only" check.
        const impersonated = key === "superAdmin" ? ids.ordinary : ids.superAdmin
        const client = await clientFor(key)
        const result = await tryInsert(client, "flow_snapshots", {
            flow_id: flowId,
            version: 600,
            snapshot_data: { stages: [] },
            created_by: impersonated,
        })
        expect(result.ok, `${key} attributed a snapshot to someone else`).toBe(false)
        expect(result.code).toBe("42501")
    })

    it("completes both writes when a non-Super-Admin locks a flow (#181)", async () => {
        // `lockFlow` flips `sales_flows.state` and then inserts the snapshot,
        // as two separate calls with no transaction around them. While only one
        // of those tables was open, the first succeeded and the second was
        // refused, leaving the flow locked with no snapshot: uneditable until
        // someone unlocked it, and unusable because `entryStageFor` had no
        // snapshot to pin an SOR to.
        //
        // Reproduces the two writes in the order the service makes them, and
        // asserts the flow ends up genuinely published rather than stranded.
        const svc = serviceClient()
        const saleType = await svc
            .from("sale_types")
            .insert({ name: `${MARKER} Locked by a head` })
            .select("id")
            .single()
        const flow = await svc
            .from("sales_flows")
            .insert({ sale_type_id: saleType.data.id })
            .select("id, state")
            .single()
        expect(flow.data.state).toBe("draft")

        try {
            const client = await clientFor("head")

            const flipped = await tryUpdate(client, "sales_flows", flow.data.id, {
                state: "locked",
            })
            expect(flipped.affected).toBe(1)

            const snapshot = await tryInsert(client, "flow_snapshots", {
                flow_id: flow.data.id,
                version: 1,
                snapshot_data: { stages: [], edges: [] },
                created_by: ids.head,
            })
            expect(snapshot.ok, `the snapshot was refused: ${snapshot.message}`).toBe(true)

            const after = await svc
                .from("sales_flows")
                .select("state")
                .eq("id", flow.data.id)
                .single()
            const snaps = await svc.from("flow_snapshots").select("id").eq("flow_id", flow.data.id)

            expect(after.data.state).toBe("locked")
            expect(snaps.data, "locked with no snapshot is the stranded state").toHaveLength(1)
        } finally {
            await svc.from("flow_snapshots").delete().eq("flow_id", flow.data.id)
            await svc.from("sales_flows").delete().eq("id", flow.data.id)
            await svc.from("sale_types").delete().eq("id", saleType.data.id)
        }
    })

    it("refuses a second snapshot at the same version, so two people locking at once cannot collide", async () => {
        // `UNIQUE (flow_id, version)`. `lockFlow` computes the next version as
        // latest + 1, so without this two concurrent locks would both write the
        // same number.
        const client = await clientFor("superAdmin")
        const first = await tryInsert(client, "flow_snapshots", {
            flow_id: flowId,
            version: 700,
            snapshot_data: { stages: [] },
            created_by: ids.superAdmin,
        })
        expect(first.ok, first.message).toBe(true)

        const second = await tryInsert(client, "flow_snapshots", {
            flow_id: flowId,
            version: 700,
            snapshot_data: { stages: [] },
            created_by: ids.superAdmin,
        })
        expect(second.ok).toBe(false)

        await serviceClient().from("flow_snapshots").delete().eq("id", first.id)
    })

    it("keeps snapshots append-only: nobody can rewrite or delete one", async () => {
        // No update or delete policy exists, which is what makes a snapshot a
        // record of what the rules were rather than a mutable document. An SOR
        // pins to one for life, so this has to stay true.
        const svc = serviceClient()
        const seeded = await svc
            .from("flow_snapshots")
            .insert({ flow_id: flowId, version: 100, snapshot_data: { stages: [] } })
            .select("id")
            .single()
        if (seeded.error) throw new Error(seeded.error.message)

        const client = await clientFor("superAdmin")
        const rewritten = await tryUpdate(client, "flow_snapshots", seeded.data.id, {
            snapshot_data: { stages: ["tampered"] },
        })
        expect(rewritten.affected).toBe(0)

        const removed = await tryDelete(client, "flow_snapshots", seeded.data.id)
        expect(removed.affected).toBe(0)

        await svc.from("flow_snapshots").delete().eq("id", seeded.data.id)
    })

    it("lets everyone read the snapshots their own deals are pinned to", async () => {
        const client = await clientFor("ordinary")
        const { error } = await client.from("flow_snapshots").select("id").limit(1)
        expect(error).toBeNull()
    })
})

// ===========================================================================

/**
 * Version numbers carry compatibility (issue #188, ADR 0020). One rule,
 * `flow_snapshot_next_version`, decides major vs. minor; `lock_sales_flow`
 * calls it inside the same transaction that writes the snapshot. This is the
 * table of cases the acceptance criteria name, run against real Postgres —
 * the fake-store stub in `lockFlowRpc.js` mirrors this rule, but this file is
 * the authority on it.
 */
describe("Flow Snapshot version numbers (issue #188, ADR 0020)", () => {
    let svc
    let versionFlowId

    beforeAll(async () => {
        svc = serviceClient()
        const saleType = await svc
            .from("sale_types")
            .insert({ name: `${MARKER} Version Rule Sale Type` })
            .select("id")
            .single()
        if (saleType.error) throw new Error(`Seeding a Sale Type: ${saleType.error.message}`)

        const flow = await svc
            .from("sales_flows")
            .insert({ sale_type_id: saleType.data.id })
            .select("id")
            .single()
        if (flow.error) throw new Error(`Seeding a flow: ${flow.error.message}`)
        versionFlowId = flow.data.id
    })

    afterAll(async () => {
        await svc.from("flow_snapshots").delete().eq("flow_id", versionFlowId)
        await svc.from("sales_flows").delete().eq("id", versionFlowId)
    })

    /** A tidy `snapshot_data` payload — only what the rule reads. */
    const snapshotData = (stageIds, wonStageId = null) => ({
        stages: stageIds.map(([id, name]) => ({ id, name: name ?? id })),
        wonStageId,
    })

    /** Publishes `versionFlowId` at whatever data is given, via `lock_sales_flow`. */
    async function publish(stageIds, wonStageId = null) {
        const { data, error } = await svc.rpc("lock_sales_flow", {
            p_flow_id: versionFlowId,
            p_actor_id: ids.superAdmin,
            p_snapshot_data: snapshotData(stageIds, wonStageId),
        })
        if (error) throw new Error(error.message)
        // Every call here follows a publish with an immediate reopen, so the
        // next case in the same flow always starts from `draft` again.
        await svc.from("sales_flows").update({ state: "draft" }).eq("id", versionFlowId)
        return data.snapshot
    }

    const s1 = crypto.randomUUID()
    const s2 = crypto.randomUUID()
    const s3 = crypto.randomUUID()

    it("makes a flow's first publish 1.0", async () => {
        const snapshot = await publish([[s1, "Lead"], [s2, "Awarded"]], s2)
        expect([snapshot.version, snapshot.version_minor]).toEqual([1, 0])
    })

    it("bumps only the minor part when a publish only adds a Stage", async () => {
        const snapshot = await publish([[s1, "Lead"], [s2, "Awarded"], [s3, "Negotiation"]], s2)
        expect([snapshot.version, snapshot.version_minor]).toEqual([1, 1])
    })

    it("bumps only the minor part when a publish renames a Stage", async () => {
        const snapshot = await publish([[s1, "Enquiry"], [s2, "Awarded"], [s3, "Negotiation"]], s2)
        expect([snapshot.version, snapshot.version_minor]).toEqual([1, 2])
    })

    it("starts a new major version when a publish removes a Stage", async () => {
        // Drops s3 ("Negotiation"), whose id was present in the latest (1.2).
        const snapshot = await publish([[s1, "Enquiry"], [s2, "Awarded"]], s2)
        expect([snapshot.version, snapshot.version_minor]).toEqual([2, 0])
    })

    it("starts a new major version when a publish changes the Won Stage", async () => {
        // Same Stages as the latest (2.0); only the Won Stage moves.
        const snapshot = await publish([[s1, "Enquiry"], [s2, "Awarded"]], s1)
        expect([snapshot.version, snapshot.version_minor]).toEqual([3, 0])
    })

    it("bumps only the minor part when a removed Stage is re-added with its original id", async () => {
        // s3 comes back under the id it always had — the id is what the rule
        // and the ON DELETE RESTRICT foreign key both key off, not the name.
        const snapshot = await publish([[s1, "Enquiry"], [s2, "Awarded"], [s3, "Negotiation, again"]], s1)
        expect([snapshot.version, snapshot.version_minor]).toEqual([3, 1])
    })

    it("reads a Snapshot published before minor versions existed as N.0", async () => {
        // `version_minor` defaults to 0, so a hand-inserted legacy-shaped row
        // (no minor supplied) reads the same way a real pre-#188 row does.
        const legacy = await svc
            .from("flow_snapshots")
            .insert({ flow_id: versionFlowId, version: 900, snapshot_data: { stages: [] } })
            .select("version, version_minor")
            .single()
        if (legacy.error) throw new Error(legacy.error.message)
        expect(legacy.data.version_minor).toBe(0)
        await svc.from("flow_snapshots").delete().eq("flow_id", versionFlowId).eq("version", 900)
    })

    it("cannot collide: two Snapshots cannot share a (flow, major, minor)", async () => {
        const first = await svc
            .from("flow_snapshots")
            .insert({ flow_id: versionFlowId, version: 901, version_minor: 0, snapshot_data: { stages: [] } })
            .select("id")
            .single()
        expect(first.error).toBeNull()

        const second = await svc
            .from("flow_snapshots")
            .insert({ flow_id: versionFlowId, version: 901, version_minor: 0, snapshot_data: { stages: [] } })
            .select("id")
            .single()
        expect(second.error).not.toBeNull()
        expect(second.error.code).toBe("23505")

        await svc.from("flow_snapshots").delete().eq("id", first.data.id)
    })

    it("previews the same number the publish would create, from the one shared function", async () => {
        const preview = await svc.rpc("flow_snapshot_next_version", {
            p_flow_id: versionFlowId,
            p_snapshot_data: snapshotData([[s1, "Enquiry"], [s2, "Awarded"], [s3, "Negotiation, again"]], s1),
        })
        expect(preview.error).toBeNull()
        // Same input as the last publish above (3.1) — nothing changed, so the
        // preview of the next one is a further minor.
        expect(preview.data[0]).toEqual({ version_major: 3, version_minor: 2 })
    })
})

// ===========================================================================

/**
 * A publish note (issue #189) is optional and stored verbatim, blank rather
 * than empty-string when nothing meaningful was typed — the same trim the
 * migration's `nullif(trim(p_note), '')` applies, so a note of all whitespace
 * reads back as "no note" rather than as a note nobody could see.
 */
describe("Flow Snapshot publish notes (issue #189)", () => {
    let svc
    let noteFlowId

    beforeAll(async () => {
        svc = serviceClient()
        const saleType = await svc
            .from("sale_types")
            .insert({ name: `${MARKER} Publish Note Sale Type` })
            .select("id")
            .single()
        if (saleType.error) throw new Error(`Seeding a Sale Type: ${saleType.error.message}`)

        const flow = await svc
            .from("sales_flows")
            .insert({ sale_type_id: saleType.data.id })
            .select("id")
            .single()
        if (flow.error) throw new Error(`Seeding a flow: ${flow.error.message}`)
        noteFlowId = flow.data.id
    })

    afterAll(async () => {
        await svc.from("flow_snapshots").delete().eq("flow_id", noteFlowId)
        await svc.from("sales_flows").delete().eq("id", noteFlowId)
    })

    async function publish(stageIds, note) {
        const { data, error } = await svc.rpc("lock_sales_flow", {
            p_flow_id: noteFlowId,
            p_actor_id: ids.superAdmin,
            p_snapshot_data: { stages: stageIds.map((id) => ({ id, name: id })), wonStageId: stageIds[0] },
            p_note: note,
        })
        if (error) throw new Error(error.message)
        await svc.from("sales_flows").update({ state: "draft" }).eq("id", noteFlowId)
        return data.snapshot
    }

    it("stores the note given at publish", async () => {
        const snapshot = await publish([crypto.randomUUID()], "First cut of this process.")
        expect(snapshot.note).toBe("First cut of this process.")
    })

    it("stores null when no note is given, or when it is blank", async () => {
        const noNote = await publish([crypto.randomUUID()], null)
        expect(noNote.note).toBeNull()

        const blankNote = await publish([crypto.randomUUID()], "   ")
        expect(blankNote.note).toBeNull()
    })

    it("refuses a draft that is identical to the latest version, even called directly", async () => {
        const stageId = crypto.randomUUID()
        const snapshotData = { stages: [{ id: stageId, name: stageId }], wonStageId: stageId }

        const first = await svc.rpc("lock_sales_flow", {
            p_flow_id: noteFlowId,
            p_actor_id: ids.superAdmin,
            p_snapshot_data: snapshotData,
            p_note: null,
        })
        expect(first.error).toBeNull()
        await svc.from("sales_flows").update({ state: "draft" }).eq("id", noteFlowId)

        // Same shape as what is already the latest Flow Snapshot — the RPC is
        // the backstop for "no empty publishes" (issue #189), independent of
        // whether the caller is the UI's popover or a direct RPC call.
        const second = await svc.rpc("lock_sales_flow", {
            p_flow_id: noteFlowId,
            p_actor_id: ids.superAdmin,
            p_snapshot_data: snapshotData,
            p_note: "A note does not make an unchanged draft publishable.",
        })
        expect(second.error).not.toBeNull()
        expect(second.error.message).toMatch(/identical to the latest version/)

        // The flow itself is untouched by the refused attempt — still draft.
        const flow = await svc.from("sales_flows").select("state").eq("id", noteFlowId).single()
        expect(flow.data.state).toBe("draft")
    })
})
