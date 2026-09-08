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
import { tryInsert, tryUpdate, tryDelete, canRead } from "./support/access.js"
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
    it.each([...OPENED_TO_EVERYONE, "flow_snapshots", "flow_plans"])(
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
    it("is still Super Admin only, while editing the same flow is open to everyone (#181)", async () => {
        // The migration that opened the canvas did not touch `flow_snapshots`,
        // whose insert predicate still requires is_super_admin. Locking a flow
        // writes a snapshot, and the snapshot is what pins an SOR's rules for
        // life — so the half of the workflow that makes the versioning argument
        // true is the half that stayed closed.
        const client = await clientFor("head")
        const result = await tryInsert(client, "flow_snapshots", {
            flow_id: flowId,
            version: 1,
            snapshot_data: { stages: [], edges: [] },
        })
        expect(result.ok, "a department head could write a snapshot").toBe(false)
        expect(result.code).toBe("42501")
    })

    it.each(["ordinary", "hr", "dealOwner", "subHead", "leaveManager"])(
        "refuses %s, who can edit the flow but cannot lock it (#181)",
        async (key) => {
            const client = await clientFor(key)
            const result = await tryInsert(client, "flow_snapshots", {
                flow_id: flowId,
                version: 1,
                snapshot_data: { stages: [], edges: [] },
            })
            expect(result.ok, `${key} wrote a snapshot`).toBe(false)
        },
    )

    it("leaves the flow locked with no snapshot when a non-Super-Admin locks it (#181)", async () => {
        // `lockFlow` flips `sales_flows.state` and then inserts the snapshot,
        // as two separate calls with no transaction around them. Since the
        // migration opened `sales_flows` but not `flow_snapshots`, the first
        // succeeds and the second is refused — leaving the flow published but
        // unusable: locked, so editing is refused until someone unlocks it,
        // and with no snapshot, so `entryStageFor` can find nothing and no SOR
        // can be registered against it.
        //
        // This reproduces the two writes in the order the service makes them.
        const svc = serviceClient()
        const saleType = await svc
            .from("sale_types")
            .insert({ name: `${MARKER} Half-locked` })
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
            expect(flipped.affected, "the state flip was refused, so the trap is gone").toBe(1)

            const snapshot = await tryInsert(client, "flow_snapshots", {
                flow_id: flow.data.id,
                version: 1,
                snapshot_data: { stages: [], edges: [] },
            })
            expect(snapshot.ok).toBe(false)

            const after = await svc
                .from("sales_flows")
                .select("state")
                .eq("id", flow.data.id)
                .single()
            const snaps = await svc
                .from("flow_snapshots")
                .select("id")
                .eq("flow_id", flow.data.id)

            expect(after.data.state).toBe("locked")
            expect(snaps.data).toHaveLength(0)
        } finally {
            await svc.from("flow_snapshots").delete().eq("flow_id", flow.data.id)
            await svc.from("sales_flows").delete().eq("id", flow.data.id)
            await svc.from("sale_types").delete().eq("id", saleType.data.id)
        }
    })

    it("a Super Admin can write one", async () => {
        const client = await clientFor("superAdmin")
        const result = await tryInsert(client, "flow_snapshots", {
            flow_id: flowId,
            version: 99,
            snapshot_data: { stages: [], edges: [] },
        })
        expect(result.ok, result.message).toBe(true)
        await serviceClient().from("flow_snapshots").delete().eq("id", result.id)
    })

    it("keeps snapshots append-only: nobody can rewrite or delete one", async () => {
        // No update or delete policy exists, which is what makes a snapshot a
        // record of what the rules were rather than a mutable document.
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
        expect(await canRead(client, "flow_snapshots", "00000000-0000-0000-0000-000000000000")).toBe(
            false,
        )
        const { error } = await client.from("flow_snapshots").select("id").limit(1)
        expect(error).toBeNull()
    })
})

// ===========================================================================

describe("the sandbox, which is a shared document by design", () => {
    it("lets an employee create a plan only in their own name", async () => {
        const client = await clientFor("ordinary")

        const own = await tryInsert(client, "flow_plans", {
            name: `${MARKER} My sandbox`,
            created_by: ids.ordinary,
        })
        expect(own.ok, own.message).toBe(true)

        const impersonated = await tryInsert(client, "flow_plans", {
            name: `${MARKER} Not mine`,
            created_by: ids.superAdmin,
        })
        expect(impersonated.ok).toBe(false)

        await serviceClient().from("flow_plans").delete().eq("id", own.id)
    })

    it("lets anybody edit anybody's plan, because the sandbox is one shared document", async () => {
        // ADR 0016: the sandbox is a single collaborative document, so a write
        // policy scoped to the creator would defeat its purpose.
        const svc = serviceClient()
        const plan = await svc
            .from("flow_plans")
            .insert({ name: `${MARKER} Shared`, created_by: ids.ordinary })
            .select("id")
            .single()
        if (plan.error) throw new Error(plan.error.message)

        const client = await clientFor("outsider")
        const result = await tryUpdate(client, "flow_plans", plan.data.id, {
            name: `${MARKER} Edited by someone else`,
        })
        expect(result.affected).toBe(1)

        await svc.from("flow_plans").delete().eq("id", plan.data.id)
    })

    it("lets only the creator delete their own plan", async () => {
        const svc = serviceClient()
        const plan = await svc
            .from("flow_plans")
            .insert({ name: `${MARKER} Mine to delete`, created_by: ids.ordinary })
            .select("id")
            .single()
        if (plan.error) throw new Error(plan.error.message)

        const stranger = await clientFor("outsider")
        expect((await tryDelete(stranger, "flow_plans", plan.data.id)).affected).toBe(0)

        const owner = await clientFor("ordinary")
        expect((await tryDelete(owner, "flow_plans", plan.data.id)).affected).toBe(1)
    })
})
