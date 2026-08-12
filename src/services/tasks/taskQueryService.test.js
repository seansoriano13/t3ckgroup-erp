import { beforeEach, describe, expect, it } from "vitest"
import { taskQueryService } from "./taskQueryService"
import { db } from "@/test/db/store"
import { makeCategory, makeEmployee, makeHead, makeTask } from "@/test/factories"

/**
 * The read side maps snake_case rows onto the camelCase shape every screen
 * consumes, and joins in four different people (author, editor, evaluator,
 * reported-to head). A wrong join here puts someone else's name against an
 * employee's work, so the tests check the mapped output, not the raw row.
 */
describe("taskQueryService", () => {
  let author
  let head
  let category

  beforeEach(() => {
    author = makeEmployee({
      name: "Ana Reyes",
      email: "ana@t3ckgroup.test",
      department: "IT",
      avatar_path: "ana.png",
    })
    head = makeHead({ name: "Head Ito", department: "IT", avatar_path: "head.png" })
    category = makeCategory({ category_id: "IT-01", description: "Support" })
  })

  describe("getAllTasks", () => {
    it("maps a row onto the shape the UI expects", async () => {
      makeTask({
        logged_by: author.id,
        category_id: category.category_id,
        task_description: "Replace the switch",
        project_title: "Network refresh",
        priority: "HIGH",
        status: "INCOMPLETE",
        reported_to: head.id,
      })

      const [task] = await taskQueryService.getAllTasks()

      expect(task).toMatchObject({
        taskDescription: "Replace the switch",
        projectTitle: "Network refresh",
        categoryId: "IT-01",
        categoryDesc: "Support",
        loggedById: author.id,
        loggedByName: "Ana Reyes",
        loggedByEmail: "ana@t3ckgroup.test",
        reportedTo: head.id,
        reportedToName: "Head Ito",
        priority: "HIGH",
        status: "INCOMPLETE",
      })
    })

    it("hides deleted tasks", async () => {
      makeTask({ logged_by: author.id, category_id: category.category_id, status: "DELETED" })
      const live = makeTask({ logged_by: author.id, category_id: category.category_id })

      const tasks = await taskQueryService.getAllTasks()

      expect(tasks.map((t) => t.id)).toEqual([live.id])
    })

    it("returns the newest task first", async () => {
      const older = makeTask({ logged_by: author.id, category_id: category.category_id })
      const newer = makeTask({ logged_by: author.id, category_id: category.category_id })

      const tasks = await taskQueryService.getAllTasks()

      expect(tasks.map((t) => t.id)).toEqual([newer.id, older.id])
    })

    it("pages through the list when a range is given", async () => {
      makeTask({ logged_by: author.id, category_id: category.category_id })
      makeTask({ logged_by: author.id, category_id: category.category_id })
      makeTask({ logged_by: author.id, category_id: category.category_id })

      const page = await taskQueryService.getAllTasks({ from: 1, to: 2 })

      expect(page).toHaveLength(2)
    })

    it("ignores a nonsensical range instead of returning nothing", async () => {
      makeTask({ logged_by: author.id, category_id: category.category_id })

      expect(await taskQueryService.getAllTasks({ from: 5, to: 1 })).toHaveLength(1)
      expect(await taskQueryService.getAllTasks({ from: -1, to: 3 })).toHaveLength(1)
    })

    it("substitutes empty values for the fields a fresh task has not filled in", async () => {
      makeTask({
        logged_by: author.id,
        category_id: category.category_id,
        remarks: null,
        hr_remarks: null,
        grade: null,
        attachment_urls: null,
        payment_voucher: null,
      })

      const [task] = await taskQueryService.getAllTasks()

      expect(task).toMatchObject({
        remarks: "",
        hrRemarks: "",
        grade: 0,
        attachments: [],
        paymentVoucher: "",
      })
    })

    it("leaves the editor and evaluator empty until someone acts", async () => {
      makeTask({ logged_by: author.id, category_id: category.category_id })

      const [task] = await taskQueryService.getAllTasks()

      expect(task).toMatchObject({
        editedById: null,
        editedByName: null,
        evaluatedById: null,
        evaluatedByName: null,
      })
    })

    it("names the head who graded the task, distinctly from its author", async () => {
      makeTask({
        logged_by: author.id,
        category_id: category.category_id,
        evaluated_by: head.id,
        edited_by: head.id,
        status: "COMPLETED",
        grade: 4,
      })

      const [task] = await taskQueryService.getAllTasks()

      expect(task).toMatchObject({
        loggedByName: "Ana Reyes",
        evaluatedByName: "Head Ito",
        editedByName: "Head Ito",
        grade: 4,
      })
    })
  })

  describe("getMyTasks", () => {
    it("returns only the tasks the employee logged", async () => {
      const colleague = makeEmployee({ name: "Ben Cruz" })
      const mine = makeTask({ logged_by: author.id, category_id: category.category_id })
      makeTask({ logged_by: colleague.id, category_id: category.category_id })

      const tasks = await taskQueryService.getMyTasks(author.id)

      expect(tasks.map((t) => t.id)).toEqual([mine.id])
    })

    it("hides the employee's own deleted tasks", async () => {
      makeTask({ logged_by: author.id, category_id: category.category_id, status: "DELETED" })

      expect(await taskQueryService.getMyTasks(author.id)).toEqual([])
    })
  })

  describe("getTaskById", () => {
    it("returns the task with its joined people", async () => {
      const task = makeTask({
        logged_by: author.id,
        category_id: category.category_id,
        reported_to: head.id,
      })

      const found = await taskQueryService.getTaskById(task.id)

      expect(found).toMatchObject({
        id: task.id,
        loggedByName: "Ana Reyes",
        reportedToName: "Head Ito",
        categoryDesc: "Support",
      })
    })

    it("credits the administrator who logged a task on the employee's behalf", async () => {
      const task = makeTask({ logged_by: author.id, category_id: category.category_id })
      db.seed("task_activity", {
        task_id: task.id,
        type: "SYSTEM",
        content: "Task submitted by HR Officer.",
        metadata: { event: "TASK_CREATED", submittedByName: "HR Officer" },
      })

      const found = await taskQueryService.getTaskById(task.id)

      expect(found.submittedByName).toBe("HR Officer")
    })

    it("reads the submitter out of the log text when the metadata predates that field", async () => {
      const task = makeTask({ logged_by: author.id, category_id: category.category_id })
      db.seed("task_activity", {
        task_id: task.id,
        type: "SYSTEM",
        content: "Task submitted by HR Officer. Reported to: Head Ito.",
        metadata: { event: "TASK_CREATED" },
      })

      const found = await taskQueryService.getTaskById(task.id)

      expect(found.submittedByName).toBe("HR Officer")
    })

    it("falls back to the author when there is no creation log at all", async () => {
      const task = makeTask({ logged_by: author.id, category_id: category.category_id })

      const found = await taskQueryService.getTaskById(task.id)

      expect(found.submittedByName).toBe("Ana Reyes")
    })

    it("raises for a task that does not exist", async () => {
      await expect(taskQueryService.getTaskById("00000000-0000-4000-8000-000000009999"))
        .rejects.toMatchObject({ code: "PGRST116" })
    })
  })

  describe("getManagerRepliesForTasks", () => {
    it("reports which of the given tasks the manager has replied on", async () => {
      const replied = makeTask({ logged_by: author.id, category_id: category.category_id })
      const silent = makeTask({ logged_by: author.id, category_id: category.category_id })
      db.seed("task_activity", {
        task_id: replied.id,
        author_id: head.id,
        type: "COMMENT",
        content: "Please add the serial number",
      })

      const withReplies = await taskQueryService.getManagerRepliesForTasks(
        [replied.id, silent.id],
        head.id,
      )

      expect([...withReplies]).toEqual([replied.id])
    })

    it("ignores replies written by somebody else", async () => {
      const task = makeTask({ logged_by: author.id, category_id: category.category_id })
      db.seed("task_activity", {
        task_id: task.id,
        author_id: author.id,
        type: "COMMENT",
        content: "Done",
      })

      const withReplies = await taskQueryService.getManagerRepliesForTasks([task.id], head.id)

      expect(withReplies.size).toBe(0)
    })

    it("short-circuits on an empty selection", async () => {
      expect((await taskQueryService.getManagerRepliesForTasks([], head.id)).size).toBe(0)
      expect((await taskQueryService.getManagerRepliesForTasks(["x"], null)).size).toBe(0)
    })
  })
})
