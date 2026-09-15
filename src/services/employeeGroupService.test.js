import { describe, expect, it } from "vitest"
import { employeeGroupService } from "./employeeGroupService"
import {
  makeEmployee,
  makeFlowSnapshot,
  makeFlowStage,
  makeSaleType,
  makeSalesFlow,
  makeStageAction,
  makeStageCondition,
  makeSuperAdmin,
} from "@/test/factories"
import { db } from "@/test/db/store"
import { waitForNetworkIdle } from "@/test/network"

const namesOf = (group) => group.members.map((m) => m.name).sort()

/**
 * Issue #201 — an Employee Group always means its current members:
 * hand-picked people plus everyone on a listed Team, deleted employees never.
 */
describe("employeeGroupService", () => {
  describe("who a group means", () => {
    it("resolves hand-picked members and whole Teams together, each person once", async () => {
      const admin = makeSuperAdmin()
      const opsManager = makeEmployee({ name: "Ops Manager", sub_department: "OPERATIONS" })
      makeEmployee({ name: "Buyer One", sub_department: "PURCHASING" })
      makeEmployee({ name: "Buyer Two", sub_department: " purchasing" })
      makeEmployee({ name: "Marketer", sub_department: "MARKETING" })

      const group = await employeeGroupService.create(
        { name: "Purchasing plus Ops", employeeIds: [opsManager.id], teams: ["Purchasing"] },
        admin.id,
      )

      expect(namesOf(group)).toEqual(["Buyer One", "Buyer Two", "Ops Manager"])
      expect(group.teams).toEqual(["PURCHASING"])
    })

    it("follows HR moving someone into a Team", async () => {
      const admin = makeSuperAdmin()
      const mover = makeEmployee({ name: "Mover", sub_department: "MARKETING" })
      const group = await employeeGroupService.create({ name: "Purchasing", teams: ["PURCHASING"] }, admin.id)
      expect(namesOf(group)).toEqual([])

      db.internal.rowsOf("employees").find((e) => e.id === mover.id).sub_department = "PURCHASING"

      expect(namesOf(await employeeGroupService.get(group.id))).toEqual(["Mover"])
    })

    it("never counts a deleted employee", async () => {
      const admin = makeSuperAdmin()
      const gone = makeEmployee({ name: "Gone", sub_department: "PURCHASING", is_deleted: true })

      const group = await employeeGroupService.create(
        { name: "Purchasing", employeeIds: [gone.id], teams: ["PURCHASING"] },
        admin.id,
      )

      expect(group.members).toEqual([])
    })

    it("replaces members and Teams with exactly what is set", async () => {
      const admin = makeSuperAdmin()
      const a = makeEmployee({ name: "A" })
      const b = makeEmployee({ name: "B" })
      makeEmployee({ name: "Logistics Lead", sub_department: "LOGISTICS" })
      const group = await employeeGroupService.create({ name: "Mixed", employeeIds: [a.id] }, admin.id)

      await employeeGroupService.setMembers(group.id, [b.id], admin.id)
      const result = await employeeGroupService.setTeams(group.id, ["logistics"], admin.id)

      expect(namesOf(result)).toEqual(["B", "Logistics Lead"])
    })
  })

  describe("naming", () => {
    it("refuses a name an active group already holds, whatever its case", async () => {
      const admin = makeSuperAdmin()
      await employeeGroupService.create({ name: "Purchasing" }, admin.id)

      await expect(employeeGroupService.create({ name: " purchasing " }, admin.id)).rejects.toThrow(
        'An active Employee Group is already called "Purchasing".',
      )
    })

    it("frees a name once its group is archived", async () => {
      const admin = makeSuperAdmin()
      const old = await employeeGroupService.create({ name: "Purchasing" }, admin.id)
      await employeeGroupService.archive(old.id, admin.id)

      const fresh = await employeeGroupService.create({ name: "Purchasing" }, admin.id)

      expect(fresh.name).toBe("Purchasing")
    })

    it("renames without changing the id settings point at", async () => {
      const admin = makeSuperAdmin()
      const group = await employeeGroupService.create({ name: "Buyers" }, admin.id)

      const renamed = await employeeGroupService.rename(group.id, { name: "Purchasing Team" }, admin.id)

      expect(renamed).toMatchObject({ id: group.id, name: "Purchasing Team" })
    })
  })

  describe("archiving", () => {
    it("hides a group from list() while get() still resolves it", async () => {
      const admin = makeSuperAdmin()
      makeEmployee({ name: "Buyer", sub_department: "PURCHASING" })
      const group = await employeeGroupService.create({ name: "Purchasing", teams: ["PURCHASING"] }, admin.id)

      await employeeGroupService.archive(group.id, admin.id)

      expect((await employeeGroupService.list()).map((g) => g.id)).not.toContain(group.id)
      expect((await employeeGroupService.list({ includeArchived: true })).map((g) => g.id)).toContain(group.id)
      expect(namesOf(await employeeGroupService.get(group.id))).toEqual(["Buyer"])
    })

    it("can bring an archived group back", async () => {
      const admin = makeSuperAdmin()
      const group = await employeeGroupService.create({ name: "Purchasing" }, admin.id)
      await employeeGroupService.archive(group.id, admin.id)

      await employeeGroupService.restore(group.id, admin.id)

      expect((await employeeGroupService.list()).map((g) => g.id)).toContain(group.id)
    })
  })

  describe("deleting", () => {
    it("is refused while a stage condition's config uses the group, naming the Sale Type", async () => {
      const admin = makeSuperAdmin()
      const group = await employeeGroupService.create({ name: "Purchasing" }, admin.id)
      const flow = makeSalesFlow({ sale_type_id: makeSaleType({ name: "Supply Only" }).id })
      makeStageCondition({
        stage_id: makeFlowStage({ flow_id: flow.id }).id,
        kind: "assignment",
        config: { assignees: [{ type: "group", id: group.id }] },
      })

      await expect(employeeGroupService.remove(group.id, admin.id)).rejects.toThrow(/Supply Only/)
      expect(await employeeGroupService.get(group.id)).toMatchObject({ id: group.id })
    })

    it("is refused while a stage action's config uses the group", async () => {
      const admin = makeSuperAdmin()
      const group = await employeeGroupService.create({ name: "Deciders" }, admin.id)
      const flow = makeSalesFlow({ sale_type_id: makeSaleType({ name: "Projects" }).id })
      makeStageAction({
        stage_id: makeFlowStage({ flow_id: flow.id }).id,
        config: { title: "Decide", decider: [{ type: "group", id: group.id }] },
      })

      await expect(employeeGroupService.remove(group.id, admin.id)).rejects.toThrow(/Projects/)
    })

    it("is refused while only a published version still uses the group", async () => {
      const admin = makeSuperAdmin()
      const group = await employeeGroupService.create({ name: "Purchasing" }, admin.id)
      const flow = makeSalesFlow({ sale_type_id: makeSaleType({ name: "Retail" }).id })
      makeFlowSnapshot({
        flow_id: flow.id,
        snapshot_data: { stages: [], edges: [], actions: [], conditions: [{ config: { assignees: [{ type: "group", id: group.id }] } }] },
      })

      await expect(employeeGroupService.remove(group.id, admin.id)).rejects.toThrow(/Retail/)
    })

    it("succeeds when nothing uses the group", async () => {
      const admin = makeSuperAdmin()
      const member = makeEmployee()
      const group = await employeeGroupService.create({ name: "Unused", employeeIds: [member.id], teams: ["IT"] }, admin.id)
      makeStageCondition({ config: { assignees: [{ type: "employee", id: member.id }] } })

      await employeeGroupService.remove(group.id, admin.id)

      await expect(employeeGroupService.get(group.id)).rejects.toThrow("That Employee Group no longer exists.")
      expect(db.internal.rowsOf("employee_group_members")).toEqual([])
    })
  })

  describe("who may change groups", () => {
    it("refuses every write from someone who is not a Super Admin, readably", async () => {
      const admin = makeSuperAdmin()
      const ordinary = makeEmployee()
      const group = await employeeGroupService.create({ name: "Purchasing" }, admin.id)
      const refusal = "Only a Super Admin can change Employee Groups."

      await expect(employeeGroupService.create({ name: "Mine" }, ordinary.id)).rejects.toThrow(refusal)
      await expect(employeeGroupService.rename(group.id, { name: "Mine" }, ordinary.id)).rejects.toThrow(refusal)
      await expect(employeeGroupService.setMembers(group.id, [ordinary.id], ordinary.id)).rejects.toThrow(refusal)
      await expect(employeeGroupService.setTeams(group.id, ["IT"], ordinary.id)).rejects.toThrow(refusal)
      await expect(employeeGroupService.archive(group.id, ordinary.id)).rejects.toThrow(refusal)
      await expect(employeeGroupService.remove(group.id, ordinary.id)).rejects.toThrow(refusal)

      expect(await employeeGroupService.get(group.id)).toMatchObject({ name: "Purchasing", employeeIds: [] })
    })

    it("lets anyone read groups and their members", async () => {
      const admin = makeSuperAdmin()
      const member = makeEmployee({ name: "Named" })
      await employeeGroupService.create({ name: "Purchasing", employeeIds: [member.id] }, admin.id)

      const [group] = await employeeGroupService.list()

      expect(namesOf(group)).toEqual(["Named"])
    })

    it("records every change in the audit log", async () => {
      const admin = makeSuperAdmin()
      const member = makeEmployee()
      const group = await employeeGroupService.create({ name: "Purchasing" }, admin.id)
      await employeeGroupService.setMembers(group.id, [member.id], admin.id)
      await employeeGroupService.archive(group.id, admin.id)

      await waitForNetworkIdle()
      const events = db.internal
        .rowsOf("system_audit_logs")
        .filter((row) => row.entity_type === "EMPLOYEE_GROUP")
        .map((row) => row.metadata.event)

      expect(events).toEqual(
        expect.arrayContaining(["EMPLOYEE_GROUP_CREATED", "EMPLOYEE_GROUP_MEMBERS_CHANGED", "EMPLOYEE_GROUP_ARCHIVED"]),
      )
    })
  })
})
