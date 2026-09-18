/**
 * Issue #327 (release/2026-09) — Stage Visits and Stage Participants are
 * readable only by callers who can open the SOR (sor_access_level full or
 * participant).
 *
 * Two SORs with Deal Teams that don't overlap, so "reads zero rows" can't pass
 * because the table was simply empty: each Deal Team sees its own SOR's rows
 * and none of the other's.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

let saleTypeId
let flowId
let stageId
const sors = {} // a: dealOwner's, b: closingSales'

async function seedSor(key, ownerId) {
    const svc = serviceClient()
    const { data, error } = await svc
        .from("sales_opportunities")
        .insert({
            registered_by: ownerId,
            deal_owner_id: ownerId,
            sale_type_id: saleTypeId,
            flow_stage_id: stageId,
            lead_source: "REFERRAL",
            client_name: `${MARKER} Narrow Reads ${key}`,
            project_title: `${MARKER} Narrow Reads ${key}`,
            expected_value: 1000,
            status: "LEAD",
        })
        .select("id")
        .single()
    if (error) throw new Error(`Seeding SOR ${key}: ${error.message}`)
    return data.id
}

async function rowsFor(key, table, opportunityId) {
    const client = await clientFor(key)
    const { data, error } = await client.from(table).select("id").eq("opportunity_id", opportunityId)
    if (error) throw new Error(`Reading ${table}: ${error.message}`)
    return data.length
}

beforeAll(async () => {
    await ensureCastLoaded()
    const svc = serviceClient()

    const saleType = await svc.from("sale_types").insert({ name: `${MARKER} Narrow Reads Sale Type` }).select("id").single()
    if (saleType.error) throw new Error(`Seeding a Sale Type: ${saleType.error.message}`)
    saleTypeId = saleType.data.id

    const flow = await svc.from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()
    if (flow.error) throw new Error(`Seeding a flow: ${flow.error.message}`)
    flowId = flow.data.id

    const stage = await svc
        .from("flow_stages")
        .insert({ flow_id: flowId, name: `${MARKER} Narrow Reads Stage`, sort_order: 10 })
        .select("id")
        .single()
    if (stage.error) throw new Error(`Seeding a stage: ${stage.error.message}`)
    stageId = stage.data.id

    sors.a = await seedSor("A", ids.dealOwner)
    sors.b = await seedSor("B", ids.closingSales)

    for (const [key, sorId] of Object.entries(sors)) {
        const { data: visit, error: visitError } = await svc
            .from("sor_stage_visits")
            .select("id")
            .eq("opportunity_id", sorId)
            .single()
        if (visitError) throw new Error(`Reading SOR ${key}'s opening visit: ${visitError.message}`)
        const { error } = await svc.from("sor_stage_participants").insert({
            opportunity_id: sorId,
            employee_id: ids.stageParticipant,
            source: "action",
            opened_visit_id: visit.id,
            until_rule: "stage_left",
        })
        if (error) throw new Error(`Opening a participant window on SOR ${key}: ${error.message}`)
    }
})

afterAll(async () => {
    const svc = serviceClient()
    const sorIds = Object.values(sors)
    await svc.from("sor_stage_participants").delete().in("opportunity_id", sorIds)
    await svc.from("sales_opportunities").delete().in("id", sorIds)
    await svc.from("flow_stages").delete().eq("flow_id", flowId)
    await svc.from("sales_flows").delete().eq("id", flowId)
    await svc.from("sale_types").delete().eq("id", saleTypeId)
})

describe.each(["sor_stage_visits", "sor_stage_participants"])("%s read policy", (table) => {
    it("the fixture has rows on both SORs (service role)", async () => {
        const svc = serviceClient()
        for (const sorId of Object.values(sors)) {
            const { data, error } = await svc.from(table).select("id").eq("opportunity_id", sorId)
            if (error) throw error
            expect(data.length).toBeGreaterThan(0)
        }
    })

    it("a Deal Team member reads their own SOR's rows and not the other team's", async () => {
        expect(await rowsFor("dealOwner", table, sors.a)).toBeGreaterThan(0)
        expect(await rowsFor("dealOwner", table, sors.b)).toBe(0)
        expect(await rowsFor("closingSales", table, sors.b)).toBeGreaterThan(0)
        expect(await rowsFor("closingSales", table, sors.a)).toBe(0)
    })

    it("an employee with no relationship to either SOR reads zero rows", async () => {
        expect(await rowsFor("ordinary", table, sors.a)).toBe(0)
        expect(await rowsFor("ordinary", table, sors.b)).toBe(0)
    })

    it("an open Stage Participant reads the rows", async () => {
        expect(await rowsFor("stageParticipant", table, sors.a)).toBeGreaterThan(0)
    })

    it("Super Admin reads every row", async () => {
        expect(await rowsFor("superAdmin", table, sors.a)).toBeGreaterThan(0)
        expect(await rowsFor("superAdmin", table, sors.b)).toBeGreaterThan(0)
    })
})
