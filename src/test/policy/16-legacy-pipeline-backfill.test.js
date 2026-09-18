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
import { canRead } from "./support/access.js"

const PROD_SALE_TYPE_ID = "f1d4e085-9a13-4c30-a2b7-b9f97f009608"
const script = readFileSync("supabase/scripts/cutover/legacy_pipeline_backfill.sql", "utf8")

let saleTypeId
let flowId
const sors = {}

async function runBackfill(targetId) {
    await sql().query(script.replace(PROD_SALE_TYPE_ID, targetId))
}

beforeAll(async () => {
    await ensureCastLoaded()
    const svc = serviceClient()

    expect(script.split(PROD_SALE_TYPE_ID)).toHaveLength(2)

    const saleType = await svc.from("sale_types").insert({ name: "Standard Pipeline" }).select("id").single()
    if (saleType.error) throw new Error(`Seeding a Sale Type: ${saleType.error.message}`)
    saleTypeId = saleType.data.id

    const flow = await svc.from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()
    if (flow.error) throw new Error(`Seeding a flow: ${flow.error.message}`)
    flowId = flow.data.id

    sors.owned = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, companyName: `${MARKER} Legacy A` })
    sors.other = await makeSor({ registeredBy: ids.closingSales, dealOwnerId: ids.closingSales, companyName: `${MARKER} Legacy B` })
    sors.deleted = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, companyName: `${MARKER} Legacy Deleted` })
    const { error } = await svc.from("sales_opportunities").update({ is_deleted: true }).eq("id", sors.deleted)
    if (error) throw new Error(`Soft-deleting an SOR: ${error.message}`)

    await runBackfill(saleTypeId)
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("sales_opportunities").update({ sale_type_id: null }).eq("sale_type_id", saleTypeId)
    await svc.from("sales_opportunities").delete().in("id", Object.values(sors))
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

    it("leaves soft-deleted SORs alone", async () => {
        expect(await saleTypeOf(sors.deleted)).toBeNull()
    })

    it("gives Legacy Pipeline no Always sees configuration", async () => {
        const { data } = await serviceClient().from("flow_access_settings").select("always_sees").eq("flow_id", flowId)
        expect((data || []).flatMap((r) => r.always_sees || [])).toEqual([])
    })

    it("is re-runnable", async () => {
        await expect(runBackfill(saleTypeId)).resolves.toBeUndefined()
        expect(await saleTypeOf(sors.owned)).toBe(saleTypeId)
    })

    it("does nothing when the Sale Type id isn't present (e.g. staging)", async () => {
        const { error } = await serviceClient().from("sales_opportunities").update({ sale_type_id: null }).eq("id", sors.owned)
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

    it("a non-member doesn't", async () => {
        expect(await canRead(await clientFor("ordinary"), "sales_opportunities", sors.owned)).toBe(false)
        expect(await canRead(await clientFor("dealOwner"), "sales_opportunities", sors.other)).toBe(false)
    })

    it("Super Admin reads all", async () => {
        const admin = await clientFor("superAdmin")
        expect(await canRead(admin, "sales_opportunities", sors.owned)).toBe(true)
        expect(await canRead(admin, "sales_opportunities", sors.other)).toBe(true)
    })
})
