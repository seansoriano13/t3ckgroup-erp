import { beforeEach, describe, expect, it } from "vitest"
import { HR_ENTITY_TYPES, systemAuditLogService } from "./systemAuditLogService"
import { makeEmployee, makeHrEmployee, makeSuperAdmin } from "@/test/factories"

/**
 * The audit log is the answer to "who changed this, and when". Two feeds read
 * from it: the super-admin view sees everything, the HR view is scoped to the
 * HR entity types. A leak between them shows HR entries to the wrong audience,
 * or hides an HR action from the people accountable for it.
 */
describe("systemAuditLogService", () => {
  let actor

  beforeEach(() => {
    actor = makeSuperAdmin({ name: "Boss" })
  })

  describe("writing entries", () => {
    it("records a system event against its actor", async () => {
      await systemAuditLogService.addSystemEvent(
        "EMPLOYEE",
        "emp-123",
        "Employee profile updated",
        { event: "EMPLOYEE_UPDATED" },
        actor.id,
      )

      const [entry] = await systemAuditLogService.getRecentSystemActivity()
      expect(entry).toMatchObject({
        type: "SYSTEM",
        entityType: "EMPLOYEE",
        entityId: "emp-123",
        authorId: actor.id,
        authorName: "Boss",
        authorIsSuperAdmin: true,
      })
    })

    it("records an approval event distinctly from a system event", async () => {
      await systemAuditLogService.addApprovalEvent(
        "SIL_LEAVE",
        "leave-1",
        "SIL leave approved",
        null,
        actor.id,
      )

      const [entry] = await systemAuditLogService.getRecentSystemActivity()
      expect(entry.type).toBe("APPROVAL")
    })

    it("attributes an unowned action to the system", async () => {
      await systemAuditLogService.addSystemEvent("SETTINGS", "app_settings", "Settings changed")

      const [entry] = await systemAuditLogService.getRecentSystemActivity()
      expect(entry.authorId).toBeNull()
      expect(entry.authorName).toBeNull()
    })

    it("stores a numeric entity id as text so every entity reads alike", async () => {
      await systemAuditLogService.addSystemEvent("CATEGORY", 42, "Category deleted")

      const [entry] = await systemAuditLogService.getRecentSystemActivity()
      expect(entry.entityId).toBe("42")
    })
  })

  describe("the super-admin feed", () => {
    beforeEach(async () => {
      await systemAuditLogService.addSystemEvent("EMPLOYEE", "e1", "Employee created", {
        employeeId: "target-1",
      }, actor.id)
      await systemAuditLogService.addApprovalEvent("SIL_LEAVE", "l1", "Leave approved", {
        employeeId: "target-2",
      }, actor.id)
      await systemAuditLogService.addSystemEvent("OPPORTUNITY", "o1", "Deal registered")
    })

    it("returns the newest entry first", async () => {
      const feed = await systemAuditLogService.getRecentSystemActivity()

      expect(feed.map((e) => e.content)).toEqual([
        "Deal registered",
        "Leave approved",
        "Employee created",
      ])
    })

    it("filters by entry type", async () => {
      const approvals = await systemAuditLogService.getRecentSystemActivity({ type: "APPROVAL" })

      expect(approvals.map((e) => e.content)).toEqual(["Leave approved"])
    })

    it("filters to entries with no human actor", async () => {
      const systemOnly = await systemAuditLogService.getRecentSystemActivity({
        authorId: "SYSTEM",
      })

      expect(systemOnly.map((e) => e.content)).toEqual(["Deal registered"])
    })

    it("filters by the employee an entry is about, not its author", async () => {
      const aboutTarget = await systemAuditLogService.getRecentSystemActivity({
        employeeId: "target-2",
      })

      expect(aboutTarget.map((e) => e.content)).toEqual(["Leave approved"])
    })

    it("filters by entity type", async () => {
      const opportunities = await systemAuditLogService.getRecentSystemActivity({
        entityType: "OPPORTUNITY",
      })

      expect(opportunities.map((e) => e.content)).toEqual(["Deal registered"])
    })

    it("searches the entry text case-insensitively", async () => {
      const found = await systemAuditLogService.getRecentSystemActivity({ search: "LEAVE" })

      expect(found.map((e) => e.content)).toEqual(["Leave approved"])
    })

    it("treats a wildcard character in the search as literal text", async () => {
      await systemAuditLogService.addSystemEvent("EMPLOYEE", "e2", "Discount of 50% applied")

      const found = await systemAuditLogService.getRecentSystemActivity({ search: "50%" })

      expect(found.map((e) => e.content)).toEqual(["Discount of 50% applied"])
    })

    it("clamps an absurd page size", async () => {
      await expect(
        systemAuditLogService.getRecentSystemActivity({ limit: 100000 }),
      ).resolves.toHaveLength(3)
    })

    it("pages with limit and offset", async () => {
      const page = await systemAuditLogService.getRecentSystemActivity({ limit: 1, offset: 1 })

      expect(page.map((e) => e.content)).toEqual(["Leave approved"])
    })

    it("labels an entry by its entity type for the feed", async () => {
      const feed = await systemAuditLogService.getRecentSystemActivity({ entityType: "EMPLOYEE" })

      expect(feed[0].taskDescription).toBe("[EMPLOYEE]")
    })
  })

  describe("the HR feed", () => {
    it("shows only the HR entity types by default", async () => {
      await systemAuditLogService.addSystemEvent("SIL_LEAVE", "l1", "Leave applied")
      await systemAuditLogService.addSystemEvent("OVERTIME", "o1", "Overtime applied")
      await systemAuditLogService.addSystemEvent("OPPORTUNITY", "d1", "Deal registered")
      await systemAuditLogService.addSystemEvent("TASK", "t1", "Task approved")

      const feed = await systemAuditLogService.getRecentHrActivity()

      expect(feed.map((e) => e.content).sort()).toEqual(["Leave applied", "Overtime applied"])
    })

    it("covers every entity type the HR trail is defined to include", () => {
      expect(HR_ENTITY_TYPES).toEqual([
        "EMPLOYEE",
        "CATEGORY",
        "OVERTIME",
        "OFFSET_LEAVE",
        "SIL_LEAVE",
        "HR_SETTINGS"
      ])
    })

    it("narrows to a single entity type when asked", async () => {
      await systemAuditLogService.addSystemEvent("SIL_LEAVE", "l1", "Leave applied")
      await systemAuditLogService.addSystemEvent("OVERTIME", "o1", "Overtime applied")

      const feed = await systemAuditLogService.getRecentHrActivity({ entityType: "OVERTIME" })

      expect(feed.map((e) => e.content)).toEqual(["Overtime applied"])
    })

    it("names the HR officer who acted", async () => {
      const hr = makeHrEmployee({ name: "HR Officer" })
      await systemAuditLogService.addApprovalEvent("SIL_LEAVE", "l1", "Approved", null, hr.id)

      const [entry] = await systemAuditLogService.getRecentHrActivity()

      expect(entry).toMatchObject({ authorName: "HR Officer", authorIsHr: true })
    })

    it("filters by the employee the entry concerns", async () => {
      const subject = makeEmployee({ name: "Ana Reyes" })
      await systemAuditLogService.addSystemEvent("SIL_LEAVE", "l1", "About Ana", {
        employeeId: subject.id,
      })
      await systemAuditLogService.addSystemEvent("SIL_LEAVE", "l2", "About someone else", {
        employeeId: "other",
      })

      const feed = await systemAuditLogService.getRecentHrActivity({ employeeId: subject.id })

      expect(feed.map((e) => e.content)).toEqual(["About Ana"])
    })
  })
})
