/**
 * Issue #296 (part of #208, ADR 0021) — Restricted Stages.
 *
 * Builds a three-Stage flow, shuts Support Sales' role out of Stage 2 and
 * excludes the Deal Owner via an Employee Group excluded at Stage 3, then
 * walks the SOR through all three by hand (service role) exactly as
 * 13-sor-visit-scoped-reads.test.js does. Assertions run as the real
 * signed-in cast members, never the service role.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"
import { canRead } from "./support/access.js"

let saleTypeId
let flowId
let stageIds = [] // S1, S2 (support_sales shut out), S3 (Deal Owner's group excluded)
let groupId
let sorId
let visitIds = []

async function moveTo(stageIndex) {
    const svc = serviceClient()
    const { error } = await svc
        .from("sales_opportunities")
        .update({ flow_stage_id: stageIds[stageIndex] })
        .eq("id", sorId)
    if (error) throw new Error(`Moving to stage ${stageIndex}: ${error.message}`)

    const { data, error: visitError } = await svc
        .from("sor_stage_visits")
        .select("id")
        .eq("opportunity_id", sorId)
        .eq("flow_stage_id", stageIds[stageIndex])
        .order("sequence", { ascending: false })
        .limit(1)
        .single()
    if (visitError) throw new Error(`Reading the recorded visit: ${visitError.message}`)
    visitIds[stageIndex] = data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    const svc = serviceClient()

    const saleType = await svc
        .from("sale_types")
        .insert({ name: `${MARKER} Restricted Stage Sale Type` })
        .select("id")
        .single()
    if (saleType.error) throw new Error(`Seeding a Sale Type: ${saleType.error.message}`)
    saleTypeId = saleType.data.id

    const flow = await svc.from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()
    if (flow.error) throw new Error(`Seeding a flow: ${flow.error.message}`)
    flowId = flow.data.id

    for (let i = 1; i <= 3; i++) {
        const stage = await svc
            .from("flow_stages")
            .insert({ flow_id: flowId, name: `${MARKER} Restricted Stage ${i}`, sort_order: i * 10 })
            .select("id")
            .single()
        if (stage.error) throw new Error(`Seeding stage ${i}: ${stage.error.message}`)
        stageIds.push(stage.data.id)
    }

    // Stage 2 shuts out the Support Sales role.
    const stage2Access = await svc
        .from("flow_stage_access")
        .insert({ stage_id: stageIds[1], shut_out_roles: ["support_sales"] })
    if (stage2Access.error) throw new Error(`Seeding Stage 2 access: ${stage2Access.error.message}`)

    // An Employee Group containing the Deal Owner, excluded from Stage 3.
    const group = await svc
        .from("employee_groups")
        .insert({ name: `${MARKER} Restricted Group` })
        .select("id")
        .single()
    if (group.error) throw new Error(`Seeding an Employee Group: ${group.error.message}`)
    groupId = group.data.id

    const member = await svc
        .from("employee_group_members")
        .insert({ group_id: groupId, employee_id: ids.dealOwner })
    if (member.error) throw new Error(`Adding the Deal Owner to the group: ${member.error.message}`)

    const stage3Access = await svc
        .from("flow_stage_access")
        .insert({ stage_id: stageIds[2], excluded_group_ids: [groupId] })
    if (stage3Access.error) throw new Error(`Seeding Stage 3 access: ${stage3Access.error.message}`)

    const sor = await svc
        .from("sales_opportunities")
        .insert({
            registered_by: ids.dealOwner,
            deal_owner_id: ids.dealOwner,
            support_sales_1_id: ids.support,
            sale_type_id: saleTypeId,
            flow_stage_id: stageIds[0],
            lead_source: "REFERRAL",
            client_name: `${MARKER} Restricted Company`,
            project_title: `${MARKER} Restricted Project`,
            expected_value: 123456,
            status: "LEAD",
        })
        .select("id")
        .single()
    if (sor.error) throw new Error(`Seeding the SOR: ${sor.error.message}`)
    sorId = sor.data.id

    const { data: firstVisit, error: firstVisitError } = await svc
        .from("sor_stage_visits")
        .select("id")
        .eq("opportunity_id", sorId)
        .eq("flow_stage_id", stageIds[0])
        .single()
    if (firstVisitError) throw new Error(`Reading the opening visit: ${firstVisitError.message}`)
    visitIds[0] = firstVisit.id
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("sales_opportunities").delete().eq("id", sorId)
    await svc.from("employee_group_members").delete().eq("group_id", groupId)
    await svc.from("employee_groups").delete().eq("id", groupId)
    await svc.from("flow_stage_access").delete().in("stage_id", stageIds)
    await svc.from("flow_stages").delete().eq("flow_id", flowId)
    await svc.from("sales_flows").delete().eq("id", flowId)
    await svc.from("sale_types").delete().eq("id", saleTypeId)
})

describe("Stage 2 shuts out the support_sales role", () => {
    // Captured once, deliberately: `visitIds[1]` is reassigned by a later
    // test in this block that moves the SOR off and back onto Stage 2 (a
    // second, different visit). This block's log lives on the FIRST Stage 2
    // visit, so it must be looked up by that visit's own id, not by
    // whatever `visitIds[1]` currently holds.
    let firstStage2VisitId
    let stage2LogId

    beforeAll(async () => {
        await moveTo(1) // -> Stage 2
        firstStage2VisitId = visitIds[1]

        const log = await serviceClient()
            .from("sales_opportunity_logs")
            .insert({
                opportunity_id: sorId,
                author_id: ids.dealOwner,
                type: "COMMENT",
                content: `${MARKER} note on stage 2`,
                stage_visit_id: firstStage2VisitId,
            })
            .select("id")
            .single()
        if (log.error) throw new Error(log.error.message)
        stage2LogId = log.data.id
    })

    it("the Support Salesperson cannot read Stage 2's timeline", async () => {
        const client = await clientFor("support")
        expect(await canRead(client, "sales_opportunity_logs", stage2LogId)).toBe(false)
    })

    it("the Support Salesperson still gets the locked summary, flagged restricted", async () => {
        const client = await clientFor("support")
        const { data, error } = await client.rpc("sor_locked_summary", { p_opportunity_id: sorId })
        if (error) throw error
        expect(data.length).toBe(1)
        expect(data[0].is_restricted).toBe(true)
        expect(data[0]).toHaveProperty("current_stage_name")
    })

    it("the Support Salesperson cannot move the SOR out of Stage 2", async () => {
        const client = await clientFor("support")
        const { data, error } = await client
            .from("sales_opportunities")
            .update({ flow_stage_id: stageIds[2] })
            .eq("id", sorId)
            .select("id")
        if (error) {
            expect(error.code).toBe("42501")
        } else {
            expect(data.length).toBe(0)
        }
    })

    it("the Deal Owner (not shut out at Stage 2) still moves the SOR", async () => {
        const client = await clientFor("dealOwner")
        // Move forward then straight back so the rest of the fixture is
        // unaffected — this only proves an unrestricted Deal Team member is
        // not caught by the guard.
        const forward = await client
            .from("sales_opportunities")
            .update({ flow_stage_id: stageIds[0] })
            .eq("id", sorId)
            .select("id")
        if (forward.error) throw new Error(forward.error.message)
        expect(forward.data.length).toBe(1)
        await moveTo(1) // back to Stage 2 via service role, keeps visitIds in sync
    })

    it("a Super Admin always reads Stage 2 regardless of the restriction", async () => {
        const client = await clientFor("superAdmin")
        expect(await canRead(client, "sales_opportunity_logs", stage2LogId)).toBe(true)
    })

    it("sor_visit_audience excludes the shut-out Support Salesperson from Stage 2's visit", async () => {
        const client = await clientFor("dealOwner")
        const { data, error } = await client.rpc("sor_visit_audience", {
            p_opportunity_id: sorId,
            p_visit_id: visitIds[1],
        })
        if (error) throw error
        const audience = data.map((row) => (typeof row === "string" ? row : row.sor_visit_audience))
        expect(audience).toContain(ids.dealOwner)
        expect(audience).not.toContain(ids.support)
    })
})

describe("the restriction stays in effect after the SOR leaves Stage 2", () => {
    let secondStage2VisitId

    beforeAll(async () => {
        await moveTo(0) // back to Stage 1, closing Stage 2's visit
        await moveTo(1) // -> Stage 2 again, a second visit on the same restricted stage
        secondStage2VisitId = visitIds[1]

        await serviceClient()
            .from("sales_opportunity_logs")
            .insert({
                opportunity_id: sorId,
                author_id: ids.dealOwner,
                type: "COMMENT",
                content: `${MARKER} note on the second Stage 2 visit`,
                stage_visit_id: secondStage2VisitId,
            })
    })

    it("the Support Salesperson still cannot read the new Stage 2 visit's timeline", async () => {
        const client = await clientFor("support")
        const log = await serviceClient()
            .from("sales_opportunity_logs")
            .select("id")
            .eq("opportunity_id", sorId)
            .eq("stage_visit_id", secondStage2VisitId)
            .single()
        expect(await canRead(client, "sales_opportunity_logs", log.data.id)).toBe(false)
    })

    it("still reports restricted via the locked summary", async () => {
        const client = await clientFor("support")
        const { data, error } = await client.rpc("sor_locked_summary", { p_opportunity_id: sorId })
        if (error) throw error
        expect(data[0].is_restricted).toBe(true)
    })
})

describe("Stage 3 excludes the Deal Owner via an Employee Group", () => {
    beforeAll(async () => {
        await moveTo(2) // -> Stage 3

        await serviceClient()
            .from("sales_opportunity_logs")
            .insert({
                opportunity_id: sorId,
                author_id: ids.dealOwner,
                type: "COMMENT",
                content: `${MARKER} note on stage 3`,
                stage_visit_id: visitIds[2],
            })
    })

    it("the Deal Owner (in the excluded group) cannot read Stage 3's timeline", async () => {
        const client = await clientFor("dealOwner")
        const log = await serviceClient()
            .from("sales_opportunity_logs")
            .select("id")
            .eq("opportunity_id", sorId)
            .eq("stage_visit_id", visitIds[2])
            .single()
        expect(await canRead(client, "sales_opportunity_logs", log.data.id)).toBe(false)
    })

    it("the Support Salesperson (same-role colleague outside the group) still reads Stage 3", async () => {
        const client = await clientFor("support")
        const log = await serviceClient()
            .from("sales_opportunity_logs")
            .select("id")
            .eq("opportunity_id", sorId)
            .eq("stage_visit_id", visitIds[2])
            .single()
        expect(await canRead(client, "sales_opportunity_logs", log.data.id)).toBe(true)
    })

    it("the Deal Owner cannot move the SOR out of Stage 3", async () => {
        const client = await clientFor("dealOwner")
        const { data, error } = await client
            .from("sales_opportunities")
            .update({ flow_stage_id: stageIds[0] })
            .eq("id", sorId)
            .select("id")
        if (error) {
            expect(error.code).toBe("42501")
        } else {
            expect(data.length).toBe(0)
        }
    })
})
