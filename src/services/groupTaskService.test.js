import { beforeEach, describe, expect, it } from "vitest"
import { groupTaskService } from "./groupTaskService"
import { db } from "@/test/db/store"
import { waitForNetworkIdle } from "@/test/network"
import { makeEmployee, makeHead, makeHrEmployee, makeSuperAdmin } from "@/test/factories"
import { taskTagService } from "./taskTagService"
import { stubEdgeFunction } from "@/test/msw/server"

/**
 * A group task is one piece of work split across several people, each with
 * their own assignment and grade. It completes itself once every member is
 * done, and only the people involved should be able to see or move it.
 */
describe("groupTaskService", () => {
  let creator
  let alice
  let bob

  beforeEach(() => {
    creator = makeHead({ name: "Head Ito", department: "OPS" })
    alice = makeEmployee({ name: "Alice Santos" })
    bob = makeEmployee({ name: "Bob Cruz" })
  })

  const createTask = (overrides = {}) =>
    groupTaskService.createGroupTask({
      title: "Year-end inventory",
      description: "Count everything in the warehouse",
      dueDate: "2026-04-30",
      createdBy: creator.id,
      members: [
        { employeeId: alice.id, taskDescription: "Count aisle A" },
        { employeeId: bob.id, taskDescription: "Count aisle B" },
      ],
      ...overrides,
    })

  const membersOf = async (taskId) => {
    const task = await groupTaskService.getGroupTaskById(taskId)
    return task.members
  }

  describe("creating", () => {
    it("creates the task with an assignment for every member", async () => {
      const task = await createTask()

      const members = await membersOf(task.id)
      expect(members.map((m) => m.task_description).sort()).toEqual([
        "Count aisle A",
        "Count aisle B",
      ])
      expect(members.every((m) => m.status === "PENDING")).toBe(true)
    })

    it("refuses a group task with nobody on it", async () => {
      await expect(createTask({ members: [] })).rejects.toThrow(
        "Add at least one member to the group task",
      )
      expect(db.rows("committee_tasks")).toEqual([])
    })

    it("tells each member what they were assigned", async () => {
      // GROUP_ASSIGNED is one of the four types #168 pushes to a closed tab,
      // so it is created by the send-push edge function rather than inserted
      // directly — see notificationService.createNotification.
      const pushed = []
      stubEdgeFunction("send-push", (body) => {
        pushed.push(body)
        return { success: true }
      })

      await createTask()
      await waitForNetworkIdle()

      expect(pushed.map((n) => n.recipient_id).sort()).toEqual([alice.id, bob.id].sort())
      expect(pushed.find((n) => n.recipient_id === alice.id).message).toContain(
        "Count aisle A",
      )
    })

    it("opens the history with the creation", async () => {
      const task = await createTask()

      const history = await groupTaskService.getGroupTaskHistory(task.id)
      expect(history.map((h) => h.action)).toContain("CREATED")
    })
  })

  describe("start date and lead time", () => {
    it("keeps the start date and the lead time exactly as typed", async () => {
      const task = await createTask({ startDate: "2026-10-01", leadTime: "120 calendar days" })

      const found = await groupTaskService.getGroupTaskById(task.id)
      expect(found.start_date).toBe("2026-10-01")
      expect(found.lead_time).toBe("120 calendar days")
    })

    it("leaves both blank when they are not given", async () => {
      const found = await groupTaskService.getGroupTaskById((await createTask()).id)
      expect(found.start_date).toBeNull()
      expect(found.lead_time).toBeNull()
    })

    it("takes a lead time that is not a number of days", async () => {
      // An extension is recorded as a note — "Extended" — and the Due Date is
      // moved by hand; nothing computes a date from the lead time.
      const task = await createTask({ startDate: "2026-10-01", leadTime: "120 calendar days" })

      await groupTaskService.updateGroupTask(
        task.id,
        { title: "Year-end inventory", description: "", dueDate: "2026-12-31", startDate: "2026-10-01", leadTime: "Extended" },
        creator.id,
      )

      const found = await groupTaskService.getGroupTaskById(task.id)
      expect(found.lead_time).toBe("Extended")
      expect(found.start_date).toBe("2026-10-01")
    })

    it("keeps them when an edit doesn't mention them", async () => {
      const task = await createTask({ startDate: "2026-10-01", leadTime: "120 calendar days" })

      await groupTaskService.updateGroupTask(task.id, { title: "Renamed" }, creator.id)

      const found = await groupTaskService.getGroupTaskById(task.id)
      expect(found.title).toBe("Renamed")
      expect(found.start_date).toBe("2026-10-01")
      expect(found.lead_time).toBe("120 calendar days")
    })

    it("stores a blank lead time as unset", async () => {
      const found = await groupTaskService.getGroupTaskById(
        (await createTask({ leadTime: "   " })).id,
      )
      expect(found.lead_time).toBeNull()
    })
  })

  describe("who can see it", () => {
    it("shows a super admin every group task", async () => {
      const otherHead = makeHead({ name: "Other Head" })
      await createTask()
      await groupTaskService.createGroupTask({
        title: "Unrelated",
        createdBy: otherHead.id,
        members: [{ employeeId: otherHead.id, taskDescription: "Solo" }],
      })
      const boss = makeSuperAdmin({ name: "Boss" })

      const visible = await groupTaskService.getGroupTasks(boss.id, false, true)

      expect(visible).toHaveLength(2)
    })

    it("shows a member the task they are on", async () => {
      const task = await createTask()

      const visible = await groupTaskService.getGroupTasks(alice.id, false, false)

      expect(visible.map((t) => t.id)).toEqual([task.id])
    })

    it("hides a task from someone who is neither member nor creator", async () => {
      await createTask()
      const outsider = makeEmployee({ name: "Outsider" })

      expect(await groupTaskService.getGroupTasks(outsider.id, false, false)).toEqual([])
    })

    it("shows the creator their own task", async () => {
      const task = await createTask()

      const visible = await groupTaskService.getGroupTasks(creator.id, true, false)

      expect(visible.map((t) => t.id)).toEqual([task.id])
    })

    it("hides a cancelled task from everyone", async () => {
      const task = await createTask()
      await groupTaskService.cancelGroupTask(task.id, creator.id)
      const boss = makeSuperAdmin({ name: "Boss" })

      expect(await groupTaskService.getGroupTasks(boss.id, false, true)).toEqual([])
    })
  })

  describe("members marking their work done", () => {
    it("lets a member update their own assignment", async () => {
      const task = await createTask()
      const [aliceAssignment] = (await membersOf(task.id)).filter(
        (m) => m.employee_id === alice.id,
      )

      await groupTaskService.updateMemberStatus(aliceAssignment.id, "DONE", alice.id)

      const updated = (await membersOf(task.id)).find((m) => m.employee_id === alice.id)
      expect(updated.status).toBe("DONE")
    })

    it("lets the creator update a member's assignment", async () => {
      const task = await createTask()
      const [aliceAssignment] = (await membersOf(task.id)).filter(
        (m) => m.employee_id === alice.id,
      )

      await expect(
        groupTaskService.updateMemberStatus(aliceAssignment.id, "DONE", creator.id),
      ).resolves.toBe(true)
    })

    it("refuses a member who is trying to move somebody else's assignment", async () => {
      const task = await createTask()
      const [aliceAssignment] = (await membersOf(task.id)).filter(
        (m) => m.employee_id === alice.id,
      )

      await expect(
        groupTaskService.updateMemberStatus(aliceAssignment.id, "DONE", bob.id),
      ).rejects.toThrow("Unauthorized to update this task")
    })

    it("carries an uploaded attachment back on the member, both by id and in the list", async () => {
      const task = await createTask()
      const [aliceAssignment] = (await membersOf(task.id)).filter(
        (m) => m.employee_id === alice.id,
      )
      const descriptor = {
        url: "https://res.cloudinary.com/demo/raw/upload/report.pdf",
        name: "report.pdf",
        type: "application/pdf",
        bytes: 2048,
      }

      await groupTaskService.addMemberAttachment(aliceAssignment.id, descriptor, alice.id)

      const byId = (await membersOf(task.id)).find((m) => m.employee_id === alice.id)
      expect(byId.attachments).toEqual([descriptor])

      const [visible] = await groupTaskService.getGroupTasks(alice.id, false, false)
      const inList = visible.members.find((m) => m.employee_id === alice.id)
      expect(inList.attachments).toEqual([descriptor])
    })

    it("leaves the task active while anyone is still pending", async () => {
      const task = await createTask()
      const [aliceAssignment] = (await membersOf(task.id)).filter(
        (m) => m.employee_id === alice.id,
      )

      await groupTaskService.updateMemberStatus(aliceAssignment.id, "DONE", alice.id)

      expect((await groupTaskService.getGroupTaskById(task.id)).status).toBe("ACTIVE")
    })

    it("leaves the task active for the head to assess once the last member is done", async () => {
      const task = await createTask()
      const members = await membersOf(task.id)

      for (const member of members) {
        await groupTaskService.updateMemberStatus(member.id, "DONE", member.employee_id)
      }

      // Auto-completion was removed so the head gets a chance to grade the
      // work before the task closes out; markGroupTaskComplete is now the
      // only path to COMPLETED.
      expect((await groupTaskService.getGroupTaskById(task.id)).status).toBe("ACTIVE")
    })

    it("tells the creator when a member finishes", async () => {
      const task = await createTask()
      await waitForNetworkIdle()
      const before = db.rows("notifications").length
      const [aliceAssignment] = (await membersOf(task.id)).filter(
        (m) => m.employee_id === alice.id,
      )

      await groupTaskService.updateMemberStatus(aliceAssignment.id, "DONE", alice.id)
      await waitForNetworkIdle()

      const added = db.rows("notifications").slice(before)
      expect(added.map((n) => n.recipient_id)).toEqual([creator.id])
      expect(added[0].type).toBe("GROUP_MEMBER_DONE")
    })

    it("does not notify the creator about their own update", async () => {
      const task = await createTask({
        members: [{ employeeId: creator.id, taskDescription: "Do it myself" }],
      })
      await waitForNetworkIdle()
      const before = db.rows("notifications").length
      const [assignment] = await membersOf(task.id)

      await groupTaskService.updateMemberStatus(assignment.id, "DONE", creator.id)
      await waitForNetworkIdle()

      expect(db.rows("notifications")).toHaveLength(before)
    })
  })

  describe("grading members", () => {
    it("records a grade and remarks against each member", async () => {
      const task = await createTask()
      const members = await membersOf(task.id)

      await groupTaskService.rateMembers(
        task.id,
        members.map((m) => ({ memberId: m.id, grade: 4, gradeRemarks: "Thorough" })),
        creator.id,
      )

      const rated = await membersOf(task.id)
      expect(rated.every((m) => m.grade === 4 && m.grade_remarks === "Thorough")).toBe(true)
      expect(rated.every((m) => m.rated_by === creator.id && m.rated_at)).toBe(true)
    })

    it("hands the task to HR once everyone is graded", async () => {
      const task = await createTask()
      const members = await membersOf(task.id)

      await groupTaskService.rateMembers(
        task.id,
        members.map((m) => ({ memberId: m.id, grade: 3 })),
        creator.id,
      )

      expect((await groupTaskService.getGroupTaskById(task.id)).status).toBe("HR_PENDING")
    })

    it("clears an earlier HR rejection when the task is graded again", async () => {
      const hr = makeHrEmployee({ name: "HR Officer" })
      const task = await createTask()
      const members = await membersOf(task.id)
      await groupTaskService.rejectGroupTask(task.id, hr.id, "Recount aisle B")

      await groupTaskService.rateMembers(
        task.id,
        members.map((m) => ({ memberId: m.id, grade: 4 })),
        creator.id,
      )

      expect((await groupTaskService.getGroupTaskById(task.id)).hr_remarks).toBeNull()
    })
  })

  describe("HR verification", () => {
    it("marks the task verified", async () => {
      const hr = makeHrEmployee({ name: "HR Officer" })
      const task = await createTask()
      await groupTaskService.markGroupTaskComplete(task.id, creator.id)

      await groupTaskService.verifyGroupTask(task.id, hr.id, "Checked the counts")

      const verified = await groupTaskService.getGroupTaskById(task.id)
      expect(verified.hr_verified).toBe(true)
      expect(verified.hr_verified_by).toBe(hr.id)
    })

    it("sends the task back to the members when HR rejects it", async () => {
      const hr = makeHrEmployee({ name: "HR Officer" })
      const task = await createTask()
      const members = await membersOf(task.id)
      for (const member of members) {
        await groupTaskService.updateMemberStatus(member.id, "DONE", member.employee_id)
      }

      await groupTaskService.rejectGroupTask(task.id, hr.id, "Recount aisle B")

      const rejected = await groupTaskService.getGroupTaskById(task.id)
      expect(rejected.hr_verified).toBe(false)
      expect(rejected.hr_remarks).toBe("Recount aisle B")
    })
  })

  describe("adding a member after the task was already closed out", () => {
    it("reopens a completed task so the new member's work can be done", async () => {
      const task = await createTask()
      await groupTaskService.markGroupTaskComplete(task.id, creator.id)

      const carol = makeEmployee({ name: "Carol Reyes" })
      await groupTaskService.addMemberToTask(
        task.id,
        { employeeId: carol.id, taskDescription: "Count aisle C" },
        creator.id,
      )

      const reopened = await groupTaskService.getGroupTaskById(task.id)
      expect(reopened.status).toBe("ACTIVE")
    })

    it("reopens a task that was already sent to HR", async () => {
      const task = await createTask()
      const members = await membersOf(task.id)
      for (const member of members) {
        await groupTaskService.updateMemberStatus(member.id, "DONE", member.employee_id)
      }
      await groupTaskService.rateMembers(
        task.id,
        members.map((m) => ({ memberId: m.id, grade: 90, gradeRemarks: "Good" })),
        creator.id,
      )
      expect((await groupTaskService.getGroupTaskById(task.id)).status).toBe("HR_PENDING")

      const carol = makeEmployee({ name: "Carol Reyes" })
      await groupTaskService.addMemberToTask(
        task.id,
        { employeeId: carol.id, taskDescription: "Count aisle C" },
        creator.id,
      )

      const reopened = await groupTaskService.getGroupTaskById(task.id)
      expect(reopened.status).toBe("ACTIVE")
    })

    it("leaves an already-active task's status alone", async () => {
      const task = await createTask()

      const carol = makeEmployee({ name: "Carol Reyes" })
      await groupTaskService.addMemberToTask(
        task.id,
        { employeeId: carol.id, taskDescription: "Count aisle C" },
        creator.id,
      )

      expect((await groupTaskService.getGroupTaskById(task.id)).status).toBe("ACTIVE")
    })
  })

  describe("editing assignments", () => {
    it("changes what a member was asked to do", async () => {
      const task = await createTask()
      const [assignment] = await membersOf(task.id)

      await groupTaskService.updateMemberAssignment(
        assignment.id,
        task.id,
        { taskDescription: "Count aisles A and C" },
        creator.id,
      )

      const updated = (await membersOf(task.id)).find((m) => m.id === assignment.id)
      expect(updated.task_description).toBe("Count aisles A and C")
    })

    it("leaves the checklist alone when an edit does not mention it", async () => {
      const task = await createTask({
        members: [
          {
            employeeId: alice.id,
            taskDescription: "Count aisle A",
            checklist: [{ text: "Shelf 1", checked: false }],
          },
        ],
      })
      const [assignment] = await membersOf(task.id)

      await groupTaskService.updateMemberAssignment(
        assignment.id,
        task.id,
        { taskDescription: "Count aisle A twice" },
        creator.id,
      )

      const updated = (await membersOf(task.id)).find((m) => m.id === assignment.id)
      expect(updated.checklist).toEqual([{ text: "Shelf 1", checked: false }])
    })

    it("lets the assignee tick their own checklist items", async () => {
      const task = await createTask({
        members: [
          {
            employeeId: alice.id,
            taskDescription: "Count aisle A",
            checklist: [{ text: "Shelf 1", checked: false }],
          },
        ],
      })
      const [assignment] = await membersOf(task.id)

      await groupTaskService.updateMemberChecklist(
        assignment.id,
        [{ text: "Shelf 1", checked: true }],
        task.id,
        alice.id,
      )

      const updated = (await membersOf(task.id)).find((m) => m.id === assignment.id)
      expect(updated.checklist).toEqual([{ text: "Shelf 1", checked: true }])
    })

    it("refuses a checklist tick from anyone but the assignee", async () => {
      const task = await createTask()
      const [assignment] = await membersOf(task.id)

      await expect(
        groupTaskService.updateMemberChecklist(
          assignment.id,
          [{ text: "Shelf 1", checked: true }],
          task.id,
          bob.id,
        ),
      ).rejects.toThrow("Only the assigned member can update this checklist.")
    })

    it("freezes the checklist once the assignment is marked done", async () => {
      const task = await createTask({
        members: [
          {
            employeeId: alice.id,
            taskDescription: "Count aisle A",
            checklist: [{ text: "Shelf 1", checked: true }],
          },
        ],
      })
      const [assignment] = await membersOf(task.id)
      await groupTaskService.updateMemberStatus(assignment.id, "DONE", alice.id)
      await waitForNetworkIdle()

      // Grading keys off DONE, so the evidence must stop moving at that point.
      await expect(
        groupTaskService.updateMemberChecklist(
          assignment.id,
          [{ text: "Shelf 1", checked: false }],
          task.id,
          alice.id,
        ),
      ).rejects.toThrow("already marked done")
    })

    it("removes a member from the task", async () => {
      const task = await createTask()
      const [assignment] = await membersOf(task.id)

      await groupTaskService.removeMemberFromTask(assignment.id, task.id, creator.id)

      expect(await membersOf(task.id)).toHaveLength(1)
    })

    it("refuses, and logs nothing, when no member was actually removed", async () => {
      // RLS refuses a delete by matching zero rows rather than erroring; a
      // member someone already removed matches zero rows the same way. Either
      // way the member is not gone because of this call, so it must not say so.
      const task = await createTask()
      const [assignment] = await membersOf(task.id)
      await groupTaskService.removeMemberFromTask(assignment.id, task.id, creator.id)
      await waitForNetworkIdle()
      const removalsLogged = () =>
        db.rows("committee_task_logs").filter((l) => l.action === "MEMBER_REMOVED").length

      await expect(
        groupTaskService.removeMemberFromTask(assignment.id, task.id, creator.id),
      ).rejects.toThrow("This member wasn't removed")
      await waitForNetworkIdle()

      expect(removalsLogged()).toBe(1)
    })
  })

  describe("tags (issue #205)", () => {
    it("tags a group task at creation", async () => {
      const bidding = await taskTagService.create({ name: "Bidding", color: "blue", createdBy: creator.id })

      const task = await createTask({ tagIds: [bidding.id] })
      const found = await groupTaskService.getGroupTaskById(task.id)

      expect(found.tags.map((t) => t.id)).toEqual([bidding.id])
    })

    it("sets and reads back a group task's tags", async () => {
      const bidding = await taskTagService.create({ name: "Bidding", color: "blue", createdBy: creator.id })
      const committee = await taskTagService.create({ name: "Committee", color: "green", createdBy: creator.id })
      const task = await createTask()

      await groupTaskService.setTags(task.id, [bidding.id, committee.id], creator.id)
      let found = await groupTaskService.getGroupTaskById(task.id)
      expect(found.tags.map((t) => t.id).sort()).toEqual([bidding.id, committee.id].sort())

      await groupTaskService.setTags(task.id, [bidding.id], creator.id)
      found = await groupTaskService.getGroupTaskById(task.id)
      expect(found.tags.map((t) => t.id)).toEqual([bidding.id])
    })

    it("clears every tag when set to an empty list", async () => {
      const bidding = await taskTagService.create({ name: "Bidding", color: "blue", createdBy: creator.id })
      const task = await createTask({ tagIds: [bidding.id] })

      await groupTaskService.setTags(task.id, [], creator.id)

      const found = await groupTaskService.getGroupTaskById(task.id)
      expect(found.tags).toEqual([])
    })

    it("lists tags on getGroupTasks too", async () => {
      const bidding = await taskTagService.create({ name: "Bidding", color: "blue", createdBy: creator.id })
      await createTask({ tagIds: [bidding.id] })

      const all = await groupTaskService.getGroupTasks(creator.id, true, false)
      expect(all[0].tags.map((t) => t.id)).toEqual([bidding.id])
    })
  })
})
