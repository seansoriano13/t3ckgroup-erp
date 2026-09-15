import { beforeEach, describe, expect, it } from "vitest"
import { stageFieldService } from "./stageFieldService"
import { db } from "@/test/db/store"
import {
  makeEmployee,
  makeOpportunity,
  makeSaleType,
  makeSalesFlow,
  makeFlowStage,
  makeStageField,
} from "@/test/factories"

/**
 * Stage Fields (issue #203) — CRUD over `flow_stage_fields`, and per-visit
 * value save/read over `sor_stage_field_values`. Mirrors
 * `stageConditionService.test.js`'s shape for the CRUD half; `missingStageFields`
 * (constants/stageGate.test.js) covers the pure blocking logic this data feeds.
 */
describe("stageFieldService", () => {
  let admin
  let saleType
  let flow
  let stage

  beforeEach(() => {
    admin = makeEmployee({ name: "Admin Ana" })
    saleType = makeSaleType()
    flow = makeSalesFlow({ sale_type_id: saleType.id })
    stage = makeFlowStage({ flow_id: flow.id })
  })

  describe("getForStage", () => {
    it("returns a stage's fields in sort order", async () => {
      makeStageField({ stage_id: stage.id, label: "Second", sort_order: 1 })
      makeStageField({ stage_id: stage.id, label: "First", sort_order: 0 })

      const fields = await stageFieldService.getForStage(stage.id)

      expect(fields.map((f) => f.label)).toEqual(["First", "Second"])
    })

    it("excludes archived fields by default", async () => {
      makeStageField({ stage_id: stage.id, label: "Live" })
      makeStageField({ stage_id: stage.id, label: "Archived", archived_at: "2026-01-01T00:00:00.000Z" })

      const fields = await stageFieldService.getForStage(stage.id)

      expect(fields.map((f) => f.label)).toEqual(["Live"])
    })
  })

  describe("add", () => {
    it("adds a custom field appended after existing ones", async () => {
      makeStageField({ stage_id: stage.id, sort_order: 0 })

      const field = await stageFieldService.add(
        { stageId: stage.id, label: "Award amount", source: "custom", fieldType: "number" },
        admin.id,
      )

      expect(field.label).toBe("Award amount")
      expect(field.sort_order).toBe(1)
      expect(field.source).toBe("custom")
      expect(field.field_type).toBe("number")
    })

    it("adds an sor-source field from the offered SOR fields", async () => {
      const field = await stageFieldService.add(
        { stageId: stage.id, label: "Expected Award Date", source: "sor", sorField: "expected_award_date" },
        admin.id,
      )

      expect(field.source).toBe("sor")
      expect(field.sor_field).toBe("expected_award_date")
    })

    it("refuses an sor field not on the offered list (e.g. the Client PO Date)", async () => {
      await expect(
        stageFieldService.add(
          { stageId: stage.id, label: "PO Date", source: "sor", sorField: "po_date" },
          admin.id,
        ),
      ).rejects.toThrow(/not one of the SOR fields/)
    })

    it("refuses a blank label", async () => {
      await expect(
        stageFieldService.add({ stageId: stage.id, label: "  ", source: "custom", fieldType: "text" }, admin.id),
      ).rejects.toThrow(/needs a label/)
    })
  })

  describe("update", () => {
    it("edits label, help and required, leaving source/type alone", async () => {
      const field = makeStageField({ stage_id: stage.id, label: "Old", is_required: false })

      const updated = await stageFieldService.update(
        field.id,
        { label: "New label", help: "Explain it", isRequired: true },
        admin.id,
      )

      expect(updated.label).toBe("New label")
      expect(updated.help).toBe("Explain it")
      expect(updated.is_required).toBe(true)
      expect(updated.source).toBe(field.source)
      expect(updated.field_type).toBe(field.field_type)
    })
  })

  describe("archive", () => {
    it("soft-archives a field", async () => {
      const field = makeStageField({ stage_id: stage.id })

      const archived = await stageFieldService.archive(field.id, admin.id)

      expect(archived.archived_at).toBeTruthy()
      const live = await stageFieldService.getForStage(stage.id)
      expect(live).toEqual([])
    })
  })

  describe("saveValue / getValuesForVisit", () => {
    it("saves a custom field's value for a visit and reads it back", async () => {
      const opportunity = makeOpportunity({ flow_stage_id: stage.id })
      // The insert trigger (record_stage_visit) already opened visit #1 for
      // this opportunity — reuse it rather than colliding on sequence.
      const visit = db.rows("sor_stage_visits").find((v) => v.opportunity_id === opportunity.id)
      const field = makeStageField({ stage_id: stage.id })

      await stageFieldService.saveValue(
        { opportunityId: opportunity.id, stageVisitId: visit.id, fieldId: field.id, value: "42" },
        admin.id,
      )

      const values = await stageFieldService.getValuesForVisit(visit.id)
      expect(values[field.id]).toBe("42")
    })

    it("upserts rather than duplicating on a second save for the same visit and field", async () => {
      const opportunity = makeOpportunity({ flow_stage_id: stage.id })
      const visit = db.rows("sor_stage_visits").find((v) => v.opportunity_id === opportunity.id)
      const field = makeStageField({ stage_id: stage.id })

      await stageFieldService.saveValue(
        { opportunityId: opportunity.id, stageVisitId: visit.id, fieldId: field.id, value: "first" },
        admin.id,
      )
      await stageFieldService.saveValue(
        { opportunityId: opportunity.id, stageVisitId: visit.id, fieldId: field.id, value: "second" },
        admin.id,
      )

      const values = await stageFieldService.getValuesForVisit(visit.id)
      expect(values[field.id]).toBe("second")
      expect(db.rows("sor_stage_field_values").filter((r) => r.field_id === field.id)).toHaveLength(1)
    })
  })
})
