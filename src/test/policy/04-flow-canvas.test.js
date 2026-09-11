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
