import { beforeEach, describe, expect, it } from "vitest"
import { stageRequirementService } from "./stageRequirementService"
import { db } from "@/test/db/store"
import {
  makeEmployee,
  makeOpportunity,
  makeRequirementStatus,
  makeStageRequirement,
  makeSuperAdmin,
  seedPipeline,
} from "@/test/factories"
import { waitForNetworkIdle } from "@/test/network"

/**
 * Stage Gate Engine configuration (docs/stage-gate-engine-spec.md, ticket 3):
 * add / reorder / archive a Stage's requirements. Reading them for the live
 * gate is ticket 1/2's job — opportunityService.test.js already covers an
 * archived requirement's effect on a move, so that case isn't repeated here.
 */
describe("stageRequirementService", () => {
  let admin
  let regular

  beforeEach(() => {
    admin = makeSuperAdmin({ name: "Admin Ana" })
    regular = makeEmployee({ name: "Regular Rey" })
    seedPipeline()
  })

  describe("getForStage", () => {
    it("returns a stage's requirements in sort order", async () => {
      makeStageRequirement({ stage_code: "QUALIFIED", label: "Second", sort_order: 1 })
      makeStageRequirement({ stage_code: "QUALIFIED", label: "First", sort_order: 0 })

      const requirements = await stageRequirementService.getForStage("QUALIFIED")

      expect(requirements.map((r) => r.label)).toEqual(["First", "Second"])
    })

    it("excludes archived requirements by default", async () => {
      makeStageRequirement({ stage_code: "QUALIFIED", label: "Live" })
      makeStageRequirement({
        stage_code: "QUALIFIED",
        label: "Archived",
        archived_at: "2026-01-01T00:00:00.000Z",
      })

      const requirements = await stageRequirementService.getForStage("QUALIFIED")

      expect(requirements.map((r) => r.label)).toEqual(["Live"])
    })

    it("includes archived requirements when asked", async () => {
      makeStageRequirement({ stage_code: "QUALIFIED", label: "Live" })
      makeStageRequirement({
        stage_code: "QUALIFIED",
        label: "Archived",
        archived_at: "2026-01-01T00:00:00.000Z",
      })

      const requirements = await stageRequirementService.getForStage("QUALIFIED", {
        includeArchived: true,
      })

      expect(requirements.map((r) => r.label).sort()).toEqual(["Archived", "Live"])
    })

    it("returns nothing for a stage with no requirements configured", async () => {
      expect(await stageRequirementService.getForStage("QUALIFIED")).toEqual([])
    })
  })

  describe("add", () => {
    it("refuses for a non-Super-Admin", async () => {
      await expect(
        stageRequirementService.add(
          { stageCode: "QUALIFIED", kind: "field", label: "Contact person on file", config: { column: "contact_person" } },
          regular.id,
        ),
      ).rejects.toThrow(/Only a Super Admin/)

      expect(await stageRequirementService.getForStage("QUALIFIED")).toEqual([])
    })

    it("lets a Super Admin add a requirement", async () => {
      const created = await stageRequirementService.add(
        {
          stageCode: "QUALIFIED",
          kind: "field",
          label: "Contact person on file",
          isRequired: true,
          config: { column: "contact_person" },
        },
        admin.id,
      )

      expect(created).toMatchObject({
        stage_code: "QUALIFIED",
        kind: "field",
        label: "Contact person on file",
        is_required: true,
        config: { column: "contact_person" },
      })
    })

    it("defaults a new requirement to required", async () => {
      const created = await stageRequirementService.add(
        { stageCode: "QUALIFIED", kind: "tickbox", label: "Bid documents checked" },
        admin.id,
      )

      expect(created.is_required).toBe(true)
    })

    it("persists and round-trips an optional requirement", async () => {
      await stageRequirementService.add(
        { stageCode: "QUALIFIED", kind: "tickbox", label: "Nice to have", isRequired: false },
        admin.id,
      )

      const requirements = await stageRequirementService.getForStage("QUALIFIED")
      expect(requirements[0].is_required).toBe(false)
    })

    it("appends after a stage's existing requirements", async () => {
      makeStageRequirement({ stage_code: "QUALIFIED", sort_order: 0 })
      makeStageRequirement({ stage_code: "QUALIFIED", sort_order: 1 })

      const created = await stageRequirementService.add(
        { stageCode: "QUALIFIED", kind: "tickbox", label: "Third" },
        admin.id,
      )

      expect(created.sort_order).toBe(2)
    })

    it("counts an archived sibling when computing the next position", async () => {
      makeStageRequirement({ stage_code: "QUALIFIED", sort_order: 0, archived_at: "2026-01-01T00:00:00.000Z" })

      const created = await stageRequirementService.add(
        { stageCode: "QUALIFIED", kind: "tickbox", label: "Second" },
        admin.id,
      )

      expect(created.sort_order).toBe(1)
    })

    it("rejects a kind outside the five supported ones", async () => {
      await expect(
        stageRequirementService.add(
          { stageCode: "QUALIFIED", kind: "signature", label: "Something" },
          admin.id,
        ),
      ).rejects.toThrow(/Kind must be one of/)
    })

    it("rejects a blank label", async () => {
      await expect(
        stageRequirementService.add({ stageCode: "QUALIFIED", kind: "tickbox", label: "   " }, admin.id),
      ).rejects.toThrow(/needs a label/)
    })

    it("rejects a deadline with zero or no days — a UI form's min=1 is client-side only", async () => {
      await expect(
        stageRequirementService.add(
          { stageCode: "QUALIFIED", kind: "deadline", label: "Confirm receipt", config: { days: 0 } },
          admin.id,
        ),
      ).rejects.toThrow(/positive number of days/)

      await expect(
        stageRequirementService.add(
          { stageCode: "QUALIFIED", kind: "deadline", label: "Confirm receipt" },
          admin.id,
        ),
      ).rejects.toThrow(/positive number of days/)
    })

    it("accepts a deadline with a positive day count", async () => {
      const created = await stageRequirementService.add(
        { stageCode: "QUALIFIED", kind: "deadline", label: "Confirm receipt", config: { days: 2 } },
        admin.id,
      )

      expect(created.config).toEqual({ days: 2 })
    })

    it("logs who added the requirement and when", async () => {
      const created = await stageRequirementService.add(
        { stageCode: "QUALIFIED", kind: "tickbox", label: "Bid documents checked" },
        admin.id,
      )
      await waitForNetworkIdle()

      const entry = db.rows("system_audit_logs").find((e) => e.entity_id === created.id)
      expect(entry.content).toContain("Bid documents checked")
      expect(entry.author_id).toBe(admin.id)
      expect(entry.metadata.event).toBe("STAGE_REQUIREMENT_ADDED")
    })
  })

  describe("reorder", () => {
    it("refuses for a non-Super-Admin", async () => {
      const first = makeStageRequirement({ stage_code: "QUALIFIED", sort_order: 0 })
      const second = makeStageRequirement({ stage_code: "QUALIFIED", sort_order: 1 })

      await expect(
        stageRequirementService.reorder(
          [{ id: first.id, sortOrder: 1 }, { id: second.id, sortOrder: 0 }],
          regular.id,
        ),
      ).rejects.toThrow(/Only a Super Admin/)

      const requirements = await stageRequirementService.getForStage("QUALIFIED")
      expect(requirements.map((r) => r.id)).toEqual([first.id, second.id])
    })

    it("persists a new order and round-trips through getForStage", async () => {
      const first = makeStageRequirement({ stage_code: "QUALIFIED", label: "First", sort_order: 0 })
      const second = makeStageRequirement({ stage_code: "QUALIFIED", label: "Second", sort_order: 1 })

      await stageRequirementService.reorder(
        [{ id: first.id, sortOrder: 1 }, { id: second.id, sortOrder: 0 }],
        admin.id,
      )

      const requirements = await stageRequirementService.getForStage("QUALIFIED")
      expect(requirements.map((r) => r.label)).toEqual(["Second", "First"])
    })

    it("logs the reorder", async () => {
      const first = makeStageRequirement({ stage_code: "QUALIFIED", sort_order: 0 })
      const second = makeStageRequirement({ stage_code: "QUALIFIED", sort_order: 1 })

      await stageRequirementService.reorder(
        [{ id: first.id, sortOrder: 1 }, { id: second.id, sortOrder: 0 }],
        admin.id,
      )
      await waitForNetworkIdle()

      const entry = db.rows("system_audit_logs").at(-1)
      expect(entry.metadata.event).toBe("STAGE_REQUIREMENT_REORDERED")
      expect(entry.author_id).toBe(admin.id)
    })
  })

  describe("archive", () => {
    it("refuses for a non-Super-Admin", async () => {
      const requirement = makeStageRequirement({ stage_code: "QUALIFIED" })

      await expect(stageRequirementService.archive(requirement.id, regular.id)).rejects.toThrow(
        /Only a Super Admin/,
      )

      expect(await stageRequirementService.getForStage("QUALIFIED")).toHaveLength(1)
    })

    it("soft-archives — the row survives, just stops showing as live", async () => {
      const requirement = makeStageRequirement({ stage_code: "QUALIFIED" })

      const archived = await stageRequirementService.archive(requirement.id, admin.id)

      expect(archived.archived_at).toBeTruthy()
      expect(await stageRequirementService.getForStage("QUALIFIED")).toEqual([])
      expect(
        await stageRequirementService.getForStage("QUALIFIED", { includeArchived: true }),
      ).toHaveLength(1)
    })

    it("does not disturb an existing satisfaction row (D21 — no hard delete, no retroactive rewrite)", async () => {
      const requirement = makeStageRequirement({ stage_code: "QUALIFIED", kind: "tickbox" })
      const opportunity = makeOpportunity({ registered_by: admin.id })
      const status = makeRequirementStatus({
        opportunity_id: opportunity.id,
        requirement_id: requirement.id,
        satisfied_by: admin.id,
      })

      await stageRequirementService.archive(requirement.id, admin.id)

      expect(db.rows("sor_requirement_status").find((r) => r.id === status.id)).toBeTruthy()
    })

    it("logs who archived the requirement and when", async () => {
      const requirement = makeStageRequirement({ stage_code: "QUALIFIED", label: "Bid documents checked" })

      await stageRequirementService.archive(requirement.id, admin.id)
      await waitForNetworkIdle()

      const entry = db.rows("system_audit_logs").find((e) => e.entity_id === requirement.id)
      expect(entry.content).toContain("Bid documents checked")
      expect(entry.author_id).toBe(admin.id)
      expect(entry.metadata.event).toBe("STAGE_REQUIREMENT_ARCHIVED")
    })

    it("narrates onto the timeline of every deal currently sitting on that Stage", async () => {
      const requirement = makeStageRequirement({ stage_code: "QUALIFIED", label: "Bid documents checked" })
      const onStage = makeOpportunity({
        registered_by: admin.id,
        status: "QUALIFIED",
        sales_reference: "S00999",
      })
      const elsewhere = makeOpportunity({ registered_by: admin.id, status: "LEAD" })

      await stageRequirementService.archive(requirement.id, admin.id)

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
