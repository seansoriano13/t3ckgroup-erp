/**
 * Issue #1197 (parent #1187, ADRs 0037 and 0021): a date Stage Field marked "Show on Calendar" puts an
 * all-day SOR_DATE entry on the Calendar, seen only by people who can read the SOR.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER, makeSor } from "./support/rows.js"

const svc = () => serviceClient()
const DAY = "2031-06-12"
const MOVED = "2031-06-20"
const FROM = "2031-06-01"
const TO = "2031-06-30"
let saleTypeId, flowId, stageId, fieldId, offFieldId, sorId, visitId
const sorIds = []

const sorDates = async (who) => {
    const { data, error } = await (await clientFor(who)).rpc("calendar_entries", { p_from: FROM, p_to: TO, p_include_pending: false })
    if (error) throw new Error(`calendar_entries as ${who}: ${error.message}`)
    return data.filter((r) => r.kind === "SOR_DATE" && r.group_id === sorId)
}
const setValue = (fieldIdToSet, value) =>
    svc().from("sor_stage_field_values").upsert({ opportunity_id: sorId, stage_visit_id: visitId, field_id: fieldIdToSet, value }, { onConflict: "stage_visit_id,field_id" })

beforeAll(async () => {
    await ensureCastLoaded()
    saleTypeId = (await svc().from("sale_types").insert({ name: `${MARKER} Retention` }).select("id").single()).data.id
    flowId = (await svc().from("sales_flows").insert({ sale_type_id: saleTypeId }).select("id").single()).data.id
    stageId = (await svc().from("flow_stages").insert({ flow_id: flowId, name: `${MARKER} Retention`, sort_order: 10 }).select("id").single()).data.id
    const mkField = async (label, show) => {
        const { data, error } = await svc()
            .from("flow_stage_fields")
            .insert({ stage_id: stageId, label, source: "custom", field_type: "date", is_required: false, show_on_calendar: show })
            .select("id")
            .single()
        if (error) throw new Error(error.message)
        return data.id
    }
    fieldId = await mkField("Retention release", true)
    offFieldId = await mkField("Other date", false)
    sorId = await makeSor({ registeredBy: ids.dealOwner, dealOwnerId: ids.dealOwner, saleTypeId, flowStageId: stageId })
    sorIds.push(sorId)
    visitId = (await svc().from("sor_stage_visits").select("id").eq("opportunity_id", sorId).single()).data.id
})

afterAll(async () => {
    await svc().from("sor_stage_field_values").delete().in("opportunity_id", sorIds)
    await svc().from("sales_opportunities").delete().in("id", sorIds)
    await svc().from("flow_stage_fields").delete().eq("stage_id", stageId)
    await svc().from("flow_stages").delete().eq("flow_id", flowId)
    await svc().from("sales_flows").delete().eq("id", flowId)
    await svc().from("sale_types").delete().eq("id", saleTypeId)
})

describe("calendar_entries() SOR_DATE branch", () => {
    it("puts an all-day entry on the date, named after the SOR and the field, for someone who can read the SOR", async () => {
        await setValue(fieldId, DAY)
        const rows = await sorDates("dealOwner")
        expect(rows).toHaveLength(1)
        expect(rows[0].manila_date).toBe(DAY)
        expect(rows[0].all_day).toBe(true)
        expect(rows[0].title).toContain("Retention release")
        expect(rows[0].details.opportunity_id).toBe(sorId)
    })

    it("gives someone who cannot read the SOR nothing at all", async () => {
        expect(await sorDates("outsider")).toHaveLength(0)
    })

    it("ignores a date field that is not marked Show on Calendar", async () => {
        await setValue(offFieldId, DAY)
        expect((await sorDates("dealOwner")).map((r) => r.details.field_label)).toEqual(["Retention release"])
    })

    it("moves the entry when the date changes and removes it when the date is cleared", async () => {
        await setValue(fieldId, MOVED)
        expect((await sorDates("dealOwner")).map((r) => r.manila_date)).toEqual([MOVED])
        await setValue(fieldId, null)
        expect(await sorDates("dealOwner")).toHaveLength(0)
        await setValue(fieldId, DAY)
    })

    it("shows none for a deleted or scratch SOR", async () => {
        for (const flag of ["is_deleted", "is_scratch"]) {
            await svc().from("sales_opportunities").update({ [flag]: true }).eq("id", sorId)
            expect(await sorDates("dealOwner")).toHaveLength(0)
            await svc().from("sales_opportunities").update({ [flag]: false }).eq("id", sorId)
        }
        expect(await sorDates("dealOwner")).toHaveLength(1)
    })

    it("shows none for a Lost SOR", async () => {
        const lost = (await svc().from("crm_pipeline_stages").select("code").eq("is_lost", true).limit(1).maybeSingle()).data
        if (!lost) return
        const before = (await svc().from("sales_opportunities").select("status").eq("id", sorId).single()).data.status
        const moved = await svc().from("sales_opportunities").update({ status: lost.code }).eq("id", sorId)
        if (moved.error) throw new Error(moved.error.message)
        expect(await sorDates("dealOwner")).toHaveLength(0)
        await svc().from("sales_opportunities").update({ status: before }).eq("id", sorId)
    })
})
