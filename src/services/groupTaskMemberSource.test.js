import { describe, expect, it } from "vitest"
import { groupTaskService, resolveMemberSource } from "./groupTaskService"
import { db } from "@/test/db/store"
import { makeEmployee, makeEmployeeGroup, makeHead } from "@/test/factories"

/**
 * #752: a Team or Employee Group fills the member list once (no live link),
 * and a role's default checklist fills in for members who have none.
 */
describe("group task members from a Team or Employee Group", () => {
  it("copies a Team's current people, with no role", async () => {
    const a = makeEmployee({ name: "Ann", sub_department: "Alpha" })
    makeEmployee({ name: "Out", sub_department: "Beta" })

    const members = await resolveMemberSource({ kind: "team", value: "alpha" })

    expect(members.map((m) => m.employeeId)).toEqual([a.id])
    expect(members[0].role).toBeNull()
  })

  it("copies an Employee Group's people, and later changes do not touch the copy", async () => {
    const a = makeEmployee({ name: "Ann" })
    const group = makeEmployeeGroup({ employeeIds: [a.id] })

    const copied = await resolveMemberSource({ kind: "group", value: group.id })
    const b = makeEmployee({ name: "Bob" })
    db.seed("employee_group_members", { group_id: group.id, employee_id: b.id })

    expect(copied.map((m) => m.employeeId)).toEqual([a.id])
    const again = await resolveMemberSource({ kind: "group", value: group.id })
    expect(again.map((m) => m.employeeId).sort()).toEqual([a.id, b.id].sort())
  })

  it("fills a role's default checklist for a member with none, and keeps their own", async () => {
    db.seed("committee_roles", [
      { role_name: "Chair", default_checklist: [{ text: "Open meeting", checked: true }] },
    ])
    const head = makeHead({ name: "Head" })
    const a = makeEmployee({ name: "Ann" })
    const b = makeEmployee({ name: "Bob" })

    const task = await groupTaskService.createGroupTask({
      title: "T",
      description: "d",
      startDate: "2026-04-01",
      dueDate: "2026-04-30",
      createdBy: head.id,
      members: [
        { employeeId: a.id, role: "Chair", taskDescription: "x" },
        { employeeId: b.id, role: "Chair", taskDescription: "x", checklist: [{ text: "Mine", checked: false }] },
      ],
    })

    const rows = db.internal.rowsOf("committee_task_members").filter((m) => m.committee_task_id === task.id)
    const checklistOf = (id) => rows.find((m) => m.employee_id === id).checklist
    expect(checklistOf(a.id)).toEqual([{ text: "Open meeting", checked: false }])
    expect(checklistOf(b.id)).toEqual([{ text: "Mine", checked: false }])
  })
})
