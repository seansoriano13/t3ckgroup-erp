import { describe, it, expect } from "vitest"
import { groupTaskRow, individualTaskRow, taskRows, currentVisitTaskRows } from "./sorTasks"
import { TASK_STATUS } from "./status"

describe("groupTaskRow", () => {
  it("shapes a group task's members and completion count", () => {
    const task = {
      id: "gt-1",
      title: "Prepare BOQ",
      due_date: "2026-03-10T00:00:00Z",
      members: [
        { id: "m1", role: "Engineer", task_description: "Draft the BOQ", status: "DONE", employee: { name: "Ben", avatar_path: "/b.png" } },
        { id: "m2", custom_role: "Reviewer", task_description: "Review pricing", status: "PENDING", employee: null },
      ],
    }

    const row = groupTaskRow(task)

    expect(row).toMatchObject({
      id: "gt-1",
      kind: "group",
      entityType: "GROUP_TASK",
      title: "Prepare BOQ",
      dueDate: "2026-03-10T00:00:00Z",
      doneCount: 1,
      totalCount: 2,
    })
    expect(row.members).toEqual([
      { id: "m1", name: "Ben", avatarPath: "/b.png", role: "Engineer", part: "Draft the BOQ", done: true },
      { id: "m2", name: "Unassigned", avatarPath: null, role: "Reviewer", part: "Review pricing", done: false },
    ])
  })

  it("falls back to defaults for a titleless task with no members", () => {
    const row = groupTaskRow({ id: "gt-2", members: [] })
    expect(row.title).toBe("Group Task")
    expect(row.members).toEqual([])
    expect(row.doneCount).toBe(0)
    expect(row.totalCount).toBe(0)
  })
})

describe("individualTaskRow", () => {
  it("models a done individual task as a one-part group", () => {
    const task = {
      id: "t-1",
      status: TASK_STATUS.COMPLETE,
      project_title: "Confirm delivery address",
      end_at: "2026-03-05T00:00:00Z",
      assignee: { name: "Ana", avatar_path: "/a.png" },
    }

    const row = individualTaskRow(task)

    expect(row).toEqual({
      id: "t-1",
      kind: "individual",
      entityType: "TASK",
      title: "Confirm delivery address",
      dueDate: "2026-03-05T00:00:00Z",
      members: [{ id: "t-1", name: "Ana", avatarPath: "/a.png", role: "Assignee", part: "", done: true }],
      doneCount: 1,
      totalCount: 1,
    })
  })

  it("falls back to the description's first line when there is no project title", () => {
    const row = individualTaskRow({ id: "t-2", status: TASK_STATUS.INCOMPLETE, task_description: "Call the client\nConfirm the date" })
    expect(row.title).toBe("Call the client")
    expect(row.doneCount).toBe(0)
  })

  it("falls back to a stated title with no project title or description", () => {
    const row = individualTaskRow({ id: "t-3", status: TASK_STATUS.INCOMPLETE })
    expect(row.title).toBe("Individual Task")
  })
})

describe("taskRows", () => {
  it("puts group tasks before individual tasks", () => {
    const rows = taskRows({
      individualTasks: [{ id: "t-1", status: TASK_STATUS.INCOMPLETE, project_title: "Individual" }],
      groupTasks: [{ id: "gt-1", title: "Group", members: [] }],
    })

    expect(rows.map((r) => r.id)).toEqual(["gt-1", "t-1"])
  })

  it("defaults to an empty list", () => {
    expect(taskRows()).toEqual([])
  })
})

describe("currentVisitTaskRows (#299)", () => {
  const visit = { id: "visit-2", enteredAt: "2026-02-01T00:00:00Z", leftAt: null }
  const individual = (overrides) => ({ id: overrides.id, status: TASK_STATUS.INCOMPLETE, created_at: "2026-02-05T00:00:00Z", stage_visit_id: null, ...overrides })
  const group = (overrides) => ({ id: overrides.id, title: overrides.id, status: "ACTIVE", created_at: "2026-02-05T00:00:00Z", stage_visit_id: null, members: [], ...overrides })

  it("keeps only the current Stage Visit's tasks: stamped to it, or unstamped and created inside it", () => {
    const rows = currentVisitTaskRows(
      {
        individualTasks: [
          individual({ id: "stamped-here", stage_visit_id: "visit-2", created_at: "2026-01-10T00:00:00Z" }),
          individual({ id: "unstamped-inside" }),
          individual({ id: "stamped-elsewhere", stage_visit_id: "visit-1" }),
          individual({ id: "unstamped-before", created_at: "2026-01-15T00:00:00Z" }),
        ],
        groupTasks: [group({ id: "group-here", stage_visit_id: "visit-2" }), group({ id: "group-before", stage_visit_id: "visit-1" })],
      },
      visit,
    )

    expect(rows.map((r) => r.id)).toEqual(["group-here", "stamped-here", "unstamped-inside"])
  })

  it("drops deleted tasks", () => {
    const rows = currentVisitTaskRows(
      {
        individualTasks: [individual({ id: "gone", status: TASK_STATUS.DELETED }), individual({ id: "kept" })],
        groupTasks: [],
      },
      visit,
    )

    expect(rows.map((r) => r.id)).toEqual(["kept"])
  })

  it("keeps every non-deleted task on a pipeline deal, which has no Stage Visits to scope by", () => {
    const rows = currentVisitTaskRows(
      {
        individualTasks: [individual({ id: "old", created_at: "2020-01-01T00:00:00Z" }), individual({ id: "gone", status: TASK_STATUS.DELETED })],
        groupTasks: [group({ id: "group" })],
      },
      null,
    )

    expect(rows.map((r) => r.id)).toEqual(["group", "old"])
  })
})
