import { beforeEach, describe, expect, it } from "vitest"
import { stageConditionService } from "./stageConditionService"
import { db } from "@/test/db/store"
import {
  makeEmployee,
  makeOpportunity,
  makeConditionStatus,
  makeStageCondition,
  makeSuperAdmin,
  makeSaleType,
  makeSalesFlow,
  makeFlowStage,
} from "@/test/factories"
import { waitForNetworkIdle } from "@/test/network"

/**
 * Stage Gate Engine configuration (docs/stage-gate-engine-spec.md, ticket 3):
 * add / reorder / archive a Stage's conditions. Reading them for the live
 * gate is ticket 1/2's job — opportunityService.test.js already covers an
 * archived condition's effect on a move, so that case isn't repeated here.
 */
describe("stageConditionService", () => {
  let admin
  let regular
  let saleType
  let flow
  let stage

  beforeEach(() => {
    admin = makeSuperAdmin({ name: "Admin Ana" })
    regular = makeEmployee({ name: "Regular Rey" })
    saleType = makeSaleType()
    flow = makeSalesFlow({ sale_type_id: saleType.id })
    stage = makeFlowStage({ flow_id: flow.id })
  })

  describe("getForStage", () => {
    it("returns a stage's conditions in sort order", async () => {
      makeStageCondition({ stage_id: stage.id, label: "Second", sort_order: 1 })
      makeStageCondition({ stage_id: stage.id, label: "First", sort_order: 0 })

      const conditions = await stageConditionService.getForStage(stage.id)

      expect(conditions.map((r) => r.label)).toEqual(["First", "Second"])
    })

    it("excludes archived conditions by default", async () => {
      makeStageCondition({ stage_id: stage.id, label: "Live" })
      makeStageCondition({
        stage_id: stage.id,
        label: "Archived",
        archived_at: "2026-01-01T00:00:00.000Z",
      })

      const conditions = await stageConditionService.getForStage(stage.id)

      expect(conditions.map((r) => r.label)).toEqual(["Live"])
    })

    it("includes archived conditions when asked", async () => {
      makeStageCondition({ stage_id: stage.id, label: "Live" })
      makeStageCondition({
        stage_id: stage.id,
        label: "Archived",
        archived_at: "2026-01-01T00:00:00.000Z",
      })

      const conditions = await stageConditionService.getForStage(stage.id, {
        includeArchived: true,
      })

      expect(conditions.map((r) => r.label).sort()).toEqual(["Archived", "Live"])
    })

    it("returns nothing for a stage with no conditions configured", async () => {
      expect(await stageConditionService.getForStage(stage.id)).toEqual([])
    })
  })

  describe("add", () => {
    it("allows any authenticated employee to add a condition", async () => {
      const created = await stageConditionService.add(
        { stageId: stage.id, kind: "attachment", label: "Notice of Award on file", config: { accepts: ["pdf"] } },
        regular.id,
      )

      expect(created.label).toBe("Notice of Award on file")
      expect(await stageConditionService.getForStage(stage.id)).toHaveLength(1)
    })

    it("lets a Super Admin add a condition", async () => {
      const created = await stageConditionService.add(
        {
          stageId: stage.id,
          kind: "attachment",
          label: "Notice of Award on file",
          isRequired: true,
          config: { accepts: ["pdf"] },
        },
        admin.id,
      )

      expect(created).toMatchObject({
        stage_id: stage.id,
        kind: "attachment",
        label: "Notice of Award on file",
        is_required: true,
        config: { accepts: ["pdf"] },
      })
    })

    // Issue #203: Field on record and Project Evaluation are removed kinds —
    // no longer offered for a *new* condition, though `update` and the
    // evaluator still accept them on rows saved before this changed.
    it("rejects field and project_evaluation for a new condition", async () => {
      await expect(
        stageConditionService.add(
          { stageId: stage.id, kind: "field", label: "Contact person on file", config: { column: "contact_person" } },
          admin.id,
        ),
      ).rejects.toThrow(/Kind must be one of/)

      await expect(
        stageConditionService.add(
          { stageId: stage.id, kind: "project_evaluation", label: "Go/no-go decided" },
          admin.id,
        ),
      ).rejects.toThrow(/Kind must be one of/)
    })

    it("defaults a new condition to required", async () => {
      const created = await stageConditionService.add(
        { stageId: stage.id, kind: "tickbox", label: "Bid documents checked" },
        admin.id,
      )

      expect(created.is_required).toBe(true)
    })

    it("persists and round-trips an optional condition", async () => {
      await stageConditionService.add(
        { stageId: stage.id, kind: "tickbox", label: "Nice to have", isRequired: false },
        admin.id,
      )

      const conditions = await stageConditionService.getForStage(stage.id)
      expect(conditions[0].is_required).toBe(false)
    })

    it("appends after a stage's existing conditions", async () => {
      makeStageCondition({ stage_id: stage.id, sort_order: 0 })
      makeStageCondition({ stage_id: stage.id, sort_order: 1 })

      const created = await stageConditionService.add(
        { stageId: stage.id, kind: "tickbox", label: "Third" },
        admin.id,
      )

      expect(created.sort_order).toBe(2)
    })

    it("counts an archived sibling when computing the next position", async () => {
      makeStageCondition({ stage_id: stage.id, sort_order: 0, archived_at: "2026-01-01T00:00:00.000Z" })

      const created = await stageConditionService.add(
        { stageId: stage.id, kind: "tickbox", label: "Second" },
        admin.id,
      )

      expect(created.sort_order).toBe(1)
    })

    it("rejects a kind outside the five supported ones", async () => {
      await expect(
        stageConditionService.add(
          { stageId: stage.id, kind: "signature", label: "Something" },
          admin.id,
        ),
      ).rejects.toThrow(/Kind must be one of/)
    })

    it("rejects a blank label", async () => {
      await expect(
        stageConditionService.add({ stageId: stage.id, kind: "tickbox", label: "   " }, admin.id),
      ).rejects.toThrow(/needs a label/)
    })

    it("rejects a deadline with zero or no days — a UI form's min=1 is client-side only", async () => {
      await expect(
        stageConditionService.add(
          { stageId: stage.id, kind: "deadline", label: "Confirm receipt", config: { days: 0 } },
          admin.id,
        ),
      ).rejects.toThrow(/positive number of days/)

      await expect(
        stageConditionService.add(
          { stageId: stage.id, kind: "deadline", label: "Confirm receipt" },
          admin.id,
        ),
      ).rejects.toThrow(/positive number of days/)
    })

    it("accepts a deadline with a positive day count", async () => {
      const created = await stageConditionService.add(
        { stageId: stage.id, kind: "deadline", label: "Confirm receipt", config: { days: 2 } },
        admin.id,
      )

      expect(created.config).toEqual({ days: 2 })
    })

    it("logs who added the condition and when", async () => {
      const created = await stageConditionService.add(
        { stageId: stage.id, kind: "tickbox", label: "Bid documents checked" },
        admin.id,
      )
      await waitForNetworkIdle()

      const entry = db.rows("system_audit_logs").find((e) => e.entity_id === created.id)
      expect(entry.content).toContain("Bid documents checked")
      expect(entry.author_id).toBe(admin.id)
      expect(entry.metadata.event).toBe("STAGE_CONDITION_ADDED")
    })

    // Issue #41: a rule that has just been decided to matter should apply to
    // the deals in front of you, but a user who suddenly can't advance a deal
    // deserves to know why.
    it("narrates onto the timeline of every deal currently sitting on that Stage", async () => {
      const onStage = makeOpportunity({
        registered_by: admin.id,
        flow_stage_id: stage.id, sale_type_id: saleType.id,
        sales_reference: "S00998",
      })
      const elsewhere = makeOpportunity({ registered_by: admin.id, status: "LEAD" })

      await stageConditionService.add(
        { stageId: stage.id, kind: "tickbox", label: "Bid documents checked" },
        admin.id,
      )

      const onStageNotes = db
        .rows("sales_opportunity_logs")
        .filter((n) => n.opportunity_id === onStage.id)
      expect(onStageNotes.some((n) => n.content.includes('Bid documents checked'))).toBe(true)

      const elsewhereNotes = db
        .rows("sales_opportunity_logs")
        .filter((n) => n.opportunity_id === elsewhere.id)
      expect(elsewhereNotes).toHaveLength(0)
    })

    it("writes no notes and does not fail when the Stage has no deals on it", async () => {
      await expect(
        stageConditionService.add(
          { stageId: stage.id, kind: "tickbox", label: "Bid documents checked" },
          admin.id,
        ),
      ).resolves.toBeTruthy()
    })
  })

  describe("update", () => {
    it("edits label, isRequired and config while the flow is a draft", async () => {
      const condition = makeStageCondition({
        stage_id: stage.id,
        kind: "attachment",
        label: "Old label",
        is_required: false,
        config: { accepts: [] },
      })

      const updated = await stageConditionService.update(
        condition.id,
        { label: "New label", isRequired: true, config: { accepts: ["pdf"] } },
        admin.id,
      )

      expect(updated).toMatchObject({
        label: "New label",
        is_required: true,
        config: { accepts: ["pdf"] },
      })
    })

    it("refuses once the owning flow is no longer a draft", async () => {
      const otherSaleType = makeSaleType()
      const locked = makeSalesFlow({ sale_type_id: otherSaleType.id, state: "locked" })
      const lockedStage = makeFlowStage({ flow_id: locked.id })
      const condition = makeStageCondition({ stage_id: lockedStage.id, kind: "tickbox" })

      await expect(
        stageConditionService.update(condition.id, { label: "New label" }, admin.id),
      ).rejects.toThrow(/read-only/)
    })

    it("refuses a kind change", async () => {
      const condition = makeStageCondition({ stage_id: stage.id, kind: "tickbox" })

      await expect(
        stageConditionService.update(condition.id, { kind: "attachment" }, admin.id),
      ).rejects.toThrow(/kind is fixed/)
    })

    it("notes the change on SORs sitting on that stage, the way add and archive already do", async () => {
      const condition = makeStageCondition({ stage_id: stage.id, kind: "tickbox", label: "Old" })
      const onStage = makeOpportunity({
        registered_by: admin.id,
        flow_stage_id: stage.id,
        sale_type_id: saleType.id,
        sales_reference: "S01001",
      })

      await stageConditionService.update(condition.id, { label: "New" }, admin.id)

      const notes = db.rows("sales_opportunity_logs").filter((n) => n.opportunity_id === onStage.id)
      expect(notes.some((n) => n.content.includes("New"))).toBe(true)
    })

    it("writes the audit log", async () => {
      const condition = makeStageCondition({ stage_id: stage.id, kind: "tickbox", label: "Old" })

      await stageConditionService.update(condition.id, { label: "New" }, admin.id)
      await waitForNetworkIdle()

      const entry = db.rows("system_audit_logs").find((e) => e.entity_id === condition.id)
      expect(entry.metadata.event).toBe("STAGE_CONDITION_UPDATED")
    })
  })

  describe("reorder", () => {
    it("allows any authenticated employee to reorder conditions", async () => {
      const first = makeStageCondition({ stage_id: stage.id, sort_order: 0 })
      const second = makeStageCondition({ stage_id: stage.id, sort_order: 1 })

      await stageConditionService.reorder(
        [{ id: first.id, sortOrder: 1 }, { id: second.id, sortOrder: 0 }],
        regular.id,
      )

      const conditions = await stageConditionService.getForStage(stage.id)
      expect(conditions.map((r) => r.id)).toEqual([second.id, first.id])
    })

    it("persists a new order and round-trips through getForStage", async () => {
      const first = makeStageCondition({ stage_id: stage.id, label: "First", sort_order: 0 })
      const second = makeStageCondition({ stage_id: stage.id, label: "Second", sort_order: 1 })

      await stageConditionService.reorder(
        [{ id: first.id, sortOrder: 1 }, { id: second.id, sortOrder: 0 }],
        admin.id,
      )

      const conditions = await stageConditionService.getForStage(stage.id)
      expect(conditions.map((r) => r.label)).toEqual(["Second", "First"])
    })

    it("logs the reorder", async () => {
      const first = makeStageCondition({ stage_id: stage.id, sort_order: 0 })
      const second = makeStageCondition({ stage_id: stage.id, sort_order: 1 })

      await stageConditionService.reorder(
        [{ id: first.id, sortOrder: 1 }, { id: second.id, sortOrder: 0 }],
        admin.id,
      )
      await waitForNetworkIdle()

      const entry = db.rows("system_audit_logs").at(-1)
      expect(entry.metadata.event).toBe("STAGE_CONDITION_REORDERED")
      expect(entry.author_id).toBe(admin.id)
    })
  })

  describe("archive", () => {
    it("allows any authenticated employee to archive a condition", async () => {
      const condition = makeStageCondition({ stage_id: stage.id })

      const archived = await stageConditionService.archive(condition.id, regular.id)
      expect(archived.archived_at).toBeTruthy()
    })

    it("soft-archives — the row survives, just stops showing as live", async () => {
      const condition = makeStageCondition({ stage_id: stage.id })

      const archived = await stageConditionService.archive(condition.id, admin.id)

      expect(archived.archived_at).toBeTruthy()
      expect(await stageConditionService.getForStage(stage.id)).toEqual([])
      expect(
        await stageConditionService.getForStage(stage.id, { includeArchived: true }),
      ).toHaveLength(1)
    })

    it("does not disturb an existing satisfaction row (D21 — no hard delete, no retroactive rewrite)", async () => {
      const condition = makeStageCondition({ stage_id: stage.id, kind: "tickbox" })
      const opportunity = makeOpportunity({ registered_by: admin.id })
      const status = makeConditionStatus({
        opportunity_id: opportunity.id,
        condition_id: condition.id,
        satisfied_by: admin.id,
      })

      await stageConditionService.archive(condition.id, admin.id)

      expect(db.rows("sor_condition_status").find((r) => r.id === status.id)).toBeTruthy()
    })

    it("logs who archived the condition and when", async () => {
      const condition = makeStageCondition({ stage_id: stage.id, label: "Bid documents checked" })

      await stageConditionService.archive(condition.id, admin.id)
      await waitForNetworkIdle()

      const entry = db.rows("system_audit_logs").find((e) => e.entity_id === condition.id)
      expect(entry.content).toContain("Bid documents checked")
      expect(entry.author_id).toBe(admin.id)
      expect(entry.metadata.event).toBe("STAGE_CONDITION_ARCHIVED")
    })

    it("narrates onto the timeline of every deal currently sitting on that Stage", async () => {
      const condition = makeStageCondition({ stage_id: stage.id, label: "Bid documents checked" })
      const onStage = makeOpportunity({
        registered_by: admin.id,
        flow_stage_id: stage.id, sale_type_id: saleType.id,
        sales_reference: "S00999",
      })
      const elsewhere = makeOpportunity({ registered_by: admin.id, status: "LEAD" })

      await stageConditionService.archive(condition.id, admin.id)

      const onStageNotes = db
        .rows("sales_opportunity_logs")
        .filter((n) => n.opportunity_id === onStage.id)
      expect(onStageNotes.some((n) => n.content.includes('Bid documents checked" (archived)'))).toBe(
        true,
      )

      const elsewhereNotes = db
        .rows("sales_opportunity_logs")
        .filter((n) => n.opportunity_id === elsewhere.id)
      expect(elsewhereNotes.some((n) => n.content.includes("archived"))).toBe(false)
    })
  })
})
