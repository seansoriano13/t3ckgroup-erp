/**
 * Issue #330 (release/2026-09) — the Legacy Pipeline backfill cutover script.
 *
 * Runs the real script file against the local stack with production's Sale
 * Type id swapped for a fixture one ("Standard Pipeline", as production has
 * it), then checks what the SOR read policy does with the attached SORs.
 *
 * The script attaches every NULL-Sale-Type SOR in the database, not just this
 * file's. afterAll puts every row it touched back to NULL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"
import { canRead, tryUpdate } from "./support/access.js"

const PROD_SALE_TYPE_ID = "f1d4e085-9a13-4c30-a2b7-b9f97f009608"
const EVERYONE = [{ type: "everyone" }]
const script = readFileSync("supabase/scripts/cutover/legacy_pipeline_backfill.sql", "utf8")

let saleTypeId
let flowId
let leadStageId
const sors = {}

async function runBackfill(targetId) {
    await sql().query(script.replace(PROD_SALE_TYPE_ID, targetId))
}

beforeAll(async () => {
    await ensureCastLoaded()
    const svc = serviceClient()

    expect(script.split(PROD_SALE_TYPE_ID)).toHaveLength(2)

    const saleType = await svc.from("sale_types").insert({ name: `${MARKER} Standard Pipeline` }).select("id").single()
    if (saleType.error) throw new Error(`Seeding a Sale Type: ${saleType.error.message}`)
    saleTypeId = saleType.data.id

    const flow = await svc.from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()
    if (flow.error) throw new Error(`Seeding a flow: ${flow.error.message}`)
    flowId = flow.data.id

    // Production's Legacy Pipeline Stages are named after crm_pipeline_stages
    // labels, one each. The script attaches every NULL SOR in the database,
    // whatever its status, so the fixture flow carries all of them too.
    const { data: crm, error: crmError } = await svc.from("crm_pipeline_stages").select("code, label, sort_order")
    if (crmError) throw new Error(`Reading pipeline stages: ${crmError.message}`)
    const stages = await svc
        .from("flow_stages")
        .insert(crm.map((c) => ({ flow_id: flowId, name: c.label, sort_order: c.sort_order, is_terminal: false })))
        .select("id, name")
    if (stages.error) throw new Error(`Seeding the Stages: ${stages.error.message}`)
    const leadLabel = crm.find((c) => c.code === "LEAD").label
    leadStageId = stages.data.find((st) => st.name === leadLabel).id

    sors.owned = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, companyName: `${MARKER} Legacy A` })
    sors.other = await makeSor({ registeredBy: ids.closingSales, dealOwnerId: ids.closingSales, companyName: `${MARKER} Legacy B` })
    sors.deleted = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, companyName: `${MARKER} Legacy Deleted` })
    const { error } = await svc.from("sales_opportunities").update({ is_deleted: true }).eq("id", sors.deleted)
    if (error) throw new Error(`Soft-deleting an SOR: ${error.message}`)

    await runBackfill(saleTypeId)
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("sales_opportunities").update({ sale_type_id: null, flow_stage_id: null }).eq("sale_type_id", saleTypeId)
    const { data: fixtureStages } = await svc.from("flow_stages").select("id").eq("flow_id", flowId)
    await svc.from("sor_stage_visits").delete().in("flow_stage_id", (fixtureStages || []).map((st) => st.id))
    await svc.from("flow_stages").delete().eq("flow_id", flowId)
    await svc.from("sales_opportunities").delete().in("id", Object.values(sors))
    await svc.from("flow_access_settings").delete().eq("flow_id", flowId)
    await svc.from("sales_flows").delete().eq("id", flowId)
    await svc.from("sale_types").delete().eq("id", saleTypeId)
})

async function saleTypeOf(id) {
    const { data, error } = await serviceClient().from("sales_opportunities").select("sale_type_id").eq("id", id).single()
    if (error) throw error
    return data.sale_type_id
}

describe("the Legacy Pipeline backfill", () => {
    it("renames the Sale Type", async () => {
        const { data } = await serviceClient().from("sale_types").select("name").eq("id", saleTypeId).single()
        expect(data.name).toBe("Legacy Pipeline")
    })

    it("leaves no non-deleted SOR without a Sale Type", async () => {
        const { rows } = await sql().query(
            "select count(*)::int as n from public.sales_opportunities where sale_type_id is null and coalesce(is_deleted, false) = false",
        )
        expect(rows[0].n).toBe(0)
        expect(await saleTypeOf(sors.owned)).toBe(saleTypeId)
        expect(await saleTypeOf(sors.other)).toBe(saleTypeId)
    })

    it("puts each SOR on the Stage named after its current status, without changing status", async () => {
        const { data, error } = await serviceClient().from("sales_opportunities").select("flow_stage_id, status").eq("id", sors.owned).single()
        if (error) throw error
        expect(data.flow_stage_id).toBe(leadStageId)
        expect(data.status).toBe("LEAD")
    })

    it("leaves soft-deleted SORs alone", async () => {
        expect(await saleTypeOf(sors.deleted)).toBeNull()
    })

    it("leaves exactly Everyone in Always sees and Always edits", async () => {
        const { data } = await serviceClient().from("flow_access_settings").select("always_sees, always_edits").eq("flow_id", flowId)
        expect(data).toEqual([{ always_sees: EVERYONE, always_edits: EVERYONE }])
    })

    it("replaces an earlier setting, and a second run rewrites nothing", async () => {
        const svc = serviceClient()
        await svc.from("flow_access_settings").update({ always_sees: [{ type: "team", team: "NGO" }], always_edits: [] }).eq("flow_id", flowId)
        await runBackfill(saleTypeId)
        const first = await svc.from("flow_access_settings").select("always_sees, always_edits, updated_at").eq("flow_id", flowId).single()
        expect(first.data).toMatchObject({ always_sees: EVERYONE, always_edits: EVERYONE })
        await runBackfill(saleTypeId)
        const second = await svc.from("flow_access_settings").select("updated_at").eq("flow_id", flowId).single()
        expect(second.data.updated_at).toBe(first.data.updated_at)
    })

    it("is re-runnable", async () => {
        await expect(runBackfill(saleTypeId)).resolves.toBeUndefined()
        expect(await saleTypeOf(sors.owned)).toBe(saleTypeId)
    })

    it("does nothing when the Sale Type id isn't present (e.g. staging)", async () => {
        const { error } = await serviceClient().from("sales_opportunities").update({ sale_type_id: null, flow_stage_id: null }).eq("id", sors.owned)
        if (error) throw error
        await runBackfill("00000000-0000-0000-0000-000000000330")
        expect(await saleTypeOf(sors.owned)).toBeNull()
        await runBackfill(saleTypeId)
    })
})

describe("who reads a backfilled SOR", () => {
    it("its Deal Team member does", async () => {
        expect(await canRead(await clientFor("dealOwner"), "sales_opportunities", sors.owned)).toBe(true)
    })

    // outsider: Operations, off the Deal Team. hr: no sub-department.
    it.each(["outsider", "hr", "ordinary"])("%s reads, edits and moves it", async (key) => {
        const client = await clientFor(key)
        expect(await canRead(client, "sales_opportunities", sors.owned)).toBe(true)
        const edit = await tryUpdate(client, "sales_opportunities", sors.owned, { project_title: `${MARKER} edited by ${key}` })
        expect(edit.affected).toBe(1)
        const move = await tryUpdate(client, "sales_opportunities", sors.owned, { flow_stage_id: leadStageId })
        expect(move.affected).toBe(1)
    })

    it("Super Admin reads all", async () => {
        const admin = await clientFor("superAdmin")
        expect(await canRead(admin, "sales_opportunities", sors.owned)).toBe(true)
        expect(await canRead(admin, "sales_opportunities", sors.other)).toBe(true)
    })
})
