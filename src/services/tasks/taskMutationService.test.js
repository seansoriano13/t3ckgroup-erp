import { beforeEach, describe, expect, it } from "vitest"
import { taskMutationService } from "./taskMutationService"
import { taskQueryService } from "./taskQueryService"
import { supabase } from "@/lib/supabase"
import { db } from "@/test/db/store"
import { waitForNetworkIdle } from "@/test/network"
import { makeCategory, makeEmployee, makeHead, makeHrEmployee, makeSuperAdmin, seedPipeline } from "@/test/factories"
import { stubEdgeFunction } from "@/test/msw/server"

/**
 * The task pipeline is the product: INCOMPLETE → AWAITING APPROVAL → head
 * grades it COMPLETE or NOT APPROVED → HR verifies. Its guards are the only
 * thing stopping a task from being graded twice, verified without a grade, or
 * edited after HR signed it off, so each guard gets a test of its own.
 */
describe("taskMutationService", () => {
  let employee
  let head
  let hr
  let category

  beforeEach(() => {
    seedPipeline()
    employee = makeEmployee({ name: "Ana Reyes", department: "IT" })
    head = makeHead({ name: "Head Ito", department: "IT" })
    hr = makeHrEmployee({ name: "HR Officer" })
    category = makeCategory({ category_id: "IT-01", description: "Support" })
  })

  const readTask = async (taskId) => {
    const { data } = await supabase.from("tasks").select("*").eq("id", taskId).single()
    return data
  }

  const createTask = (overrides = {}) =>
    taskMutationService.createTask({
      taskDescription: "Replace the office switch",
      categoryId: category.category_id,
      loggedById: employee.id,
      submittedById: employee.id,
      submittedByName: "Ana Reyes",
      priority: "MEDIUM",
      ...overrides,
    })

  /** Walks a task to COMPLETE-and-graded, the state HR verification needs. */
  const approveByHead = async (taskId, grade = 4) => {
    await taskMutationService.updateTask(taskId, {
      status: "AWAITING APPROVAL",
      editedBy: employee.id,
    })
    return taskMutationService.updateTask(taskId, {
      status: "COMPLETED",
      grade,
      evaluatedBy: head.id,
      editedBy: head.id,
    })
  }

  describe("creating a task", () => {
    it("starts a task incomplete and unverified", async () => {
      const created = await createTask()

      expect(await readTask(created.id)).toMatchObject({
        status: "INCOMPLETE",
        hr_verified: false,
        evaluated_by: null,
        grade: 0,
      })
    })

    it("keeps what the employee entered", async () => {
      const created = await createTask({
        projectTitle: "Network refresh",
        remarks: "Ordered the part",
        paymentVoucher: "PV-2026-001",
      })

      expect(await readTask(created.id)).toMatchObject({
        task_description: "Replace the office switch",
        project_title: "Network refresh",
        priority: "MEDIUM",
        remarks: "Ordered the part",
        payment_voucher: "PV-2026-001",
      })
    })

    it("defaults the start time to now when none was given", async () => {
      const created = await createTask()

      expect((await readTask(created.id)).start_at).toBeTruthy()
    })

    it("lands already complete when the task is auto-verified", async () => {
      const created = await createTask({ isAutoVerified: true })

      expect(await readTask(created.id)).toMatchObject({
        status: "COMPLETED",
        hr_verified: true,
        evaluated_by: employee.id,
      })
    })

    it("notifies only the named head when one is reported to", async () => {
      const otherHead = makeHead({ name: "Other Head", department: "IT" })

      await createTask({ reportedTo: head.id })
      await waitForNetworkIdle()

      const recipients = db.rows("notifications").map((n) => n.recipient_id)
      expect(recipients).toEqual([head.id])
      expect(recipients).not.toContain(otherHead.id)
    })

    it("falls back to the department head when no one is named", async () => {
      const salesHead = makeHead({ name: "Sales Head", department: "SALES" })

      await createTask()
      await waitForNetworkIdle()

      const recipients = db.rows("notifications").map((n) => n.recipient_id)
      expect(recipients).toEqual([head.id])
      expect(recipients).not.toContain(salesHead.id)
    })

    it("tells the employee when someone else logged the task for them", async () => {
      // TASK_ASSIGNED is one of the four types #168 pushes to a closed tab,
      // so it is sent via the send-push edge function.
      const pushed = []
      stubEdgeFunction("send-push", (body) => {
        pushed.push(body)
        return { success: true }
      })

      await createTask({ submittedById: hr.id, submittedByName: "HR Officer" })
      await waitForNetworkIdle()

      const assigned = pushed.filter((n) => n.type === "TASK_ASSIGNED")
      expect(assigned).toHaveLength(1)
      expect(assigned[0].recipient_id).toBe(employee.id)
    })

    it("opens the activity timeline with the submission", async () => {
      const created = await createTask({ reportedTo: head.id })
      await waitForNetworkIdle()

      const activity = db.rows("task_activity").filter((a) => a.task_id === created.id)
      expect(activity).toHaveLength(1)
      expect(activity[0].content).toBe("Task submitted by Ana Reyes. Reported to: Head Ito.")
    })
  })

  describe("submitting for review", () => {
    it("moves the task into the approval queue", async () => {
      const task = await createTask()

      await taskMutationService.updateTask(task.id, {
        status: "AWAITING APPROVAL",
        editedBy: employee.id,
      })

      expect((await readTask(task.id)).status).toBe("AWAITING APPROVAL")
    })

    it("stamps an end time when the employee did not set one", async () => {
      const task = await createTask()

      await taskMutationService.updateTask(task.id, {
        status: "AWAITING APPROVAL",
        editedBy: employee.id,
      })

      expect((await readTask(task.id)).end_at).toBeTruthy()
    })

    it("keeps an end time the employee did set", async () => {
      const task = await createTask({ endAt: "2026-03-05T10:00:00Z" })

      await taskMutationService.updateTask(task.id, {
        status: "AWAITING APPROVAL",
        editedBy: employee.id,
      })

      expect((await readTask(task.id)).end_at).toBe("2026-03-05T10:00:00.000Z")
    })
  })

  describe("head approval", () => {
    it("records the grade and the evaluator", async () => {
      const task = await createTask()

      await approveByHead(task.id, 5)

      expect(await readTask(task.id)).toMatchObject({
        status: "COMPLETED",
        grade: 5,
        evaluated_by: head.id,
        hr_verified: false,
      })
    })

    it("refuses to approve a task that is already complete and verified", async () => {
      const task = await createTask()
      await approveByHead(task.id)
      await taskMutationService.updateTask(task.id, { hrVerified: true, editedBy: hr.id })

      await expect(
        taskMutationService.updateTask(task.id, {
          status: "COMPLETED",
          grade: 5,
          evaluatedBy: head.id,
          editedBy: head.id,
        }),
      ).rejects.toThrow(/can only approve tasks from INCOMPLETE or AWAITING APPROVAL/)
    })

    it("lets a head re-grade a task HR has not verified yet", async () => {
      const task = await createTask()
      await approveByHead(task.id, 3)

      await taskMutationService.updateTask(task.id, {
        status: "COMPLETED",
        grade: 5,
        evaluatedBy: head.id,
        editedBy: head.id,
      })

      expect((await readTask(task.id)).grade).toBe(5)
    })

    it("refuses a COMPLETED write that names no evaluator", async () => {
      const task = await createTask()

      await expect(
        taskMutationService.updateTask(task.id, { status: "COMPLETED", editedBy: employee.id }),
      ).rejects.toThrow(/status=COMPLETE requires evaluatedBy/)
    })
  })

  describe("head rejection", () => {
    it("sends the task back and clears the grade", async () => {
      const task = await createTask()
      await taskMutationService.updateTask(task.id, {
        status: "AWAITING APPROVAL",
        editedBy: employee.id,
      })

      await taskMutationService.updateTask(task.id, {
        status: "NOT APPROVED",
        grade: 0,
        remarks: "Needs the serial number",
        evaluatedBy: head.id,
        editedBy: head.id,
      })

      expect(await readTask(task.id)).toMatchObject({
        status: "NOT APPROVED",
        grade: 0,
        hr_verified: false,
      })
    })

    it("refuses to reject a task that is not in the queue", async () => {
      const task = await createTask()
      await approveByHead(task.id)

      await expect(
        taskMutationService.updateTask(task.id, {
          status: "NOT APPROVED",
          evaluatedBy: head.id,
          editedBy: head.id,
        }),
      ).rejects.toThrow(/can only reject tasks from INCOMPLETE or AWAITING APPROVAL/)
    })
  })

  describe("HR verification", () => {
    it("marks a graded task verified", async () => {
      const task = await createTask()
      await approveByHead(task.id)

      await taskMutationService.updateTask(task.id, { hrVerified: true, editedBy: hr.id })

      const verified = await readTask(task.id)
      expect(verified.hr_verified).toBe(true)
      expect(verified.hr_verified_at).toBeTruthy()
    })

    it("refuses to verify a task no head has graded", async () => {
      const task = await createTask()
      await supabase
        .from("tasks")
        .update({ status: "COMPLETED", evaluated_by: null })
        .eq("id", task.id)

      await expect(
        taskMutationService.updateTask(task.id, { hrVerified: true, editedBy: hr.id }),
      ).rejects.toThrow(/HR verification requires evaluatedBy/)
    })

    it("refuses to verify a task that is not complete", async () => {
      const task = await createTask()

      await expect(
        taskMutationService.updateTask(task.id, { hrVerified: true, editedBy: hr.id }),
      ).rejects.toThrow(/HR verify requires status=COMPLETE and hrVerified=false/)
    })

    it("refuses to verify the same task twice", async () => {
      const task = await createTask()
      await approveByHead(task.id)
      await taskMutationService.updateTask(task.id, { hrVerified: true, editedBy: hr.id })

      await expect(
        taskMutationService.updateTask(task.id, { hrVerified: true, editedBy: hr.id }),
      ).rejects.toThrow(/HR verify requires status=COMPLETE and hrVerified=false/)
    })

    it("lets HR undo a verification", async () => {
      const task = await createTask()
      await approveByHead(task.id)
      await taskMutationService.updateTask(task.id, { hrVerified: true, editedBy: hr.id })

      await taskMutationService.updateTask(task.id, {
        hrVerified: false,
        status: "COMPLETED",
        editedBy: hr.id,
      })

      expect(await readTask(task.id)).toMatchObject({
        hr_verified: false,
        hr_verified_at: null,
        status: "COMPLETED",
      })
    })

    it("refuses to undo a verification that was never made", async () => {
      const task = await createTask()
      await approveByHead(task.id)

      await expect(
        taskMutationService.updateTask(task.id, {
          hrVerified: false,
          status: "COMPLETED",
          editedBy: hr.id,
        }),
      ).rejects.toThrow(/HR undo requires status=COMPLETE and hrVerified=true/)
    })

    it("refuses an HR rejection of a task that is not awaiting verification", async () => {
      const task = await createTask()

      await expect(
        taskMutationService.updateTask(task.id, {
          status: "NOT APPROVED",
          hrVerified: false,
          editedBy: hr.id,
        }),
      ).rejects.toThrow(/HR reject requires status=COMPLETE and hrVerified=false/)
    })
  })

  describe("the immutability guard on verified tasks", () => {
    let verifiedTask

    beforeEach(async () => {
      verifiedTask = await createTask()
      await approveByHead(verifiedTask.id)
      await taskMutationService.updateTask(verifiedTask.id, { hrVerified: true, editedBy: hr.id })
    })

    it.each([
      ["description", { taskDescription: "Rewritten" }],
      ["project title", { projectTitle: "Different project" }],
      ["category", { categoryId: "IT-99" }],
      ["priority", { priority: "HIGH" }],
      ["grade", { grade: 1 }],
      ["remarks", { remarks: "Changed my mind" }],
      ["attachments", { attachments: ["https://x.test/new.png"] }],
    ])("refuses to change the %s once HR has verified it", async (_label, patch) => {
      await expect(
        taskMutationService.updateTask(verifiedTask.id, { ...patch, editedBy: employee.id }),
      ).rejects.toThrow("Cannot edit core details of a task that has already been verified by HR.")
    })

    it("still allows the HR undo that releases the task", async () => {
      await expect(
        taskMutationService.updateTask(verifiedTask.id, {
          hrVerified: false,
          status: "COMPLETED",
          editedBy: hr.id,
        }),
      ).resolves.toBeTruthy()
    })
  })

  describe("resubmitting a rejected task", () => {
    let task

    beforeEach(async () => {
      task = await createTask()
      await approveByHead(task.id, 4)
      // HR sends it back.
      await taskMutationService.updateTask(task.id, {
        status: "NOT APPROVED",
        hrVerified: false,
        hrRemarks: "Missing the receipt",
        editedBy: hr.id,
      })
    })

    it("puts the task back in the employee's hands", async () => {
      await taskMutationService.updateTask(task.id, {
        status: "INCOMPLETE",
        editedBy: employee.id,
      })

      expect((await readTask(task.id)).status).toBe("INCOMPLETE")
    })

    it("clears the stale grade and evaluator so it is re-graded from scratch", async () => {
      await taskMutationService.updateTask(task.id, {
        status: "INCOMPLETE",
        editedBy: employee.id,
      })

      expect(await readTask(task.id)).toMatchObject({
        grade: 0,
        evaluated_by: null,
        evaluated_at: null,
      })
    })

    it("clears the rejection remarks the employee has now acted on", async () => {
      await taskMutationService.updateTask(task.id, {
        status: "INCOMPLETE",
        editedBy: employee.id,
      })

      expect(await readTask(task.id)).toMatchObject({ hr_remarks: "", remarks: "" })
    })

    it("tells the head the task is back for re-evaluation", async () => {
      await taskMutationService.updateTask(task.id, {
        status: "INCOMPLETE",
        editedBy: employee.id,
      })
      await waitForNetworkIdle()

      const resubmitted = db.rows("notifications").filter((n) => n.title === "Task Resubmitted for Review")
      expect(resubmitted).toHaveLength(1)
    })

    it("calls the second submission a resubmission on the timeline", async () => {
      await taskMutationService.updateTask(task.id, {
        status: "INCOMPLETE",
        editedBy: employee.id,
      })
      await waitForNetworkIdle()

      await taskMutationService.updateTask(task.id, {
        status: "AWAITING APPROVAL",
        editedBy: employee.id,
      })
      await waitForNetworkIdle()

      const contents = db.rows("task_activity").map((a) => a.content)
      expect(contents).toContain("Ana Reyes resubmitted task for review.")
    })
  })

  describe("deleting a task", () => {
    it("keeps the row and marks it deleted", async () => {
      const task = await createTask()

      await taskMutationService.deleteTask(task.id, employee.id)

      expect((await readTask(task.id)).status).toBe("DELETED")
    })

    it("refuses to let one employee delete another's task", async () => {
      const other = makeEmployee({ name: "Ben Cruz" })
      const task = await createTask()

      await expect(taskMutationService.deleteTask(task.id, other.id)).rejects.toThrow(
        "Unauthorized to delete this task",
      )
    })

    it("lets a head delete someone else's task", async () => {
      const task = await createTask()

      await expect(taskMutationService.deleteTask(task.id, head.id)).resolves.toBe(true)
    })

    it("protects an HR-verified task from everyone but a super admin", async () => {
      const task = await createTask()
      await approveByHead(task.id)
      await taskMutationService.updateTask(task.id, { hrVerified: true, editedBy: hr.id })

      await expect(taskMutationService.deleteTask(task.id, hr.id)).rejects.toThrow(
        "Cannot delete tasks that are already verified by HR.",
      )
    })

    it("lets a super admin delete an HR-verified task", async () => {
      const superAdmin = makeSuperAdmin({ name: "Boss" })
      const task = await createTask()
      await approveByHead(task.id)
      await taskMutationService.updateTask(task.id, { hrVerified: true, editedBy: hr.id })

      await expect(taskMutationService.deleteTask(task.id, superAdmin.id)).resolves.toBe(true)
    })

    it("keeps the attachments for the audit trail", async () => {
      const task = await createTask({ attachments: ["https://x.test/receipt.png"] })

      await taskMutationService.deleteTask(task.id, employee.id)

      expect((await readTask(task.id)).attachment_urls).toEqual(["https://x.test/receipt.png"])
    })
  })

  describe("bulk approval", () => {
    it("grades every selected task", async () => {
      const first = await createTask()
      const second = await createTask()

      await taskMutationService.bulkApproveTasks([first.id, second.id], head.id, 4, "Bulk ok")

      expect(await readTask(first.id)).toMatchObject({ status: "COMPLETED", grade: 4 })
      expect(await readTask(second.id)).toMatchObject({ status: "COMPLETED", grade: 4 })
    })

    it("refuses an employee who is neither head nor super admin", async () => {
      const task = await createTask()

      await expect(
        taskMutationService.bulkApproveTasks([task.id], employee.id),
      ).rejects.toThrow(/Only Admins\/Heads can bulk approve/i)

      expect((await readTask(task.id)).status).toBe("INCOMPLETE")
    })

    it("does nothing for an empty selection", async () => {
      await expect(taskMutationService.bulkApproveTasks([], head.id)).resolves.toBeUndefined()
    })
  })

  describe("bulk rejection", () => {
    it("sends every selected task back with a zero grade", async () => {
      const task = await createTask()

      await taskMutationService.bulkDeclineTasks([task.id], head.id, "Insufficient detail")

      expect(await readTask(task.id)).toMatchObject({
        status: "NOT APPROVED",
        grade: 0,
        remarks: "Insufficient detail",
        evaluated_by: head.id,
      })
    })

    it("refuses an employee who is neither head nor super admin", async () => {
      const task = await createTask()

      await expect(
        taskMutationService.bulkDeclineTasks([task.id], employee.id),
      ).rejects.toThrow(/Only Admins\/Heads can bulk reject/i)
    })
  })

  describe("bulk HR verification", () => {
    it("verifies the tasks that are eligible", async () => {
      const task = await createTask()
      await approveByHead(task.id)

      await taskMutationService.bulkVerifyTasks([task.id], hr.id)

      expect((await readTask(task.id)).hr_verified).toBe(true)
    })

    it("refuses when nothing in the selection is eligible", async () => {
      const ungraded = await createTask()

      await expect(taskMutationService.bulkVerifyTasks([ungraded.id], hr.id)).rejects.toThrow(
        /None of the selected tasks are eligible/,
      )
    })

    it("verifies only the eligible tasks in a mixed selection", async () => {
      const graded = await createTask()
      await approveByHead(graded.id)
      const ungraded = await createTask()

      await taskMutationService.bulkVerifyTasks([graded.id, ungraded.id], hr.id)

      expect((await readTask(graded.id)).hr_verified).toBe(true)
      expect((await readTask(ungraded.id)).hr_verified).toBe(false)
    })

    it("refuses anyone who is neither HR nor super admin", async () => {
      const task = await createTask()
      await approveByHead(task.id)

      await expect(taskMutationService.bulkVerifyTasks([task.id], head.id)).rejects.toThrow(
        /Only HR\/Admins can bulk verify/i,
      )
    })

    it("lets HR undo a bulk verification", async () => {
      const task = await createTask()
      await approveByHead(task.id)
      await taskMutationService.bulkVerifyTasks([task.id], hr.id)

      await taskMutationService.bulkUnverifyTasks([task.id], hr.id)

      expect(await readTask(task.id)).toMatchObject({
        hr_verified: false,
        hr_verified_at: null,
        hr_remarks: "",
      })
    })
  })

  describe("what the task list shows afterwards", () => {
    it("surfaces a freshly created task", async () => {
      const created = await createTask()

      const tasks = await taskQueryService.getAllTasks()

      expect(tasks.map((t) => t.id)).toContain(created.id)
    })

    it("drops a deleted task out of the list", async () => {
      const created = await createTask()
      await taskMutationService.deleteTask(created.id, employee.id)

      const tasks = await taskQueryService.getAllTasks()

      expect(tasks.map((t) => t.id)).not.toContain(created.id)
    })
  })
})
