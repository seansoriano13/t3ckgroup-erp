/**
 * Stage Field types (ticket #893, spec #907 decision 7).
 *
 * `20261121040400_stage_field_currency_employee.sql` adds `currency` and
 * `employee` to the `flow_stage_fields.field_type` check, and converts the
 * Project flows' NOA Amount and people fields to them. The check is the only
 * thing that stops a bad type reaching the table from a caller that skips the
 * app, so it is tested here against the real database.
 *
 * Only the check is asserted. The conversion is proven by `supabase db reset`
 * replaying the migration from empty (migration-gate.yml), not here.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"

let saleTypeId
let flowId
let stageId

beforeAll(async () => {
    await ensureCastLoaded()
    const svc = serviceClient()

    const saleType = await svc
        .from("sale_types")
        .insert({ name: `${MARKER} Stage Field Types Sale Type` })
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

    const stage = await svc
        .from("flow_stages")
        .insert({ flow_id: flowId, name: `${MARKER} Stage`, sort_order: 10 })
        .select("id")
        .single()
    if (stage.error) throw new Error(`Seeding a stage: ${stage.error.message}`)
    stageId = stage.data.id
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("flow_stages").delete().eq("flow_id", flowId)
    await svc.from("sales_flows").delete().eq("id", flowId)
    await svc.from("sale_types").delete().eq("id", saleTypeId)
})

const insertField = (fieldType) =>
    serviceClient()
        .from("flow_stage_fields")
        .insert({
            stage_id: stageId,
            label: `${MARKER} ${fieldType} field`,
            source: "custom",
            field_type: fieldType,
        })
        .select("id, field_type")
        .single()

describe("flow_stage_fields.field_type", () => {
    it.each(["text", "number", "date", "choice", "currency", "employee"])(
        "accepts the %s type",
        async (fieldType) => {
            const { data, error } = await insertField(fieldType)
            expect(error, error?.message).toBeNull()
            expect(data.field_type).toBe(fieldType)
            await serviceClient().from("flow_stage_fields").delete().eq("id", data.id)
        },
    )

    it("refuses a type the app does not know", async () => {
        const { data, error } = await insertField("money")
        expect(data).toBeNull()
        expect(error).not.toBeNull()
        expect(error.message).toMatch(/flow_stage_fields_type_chk/)
    })
})
