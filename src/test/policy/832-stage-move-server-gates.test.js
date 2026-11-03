/**
 * Ticket #832: Database refuses a Stage move whose gates are not met.
 *
 * Verifies that:
 * - A direct update of an SOR's Stage by the Deal Owner with unmet gates is refused.
 * - Stage fields are checked first ("Fill in: ...").
 * - Stage conditions are checked next ("Can't move on yet — missing: ...").
 * - A real move backward (to.sort_order < from.sort_order) skips the gates.
 * - A forward move to a previously visited stage still checks the gates (#831).
 * - Access control (sor_access_level <> 'full') remains enforced.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const MIGRATION = readFileSync("supabase/migrations/20261119040000_832_guard_stage_move_gates.sql", "utf8")

let saleTypeId, flowId, stage1Id, stage2Id, stage3Id
let sorId, fieldId, tickboxCondId, attachmentCondId

async function one(query, what) {
    const { data, error } = await query.select("id").single()
    if (error) throw new Error(`${what}: ${error.message}`)
    return data.id
}

beforeAll(async () => {
    await ensureCastLoaded()
    await sql().query(MIGRATION)

    saleTypeId = await one(svc().from("sale_types").insert({ name: `${MARKER} Gate Check` }), "sale type")
    flowId = await one(svc().from("sales_flows").insert({ sale_type_id: saleTypeId }), "flow")

    stage1Id = await one(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Stage 1`, sort_order: 10 }), "stage 1")
    stage2Id = await one(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Stage 2`, sort_order: 20 }), "stage 2")
    stage3Id = await one(svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Stage 3`, sort_order: 30 }), "stage 3")

    // Stage Field on Stage 2 (required SOR column: expected_award_date)
    fieldId = await one(
        svc().from("flow_stage_fields").insert({
            stage_id: stage2Id,
            label: "Expected Award Date",
            source: "sor",
            sor_field: "expected_award_date",
            field_type: "date",
            is_required: true,
            sort_order: 1,
        }),
        "field",
    )

    // Stage Conditions on Stage 2
    await one(
        svc().from("stage_conditions").insert({
            stage_id: stage2Id,
            kind: "purchasing_settled",
            label: "Purchasing settled",
            is_required: true,
            sort_order: 1,
        }),
        "purchasing cond",
    )

    attachmentCondId = await one(
        svc().from("stage_conditions").insert({
            stage_id: stage2Id,
            kind: "attachment",
            label: "Required Upload",
            is_required: true,
            sort_order: 2,
        }),
        "attachment cond",
    )

    tickboxCondId = await one(
        svc().from("stage_conditions").insert({
            stage_id: stage2Id,
            kind: "tickbox",
            label: "Stage 2 Sign-off",
            is_required: true,
            sort_order: 3,
        }),
        "tickbox cond",
    )

    // Create SOR on Stage 2 with Deal Owner
    sorId = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        saleTypeId,
        flowStageId: stage2Id,
    })

    // Also create an open purchase request with an unclosed item so purchasing_settled is unmet
    const requestId = await one(
        svc().from("purchase_requests").insert({
            opportunity_id: sorId,
            created_by: ids.dealOwner,
        }),
        "purchase request",
    )
    await svc().from("purchase_request_items").insert({
        request_id: requestId,
        source: "new",
        name: `${MARKER} Unclosed item`,
        quantity: 1,
        requested_by: ids.dealOwner,
        status: "to_purchase",
    })

    await svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).is("left_at", null).single()
})

afterAll(async () => {
    if (sorId) {
        await svc().from("purchase_request_items").delete().eq("requested_by", ids.dealOwner)
        await svc().from("purchase_requests").delete().eq("opportunity_id", sorId)
        await svc().from("sales_opportunity_logs").delete().eq("opportunity_id", sorId)
        await svc().from("sor_condition_status").delete().eq("opportunity_id", sorId)
        await svc().from("sor_stage_visits").delete().eq("opportunity_id", sorId)
        await svc().from("sales_opportunities").delete().eq("id", sorId)
    }
    if (fieldId) await svc().from("flow_stage_fields").delete().eq("id", fieldId)
    if (stage2Id) await svc().from("stage_conditions").delete().eq("stage_id", stage2Id)
    if (stage1Id) await svc().from("flow_stages").delete().in("id", [stage1Id, stage2Id, stage3Id])
    if (flowId) await svc().from("sales_flows").delete().eq("id", flowId)
    if (saleTypeId) await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("sor_guard_stage_move server-side gate checks (#832)", () => {
    it("refuses a forward move when a required stage field is missing", async () => {
        const client = await clientFor("dealOwner")
        const { data, error } = await client
            .from("sales_opportunities")
            .update({ flow_stage_id: stage3Id })
            .eq("id", sorId)
            .select("id")

        expect(data).toBeNull()
        expect(error).not.toBeNull()
        expect(error.code).toBe("22023")
        expect(error.message).toContain("Fill in: Expected Award Date")
    })

    it("refuses a forward move when stage conditions are unmet, once fields are filled", async () => {
        // Fill the required SOR field
        await svc().from("sales_opportunities").update({ expected_award_date: "2026-11-20" }).eq("id", sorId)

        const client = await clientFor("dealOwner")
        const { data, error } = await client
            .from("sales_opportunities")
            .update({ flow_stage_id: stage3Id })
            .eq("id", sorId)
            .select("id")

        expect(data).toBeNull()
        expect(error).not.toBeNull()
        expect(error.code).toBe("22023")
        expect(error.message).toContain("Can't move on yet — missing: Purchasing settled, Required Upload, Stage 2 Sign-off")
    })

    it("skips gates on a backward move (to.sort_order < from.sort_order)", async () => {
        // Move backward from Stage 2 (sort_order 20) to Stage 1 (sort_order 10)
        const client = await clientFor("dealOwner")
        const { data, error } = await client
            .from("sales_opportunities")
            .update({ flow_stage_id: stage1Id })
            .eq("id", sorId)
            .select("flow_stage_id")

        expect(error).toBeNull()
        expect(data).toHaveLength(1)
        expect(data[0].flow_stage_id).toBe(stage1Id)
    })

    it("refuses a forward move to a previously visited stage when gates are unmet (#831)", async () => {
        // Move forward from Stage 1 to Stage 2 (Stage 1 has no gates)
        const client = await clientFor("dealOwner")
        const { error: fwdError } = await client
            .from("sales_opportunities")
            .update({ flow_stage_id: stage2Id })
            .eq("id", sorId)
        expect(fwdError).toBeNull()

        // Clear the expected_award_date so Stage 2's gates are unmet again
        await svc().from("sales_opportunities").update({ expected_award_date: null }).eq("id", sorId)

        // Attempting to move forward from Stage 2 to Stage 3 must be refused
        const { error } = await client
            .from("sales_opportunities")
            .update({ flow_stage_id: stage3Id })
            .eq("id", sorId)

        expect(error).not.toBeNull()
        expect(error.code).toBe("22023")
        expect(error.message).toContain("Fill in: Expected Award Date")
    })

    it("allows forward move once all stage fields and stage conditions are satisfied", async () => {
        // 1. Fill stage field
        await svc().from("sales_opportunities").update({ expected_award_date: "2026-11-20" }).eq("id", sorId)

        // Find current visit on Stage 2
        const visitRes = await svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).is("left_at", null).single()
        const curVisitId = visitRes.data.id

        // 2. Tick the tickbox condition
        await svc().from("sor_condition_status").insert({
            opportunity_id: sorId,
            condition_id: tickboxCondId,
            stage_visit_id: curVisitId,
            satisfied_by: ids.dealOwner,
        })

        // 3. Upload attachment log for the attachment condition
        const { error: logErr } = await svc().from("sales_opportunity_logs").insert({
            opportunity_id: sorId,
            author_id: ids.dealOwner,
            content: "Uploaded required document",
            stage_visit_id: curVisitId,
            metadata: {
                attachments: [
                    {
                        conditionId: attachmentCondId,
                        name: "required_upload.pdf",
                        type: "pdf",
                        stageVisitId: curVisitId,
                    },
                ],
            },
        })
        expect(logErr).toBeNull()

        // 4. Settle the purchase request item
        await svc().from("purchase_request_items").update({ status: "received" }).eq("requested_by", ids.dealOwner)

        // Now attempt forward move from Stage 2 to Stage 3
        const client = await clientFor("dealOwner")
        const { data, error } = await client
            .from("sales_opportunities")
            .update({ flow_stage_id: stage3Id })
            .eq("id", sorId)
            .select("flow_stage_id")

        expect(error).toBeNull()
        expect(data).toHaveLength(1)
        expect(data[0].flow_stage_id).toBe(stage3Id)
    })

    it("refuses an unauthorized user even if gates are met", async () => {
        const client = await clientFor("ordinary")
        const { data, error } = await client
            .from("sales_opportunities")
            .update({ flow_stage_id: stage1Id })
            .eq("id", sorId)
            .select("id")

        if (error) {
            expect(error.code).toBe("42501")
        } else {
            expect(data.length).toBe(0)
        }
    })
})

describe("sor_guard_stage_move with flow_snapshot (#832)", () => {
    let snapSaleTypeId, snapFlowId, snapStage1Id, snapStage2Id, snapStage3Id
    let snapCondId, snapFieldId, snapSnapshotId, snapSorId

    beforeAll(async () => {
        snapSaleTypeId = await one(svc().from("sale_types").insert({ name: `${MARKER} Snapshot Flow` }), "sale type")
        snapFlowId = await one(svc().from("sales_flows").insert({ sale_type_id: snapSaleTypeId }), "flow")

        snapStage1Id = await one(svc().from("flow_stages").insert({ flow_id: snapFlowId, name: `${MARKER} S1`, sort_order: 10 }), "s1")
        snapStage2Id = await one(svc().from("flow_stages").insert({ flow_id: snapFlowId, name: `${MARKER} S2`, sort_order: 20 }), "s2")
        snapStage3Id = await one(svc().from("flow_stages").insert({ flow_id: snapFlowId, name: `${MARKER} S3`, sort_order: 30 }), "s3")

        snapFieldId = crypto.randomUUID()
        snapCondId = crypto.randomUUID()

        const snapshotData = {
            stages: [
                { id: snapStage1Id, name: "S1", sort_order: 10 },
                { id: snapStage2Id, name: "S2", sort_order: 20 },
                { id: snapStage3Id, name: "S3", sort_order: 30 },
            ],
            stageFields: [
                {
                    id: snapFieldId,
                    stage_id: snapStage2Id,
                    label: "Snapshot Field",
                    source: "sor",
                    sor_field: "expected_award_date",
                    is_required: true,
                    sort_order: 1,
                },
            ],
            conditions: [
                {
                    id: snapCondId,
                    stage_id: snapStage2Id,
                    label: "Snapshot Tickbox",
                    kind: "tickbox",
                    is_required: true,
                    sort_order: 1,
                },
            ],
        }

        snapSnapshotId = await one(
            svc().from("flow_snapshots").insert({
                flow_id: snapFlowId,
                version: 9988,
                snapshot_data: snapshotData,
            }),
            "snapshot",
        )

        snapSorId = await makeSor({
            registeredBy: ids.dealOwner,
            dealOwnerId: ids.dealOwner,
            saleTypeId: snapSaleTypeId,
            flowStageId: snapStage2Id,
        })
        await svc().from("sales_opportunities").update({ flow_snapshot_id: snapSnapshotId }).eq("id", snapSorId)
    })

    afterAll(async () => {
        if (snapSorId) {
            await svc().from("sor_condition_status").delete().eq("opportunity_id", snapSorId)
            await svc().from("sor_stage_visits").delete().eq("opportunity_id", snapSorId)
            await svc().from("sales_opportunities").delete().eq("id", snapSorId)
        }
        if (snapSnapshotId) await svc().from("flow_snapshots").delete().eq("id", snapSnapshotId)
        if (snapStage1Id) await svc().from("flow_stages").delete().in("id", [snapStage1Id, snapStage2Id, snapStage3Id])
        if (snapFlowId) await svc().from("sales_flows").delete().eq("id", snapFlowId)
        if (snapSaleTypeId) await svc().from("sale_types").delete().eq("id", snapSaleTypeId)
    })

    it("evaluates snapshot-defined stage fields and refuses forward move", async () => {
        const client = await clientFor("dealOwner")
        const { error } = await client
            .from("sales_opportunities")
            .update({ flow_stage_id: snapStage3Id })
            .eq("id", snapSorId)

        expect(error).not.toBeNull()
        expect(error.code).toBe("22023")
        expect(error.message).toContain("Fill in: Snapshot Field")
    })

    it("evaluates snapshot-defined stage conditions once fields are filled", async () => {
        await svc().from("sales_opportunities").update({ expected_award_date: "2026-11-20" }).eq("id", snapSorId)

        const client = await clientFor("dealOwner")
        const { error } = await client
            .from("sales_opportunities")
            .update({ flow_stage_id: snapStage3Id })
            .eq("id", snapSorId)

        expect(error).not.toBeNull()
        expect(error.code).toBe("22023")
        expect(error.message).toContain("Can't move on yet — missing: Snapshot Tickbox")
    })

    it("skips gates on a backward move in a snapshot-backed deal", async () => {
        const client = await clientFor("dealOwner")
        const { data, error } = await client
            .from("sales_opportunities")
            .update({ flow_stage_id: snapStage1Id })
            .eq("id", snapSorId)
            .select("flow_stage_id")

        expect(error).toBeNull()
        expect(data[0].flow_stage_id).toBe(snapStage1Id)
    })
})
