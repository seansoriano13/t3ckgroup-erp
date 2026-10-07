/**
 * Purchasing settled (#311, part of #209): the condition kind, its gate
 * evidence, and the conversion of live draft conditions of the old kind.
 *
 * The gate is evaluated client-side, so its evidence has to come through
 * `sor_purchase_request_item_states`, past RLS: the Deal Owner here is left
 * out of the request (as `leaveOutRoles` would) and can't read it, yet may
 * move the SOR. A plain select would show them "no request" — settled.
 *
 * The data migration ran at `db reset`, before these fixtures existed, so the
 * conversion test re-runs the migration file against literal rows.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { isSettled } from "../../constants/purchaseRequest.js"

const svc = () => serviceClient()
const MIGRATION = readFileSync("supabase/migrations/20261007161100_purchasing_settled_condition.sql", "utf8")

let sorId, bareSorId, requestId, itemIds
let saleTypeId, flowId, stageId, snapshotId

async function one(query, what) {
    const { data, error } = await query.select("id").single()
    if (error) throw new Error(`${what}: ${error.message}`)
    return data.id
}

async function statesAs(who, opportunityId) {
    return (await clientFor(who)).rpc("sor_purchase_request_item_states", { p_opportunity_id: opportunityId })
}

beforeAll(async () => {
    await ensureCastLoaded()
    const flag = await svc().from("employees").update({ has_purchasing_flow: true }).eq("id", ids.stageParticipant)
    if (flag.error) throw flag.error

    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })
    bareSorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner })

    // The Deal Owner is left out: only the Buyer is a member.
    requestId = await one(
        svc().from("purchase_requests").insert({ opportunity_id: sorId, created_by: ids.dealOwner, buyer_id: ids.stageParticipant }),
        "request",
    )
    await one(
        svc().from("purchase_request_members").insert({ request_id: requestId, employee_id: ids.stageParticipant, side: "purchasing" }),
        "member",
    )
    itemIds = []
    for (const name of ["Full Body Harness", "Helmet"]) {
        itemIds.push(
            await one(
                svc().from("purchase_request_items").insert({
                    request_id: requestId,
                    source: "new",
                    name: `${MARKER} ${name}`,
                    quantity: 1,
                    requested_by: ids.dealOwner,
                }),
                "item",
            ),
        )
    }

    saleTypeId = await one(svc().from("sale_types").insert({ name: `${MARKER} Purchasing settled` }), "sale type")
    flowId = await one(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }), "flow")
    stageId = await one(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Stage`, sort_order: 10 }), "stage")
})

afterAll(async () => {
    await svc().from("employees").update({ has_purchasing_flow: false }).eq("id", ids.stageParticipant)
    if (requestId) await svc().from("purchase_requests").delete().eq("id", requestId)
    await svc().from("sales_opportunities").delete().in("id", [sorId, bareSorId].filter(Boolean))
    if (snapshotId) await svc().from("flow_snapshots").delete().eq("id", snapshotId)
    if (stageId) await svc().from("stage_conditions").delete().eq("stage_id", stageId)
    if (flowId) await svc().from("flow_stages").delete().eq("flow_id", flowId)
    if (flowId) await svc().from("sales_flows").delete().eq("id", flowId)
    if (saleTypeId) await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("the condition kind", () => {
    it("is accepted by the kind CHECK, alongside the old purchasing kind", async () => {
        for (const kind of ["purchasing_settled", "purchasing"]) {
            const { data, error } = await svc()
                .from("stage_conditions")
                .insert({ stage_id: stageId, kind, label: `${MARKER} ${kind}` })
                .select("id")
                .single()
            expect(error).toBeNull()
            await svc().from("stage_conditions").delete().eq("id", data.id)
        }
        const { error } = await svc().from("stage_conditions").insert({ stage_id: stageId, kind: "nonsense", label: MARKER })
        expect(error?.code).toBe("23514")
    })
})

describe("the gate's evidence", () => {
    it("is hidden from a left-out Deal Owner by RLS", async () => {
        const { data, error } = await (await clientFor("dealOwner")).from("purchase_requests").select("id").eq("id", requestId)
        expect(error).toBeNull()
        expect(data).toEqual([])
    })

    it("still reaches the left-out Deal Owner through the RPC, so the gate blocks until the last item closes", async () => {
        const close = (id, status) =>
            svc().from("purchase_request_items").update({ status, status_changed_at: new Date().toISOString() }).eq("id", id)

        const open = await statesAs("dealOwner", sorId)
        expect(open.error).toBeNull()
        expect(open.data.map((i) => i.status)).toEqual(["requested", "requested"])
        expect(isSettled(open.data)).toBe(false)

        await close(itemIds[0], "from_stock")
        expect(isSettled((await statesAs("dealOwner", sorId)).data)).toBe(false)

        await close(itemIds[1], "cancelled")
        expect(isSettled((await statesAs("dealOwner", sorId)).data)).toBe(true)
    })

    it("carries only status and timestamps", async () => {
        const { data } = await statesAs("dealOwner", sorId)
        for (const item of data) expect(Object.keys(item).sort()).toEqual(["created_at", "status", "status_changed_at"])
    })

    it("is null for an SOR with no Purchase Request, which is settled", async () => {
        const { data, error } = await statesAs("dealOwner", bareSorId)
        expect(error).toBeNull()
        expect(data).toBeNull()
        expect(isSettled(data)).toBe(true)
    })

    it("is refused to someone who can't see the SOR, and to the anonymous", async () => {
        const { error } = await statesAs("ordinary", sorId)
        expect(error?.code).toBe("42501")
        const anon = await anonymousClient().rpc("sor_purchase_request_item_states", { p_opportunity_id: sorId })
        expect(anon.error).toBeTruthy()
    })
})

describe("converting live draft conditions of the old kind", () => {
    it("turns live purchasing conditions into Purchasing settled and leaves archived rows and snapshots alone", async () => {
        const insert = (row) => one(svc().from("stage_conditions").insert({ stage_id: stageId, kind: "purchasing", ...row }), "condition")
        const defaultLabel = await insert({ label: "Purchasing" })
        const ownLabel = await insert({ label: `${MARKER} Buying answered` })
        const archived = await insert({ label: `${MARKER} Archived`, archived_at: new Date().toISOString() })
        snapshotId = await one(
            svc().from("flow_snapshots").insert({
                flow_id: flowId,
                version: 9900,
                snapshot_data: { conditions: [{ id: defaultLabel, stage_id: stageId, kind: "purchasing", label: "Purchasing" }] },
            }),
            "snapshot",
        )

        await sql().query(MIGRATION)
        await sql().query(MIGRATION) // re-runnable

        const { data } = await svc().from("stage_conditions").select("id, kind, label").eq("stage_id", stageId)
        const byId = Object.fromEntries(data.map((c) => [c.id, c]))
        expect(byId[defaultLabel]).toMatchObject({ kind: "purchasing_settled", label: "Purchasing settled" })
        expect(byId[ownLabel]).toMatchObject({ kind: "purchasing_settled", label: `${MARKER} Buying answered` })
        expect(byId[archived]).toMatchObject({ kind: "purchasing" })

        const snap = await svc().from("flow_snapshots").select("snapshot_data").eq("id", snapshotId).single()
        expect(snap.data.snapshot_data.conditions[0].kind).toBe("purchasing")
    })
})
