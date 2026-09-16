import { describe, it, expect } from "vitest"
import { groupTaskRow, individualTaskRow, taskRows, MAX_AVATARS } from "./sorTasks"
import { TASK_STATUS } from "./status"

describe("MAX_AVATARS", () => {
  it("is a positive number", () => {
    expect(MAX_AVATARS).toBeGreaterThan(0)
  })
})

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
