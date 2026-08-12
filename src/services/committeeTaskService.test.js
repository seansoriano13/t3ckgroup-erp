import { beforeEach, describe, expect, it } from "vitest"
import { committeeTaskService } from "./committeeTaskService"
import { db } from "@/test/db/store"
import { waitForNetworkIdle } from "@/test/network"
import { makeEmployee, makeHead, makeHrEmployee, makeSuperAdmin } from "@/test/factories"

/**
 * A committee task is one piece of work split across several people, each with
 * their own assignment and grade. It completes itself once every member is
 * done, and only the people involved should be able to see or move it.
 */
describe("committeeTaskService", () => {
  let creator
  let alice
  let bob

  beforeEach(() => {
    creator = makeHead({ name: "Head Ito", department: "OPS" })
    alice = makeEmployee({ name: "Alice Santos" })
    bob = makeEmployee({ name: "Bob Cruz" })
  })

  const createTask = (overrides = {}) =>
    committeeTaskService.createCommitteeTask({
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
    const task = await committeeTaskService.getCommitteeTaskById(taskId)
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

    it("refuses a committee task with nobody on it", async () => {
      await expect(createTask({ members: [] })).rejects.toThrow(
        "Add at least one member to the committee task",
      )
      expect(db.rows("committee_tasks")).toEqual([])
    })

    it("tells each member what they were assigned", async () => {
      await createTask()
      await waitForNetworkIdle()

      const notifications = db.rows("notifications")
      expect(notifications.map((n) => n.recipient_id).sort()).toEqual([alice.id, bob.id].sort())
      expect(notifications.find((n) => n.recipient_id === alice.id).message).toContain(
        "Count aisle A",
      )
    })

    it("opens the history with the creation", async () => {
      const task = await createTask()

      const history = await committeeTaskService.getCommitteeTaskHistory(task.id)
      expect(history.map((h) => h.action)).toContain("CREATED")
    })
  })

  describe("who can see it", () => {
    it("shows a super admin every committee task", async () => {
      const otherHead = makeHead({ name: "Other Head" })
      await createTask()
      await committeeTaskService.createCommitteeTask({
        title: "Unrelated",
        createdBy: otherHead.id,
        members: [{ employeeId: otherHead.id, taskDescription: "Solo" }],
      })
      const boss = makeSuperAdmin({ name: "Boss" })

      const visible = await committeeTaskService.getCommitteeTasks(boss.id, false, true)

      expect(visible).toHaveLength(2)
    })

    it("shows a member the task they are on", async () => {
      const task = await createTask()

      const visible = await committeeTaskService.getCommitteeTasks(alice.id, false, false)

      expect(visible.map((t) => t.id)).toEqual([task.id])
    })

    it("hides a task from someone who is neither member nor creator", async () => {
      await createTask()
      const outsider = makeEmployee({ name: "Outsider" })

      expect(await committeeTaskService.getCommitteeTasks(outsider.id, false, false)).toEqual([])
    })

    it("shows the creator their own task", async () => {
      const task = await createTask()

      const visible = await committeeTaskService.getCommitteeTasks(creator.id, true, false)

      expect(visible.map((t) => t.id)).toEqual([task.id])
    })

    it("hides a cancelled task from everyone", async () => {
      const task = await createTask()
      await committeeTaskService.cancelCommitteeTask(task.id, creator.id)
      const boss = makeSuperAdmin({ name: "Boss" })

      expect(await committeeTaskService.getCommitteeTasks(boss.id, false, true)).toEqual([])
    })
  })

  describe("members marking their work done", () => {
    it("lets a member update their own assignment", async () => {
      const task = await createTask()
      const [aliceAssignment] = (await membersOf(task.id)).filter(
        (m) => m.employee_id === alice.id,
      )

      await committeeTaskService.updateMemberStatus(aliceAssignment.id, "DONE", alice.id)

      const updated = (await membersOf(task.id)).find((m) => m.employee_id === alice.id)
      expect(updated.status).toBe("DONE")
    })

    it("lets the creator update a member's assignment", async () => {
      const task = await createTask()
      const [aliceAssignment] = (await membersOf(task.id)).filter(
        (m) => m.employee_id === alice.id,
      )

      await expect(
        committeeTaskService.updateMemberStatus(aliceAssignment.id, "DONE", creator.id),
      ).resolves.toBe(true)
    })

    it("refuses a member who is trying to move somebody else's assignment", async () => {
      const task = await createTask()
      const [aliceAssignment] = (await membersOf(task.id)).filter(
        (m) => m.employee_id === alice.id,
      )

      await expect(
        committeeTaskService.updateMemberStatus(aliceAssignment.id, "DONE", bob.id),
      ).rejects.toThrow("Unauthorized to update this task")
    })

    it("leaves the task active while anyone is still pending", async () => {
      const task = await createTask()
      const [aliceAssignment] = (await membersOf(task.id)).filter(
        (m) => m.employee_id === alice.id,
      )

      await committeeTaskService.updateMemberStatus(aliceAssignment.id, "DONE", alice.id)

      expect((await committeeTaskService.getCommitteeTaskById(task.id)).status).toBe("ACTIVE")
    })

    it("completes the task once the last member is done", async () => {
      const task = await createTask()
      const members = await membersOf(task.id)

      for (const member of members) {
        await committeeTaskService.updateMemberStatus(member.id, "DONE", member.employee_id)
      }

      expect((await committeeTaskService.getCommitteeTaskById(task.id)).status).toBe("COMPLETED")
    })

    it("tells the creator when a member finishes", async () => {
      const task = await createTask()
      await waitForNetworkIdle()
      const before = db.rows("notifications").length
      const [aliceAssignment] = (await membersOf(task.id)).filter(
        (m) => m.employee_id === alice.id,
      )

      await committeeTaskService.updateMemberStatus(aliceAssignment.id, "DONE", alice.id)
      await waitForNetworkIdle()

      const added = db.rows("notifications").slice(before)
      expect(added.map((n) => n.recipient_id)).toEqual([creator.id])
      expect(added[0].type).toBe("COMMITTEE_MEMBER_DONE")
    })

    it("does not notify the creator about their own update", async () => {
      const task = await createTask({
        members: [{ employeeId: creator.id, taskDescription: "Do it myself" }],
      })
      await waitForNetworkIdle()
      const before = db.rows("notifications").length
      const [assignment] = await membersOf(task.id)

      await committeeTaskService.updateMemberStatus(assignment.id, "DONE", creator.id)
      await waitForNetworkIdle()

      expect(db.rows("notifications")).toHaveLength(before)
    })
  })

  describe("grading members", () => {
    it("records a grade and remarks against each member", async () => {
      const task = await createTask()
      const members = await membersOf(task.id)

      await committeeTaskService.rateMembers(
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

      await committeeTaskService.rateMembers(
        task.id,
        members.map((m) => ({ memberId: m.id, grade: 3 })),
        creator.id,
      )

      expect((await committeeTaskService.getCommitteeTaskById(task.id)).status).toBe("HR_PENDING")
    })

    it("clears an earlier HR rejection when the task is graded again", async () => {
      const hr = makeHrEmployee({ name: "HR Officer" })
      const task = await createTask()
      const members = await membersOf(task.id)
      await committeeTaskService.rejectCommitteeTask(task.id, hr.id, "Recount aisle B")

      await committeeTaskService.rateMembers(
        task.id,
        members.map((m) => ({ memberId: m.id, grade: 4 })),
        creator.id,
      )

      expect((await committeeTaskService.getCommitteeTaskById(task.id)).hr_remarks).toBeNull()
    })
  })

  describe("HR verification", () => {
    it("marks the task verified", async () => {
      const hr = makeHrEmployee({ name: "HR Officer" })
      const task = await createTask()
      await committeeTaskService.markCommitteeTaskComplete(task.id, creator.id)

      await committeeTaskService.verifyCommitteeTask(task.id, hr.id, "Checked the counts")

      const verified = await committeeTaskService.getCommitteeTaskById(task.id)
      expect(verified.hr_verified).toBe(true)
      expect(verified.hr_verified_by).toBe(hr.id)
    })

    it("sends the task back to the members when HR rejects it", async () => {
      const hr = makeHrEmployee({ name: "HR Officer" })
      const task = await createTask()
      const members = await membersOf(task.id)
      for (const member of members) {
        await committeeTaskService.updateMemberStatus(member.id, "DONE", member.employee_id)
      }

      await committeeTaskService.rejectCommitteeTask(task.id, hr.id, "Recount aisle B")

      const rejected = await committeeTaskService.getCommitteeTaskById(task.id)
      expect(rejected.hr_verified).toBe(false)
      expect(rejected.hr_remarks).toBe("Recount aisle B")
    })
  })

  describe("editing assignments", () => {
    it("changes what a member was asked to do", async () => {
      const task = await createTask()
      const [assignment] = await membersOf(task.id)

      await committeeTaskService.updateMemberTaskDescription(
        assignment.id,
        "Count aisles A and C",
        task.id,
        creator.id,
      )

      const updated = (await membersOf(task.id)).find((m) => m.id === assignment.id)
      expect(updated.task_description).toBe("Count aisles A and C")
    })

    it("removes a member from the task", async () => {
      const task = await createTask()
      const [assignment] = await membersOf(task.id)

      await committeeTaskService.removeMemberFromTask(assignment.id, task.id, creator.id)

      expect(await membersOf(task.id)).toHaveLength(1)
    })
  })
})
