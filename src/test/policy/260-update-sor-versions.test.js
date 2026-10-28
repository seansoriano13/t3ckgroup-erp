/**
 * Updating an SOR's version (#743, spec #735), against the real stack.
 *
 *   Super Admin   any SOR, to a newer or an older version
 *   head          only SORs of their own department
 *   Deal Team     their own SOR, one at a time
 *   anyone else   refused
 * A version that lacks the SOR's current Stage is refused. Every update
 * writes a History entry.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
let saleTypeId, flowId, stageId, v1, v2, v3NoStage
const sorIds = []

const one = async (query, what) => {
    const { data, error } = await query.select("id").single()
    if (error) throw new Error(`${what}: ${error.message}`)
    return data.id
}

const snapshot = (version, stages) =>
    svc().from("flow_snapshots").insert({ flow_id: flowId, version, version_minor: 0, snapshot_data: { stages } })

async function freshSor() {
    const id = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(id)
    const link = await svc().from("sales_opportunities").update({ flow_snapshot_id: v1 }).eq("id", id)
    if (link.error) throw new Error(link.error.message)
    return id
}

const update = async (who, oppIds, target) => {
    const { data, error } = await (await clientFor(who)).rpc("update_sor_versions", {
        p_opportunity_ids: oppIds,
        p_target_snapshot_id: target,
    })
    if (error) throw new Error(error.message)
    return data
}

const snapshotOf = async (id) =>
    (await svc().from("sales_opportunities").select("flow_snapshot_id").eq("id", id).single()).data.flow_snapshot_id

beforeAll(async () => {
    await ensureCastLoaded()
    saleTypeId = await one(svc().from("sale_types").insert({ name: `${MARKER} Update Versions` }), "sale type")
    flowId = await one(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }), "flow")
    stageId = await one(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Stage`, sort_order: 10 }), "stage")
    v1 = await one(snapshot(9401, [{ id: stageId }]), "v1")
    v2 = await one(snapshot(9402, [{ id: stageId }]), "v2")
    v3NoStage = await one(snapshot(9403, [{ id: "00000000-0000-0000-0000-000000000000" }]), "v3")
})

afterAll(async () => {
    await svc().from("sales_opportunity_logs").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_snapshots").delete().eq("flow_id", flowId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("update_sor_versions", () => {
    it("lets a Super Admin update many SORs and put one back on an older version", async () => {
        const [a, b] = [await freshSor(), await freshSor()]
        const result = await update("superAdmin", [a, b], v2)
        expect(result.moved).toHaveLength(2)
        expect(await snapshotOf(a)).toBe(v2)
        const back = await update("superAdmin", [a], v1)
        expect(back.moved).toHaveLength(1)
        expect(await snapshotOf(a)).toBe(v1)
    })

    it("writes a History entry saying from which version to which", async () => {
        const id = await freshSor()
        await update("superAdmin", [id], v2)
        const { data } = await svc().from("sales_opportunity_logs").select("content").eq("opportunity_id", id)
        expect(data.map((r) => r.content)).toContain("Updated from v9401.0 to v9402.0.")
    })

    it("lets a head update only their own department's SORs", async () => {
        const own = await freshSor() // Deal Owner is in SALES, like the head
        expect((await update("head", [own, own], v2)).moved.length).toBeGreaterThan(0)

        const other = await freshSor()
        await svc().from("employees").update({ is_head: true }).eq("id", ids.outsider) // OPERATIONS head
        try {
            const result = await update("outsider", [other, other], v2)
            expect(result.moved).toHaveLength(0)
            expect(result.failed[0].reason).toMatch(/not allowed/)
            expect(await snapshotOf(other)).toBe(v1)
        } finally {
            await svc().from("employees").update({ is_head: false }).eq("id", ids.outsider)
        }
    })

    it("lets the Deal Team update their own SOR one at a time, not in a batch", async () => {
        const a = await freshSor()
        const b = await freshSor()
        const batch = await update("dealOwner", [a, b], v2)
        expect(batch.moved).toHaveLength(0)
        const single = await update("dealOwner", [a], v2)
        expect(single.moved).toHaveLength(1)
    })

    it("refuses someone who is not on the Deal Team and not a head", async () => {
        const id = await freshSor()
        const result = await update("ordinary", [id], v2)
        expect(result.moved).toHaveLength(0)
        expect(await snapshotOf(id)).toBe(v1)
    })

    it("refuses a version that lacks the SOR's Stage", async () => {
        const id = await freshSor()
        const result = await update("superAdmin", [id], v3NoStage)
        expect(result.moved).toHaveLength(0)
        expect(result.failed[0].reason).toMatch(/current Stage does not exist/)
        expect(await snapshotOf(id)).toBe(v1)
    })
})
