import { beforeEach, describe, expect, it } from "vitest"
import { taskQueryService } from "./taskQueryService"
import { db } from "@/test/db/store"
import { makeCategory, makeEmployee, makeGroupTask, makeHead, makeOpportunity, makeTask } from "@/test/factories"

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

  describe("getMyOpenTasksForOpportunity", () => {
    it("returns every open task tied to the deal, the viewer's own first", async () => {
      const opportunity = makeOpportunity({ registered_by: author.id })
      const otherOpportunity = makeOpportunity({ registered_by: author.id })
      const colleague = makeEmployee({ name: "Ben Cruz" })
      const mine = makeTask({
        logged_by: author.id,
        category_id: category.category_id,
        opportunity_id: opportunity.id,
        status: "INCOMPLETE",
      })
      // A colleague's task on the same deal is listed too, after the viewer's own.
      const theirs = makeTask({
        logged_by: colleague.id,
        category_id: category.category_id,
        opportunity_id: opportunity.id,
        created_at: "2030-01-01T00:00:00.000Z",
      })
      // The same employee's task on a different deal isn't this deal's.
      makeTask({ logged_by: author.id, category_id: category.category_id, opportunity_id: otherOpportunity.id })
      // Finished work no longer needs acting on.
      makeTask({
        logged_by: author.id,
        category_id: category.category_id,
        opportunity_id: opportunity.id,
        status: "COMPLETED",
      })

      const tasks = await taskQueryService.getMyOpenTasksForOpportunity(author.id, opportunity.id)

      expect(tasks.map((t) => t.id)).toEqual([mine.id, theirs.id])
      expect(tasks.map((t) => t.mine)).toEqual([true, false])
    })

    it("includes a task awaiting approval, not only incomplete ones", async () => {
      const opportunity = makeOpportunity({ registered_by: author.id })
      const awaiting = makeTask({
        logged_by: author.id,
        category_id: category.category_id,
        opportunity_id: opportunity.id,
        status: "AWAITING APPROVAL",
      })

      const tasks = await taskQueryService.getMyOpenTasksForOpportunity(author.id, opportunity.id)

      expect(tasks.map((t) => t.id)).toEqual([awaiting.id])
    })

    it("includes an open Group Task this employee is a member of, marked as a group", async () => {
      const opportunity = makeOpportunity({ registered_by: author.id })
      const colleague = makeEmployee({ name: "Ben Cruz" })
      const mine = makeGroupTask({ created_by: colleague.id, opportunity_id: opportunity.id, title: "Bid pack" })
      db.seed("committee_task_members", {
        committee_task_id: mine.id,
        employee_id: author.id,
        status: "PENDING",
        task_description: "Assemble the bid",
      })
      // Someone else's group task on the same deal is listed, but not marked as the viewer's.
      const theirs = makeGroupTask({ created_by: colleague.id, opportunity_id: opportunity.id })
      db.seed("committee_task_members", { committee_task_id: theirs.id, employee_id: colleague.id, status: "PENDING", task_description: "" })
      // A member who already finished has nothing left to do.
      const done = makeGroupTask({ created_by: colleague.id, opportunity_id: opportunity.id })
      db.seed("committee_task_members", { committee_task_id: done.id, employee_id: author.id, status: "DONE", task_description: "" })
      // A group task that has itself closed is no longer open.
      const closed = makeGroupTask({ created_by: colleague.id, opportunity_id: opportunity.id, status: "COMPLETED" })
      db.seed("committee_task_members", { committee_task_id: closed.id, employee_id: author.id, status: "PENDING", task_description: "" })

      const tasks = await taskQueryService.getMyOpenTasksForOpportunity(author.id, opportunity.id)

      // The group's title heads the row; the line under it is what this member owes.
      expect(tasks).toEqual([
        expect.objectContaining({ id: mine.id, kind: "group", mine: true, title: "Bid pack", taskDescription: "Assemble the bid" }),
        expect.objectContaining({ id: done.id, kind: "group", mine: false }),
        expect.objectContaining({ id: theirs.id, kind: "group", mine: false }),
      ])
    })

    it("carries what a row needs to read as an obligation: title, due date, checklist progress", async () => {
      const opportunity = makeOpportunity({ registered_by: author.id })
      makeTask({
        logged_by: author.id,
        category_id: category.category_id,
        opportunity_id: opportunity.id,
        project_title: "Technical review — S99002",
        task_description: "Check the specifications",
        checklist: [{ text: "Read the spec", checked: true }, { text: "Note gaps", checked: false }],
        end_at: "2026-09-24T03:21:00.000Z",
        priority: "HIGH",
      })

      const [task] = await taskQueryService.getMyOpenTasksForOpportunity(author.id, opportunity.id)

      expect(task).toMatchObject({
        kind: "task",
        title: "Technical review — S99002",
        taskDescription: "Check the specifications",
        dueAt: "2026-09-24T03:21:00.000Z",
        priority: "HIGH",
        checklistProgress: { total: 2, checked: 1 },
      })
    })

    it("has no checklist progress for a task without a checklist", async () => {
      const opportunity = makeOpportunity({ registered_by: author.id })
      makeTask({ logged_by: author.id, category_id: category.category_id, opportunity_id: opportunity.id, checklist: null })

      const [task] = await taskQueryService.getMyOpenTasksForOpportunity(author.id, opportunity.id)

      expect(task.checklistProgress).toBeNull()
    })

    it("orders what is owed by due date — overdue first, undated last — across both kinds", async () => {
      const opportunity = makeOpportunity({ registered_by: author.id })
      const undated = makeTask({
        logged_by: author.id, category_id: category.category_id, opportunity_id: opportunity.id, end_at: null,
      })
      const later = makeTask({
        logged_by: author.id, category_id: category.category_id, opportunity_id: opportunity.id, end_at: "2030-01-10T00:00:00.000Z",
      })
      const overdueGroup = makeGroupTask({ opportunity_id: opportunity.id, due_date: "2020-01-01T00:00:00.000Z" })
      db.seed("committee_task_members", {
        committee_task_id: overdueGroup.id, employee_id: author.id, status: "PENDING", task_description: "",
      })

      const tasks = await taskQueryService.getMyOpenTasksForOpportunity(author.id, opportunity.id)

      expect(tasks.map((t) => t.id)).toEqual([overdueGroup.id, later.id, undated.id])
    })

    it("lists an individual task and a Group Task together", async () => {
      const opportunity = makeOpportunity({ registered_by: author.id })
      const individual = makeTask({
        logged_by: author.id,
        category_id: category.category_id,
        opportunity_id: opportunity.id,
      })
      const group = makeGroupTask({ opportunity_id: opportunity.id })
      db.seed("committee_task_members", { committee_task_id: group.id, employee_id: author.id, status: "PENDING", task_description: "" })

      const tasks = await taskQueryService.getMyOpenTasksForOpportunity(author.id, opportunity.id)

      expect(tasks.map((t) => [t.id, t.kind]).sort()).toEqual(
        [[individual.id, "task"], [group.id, "group"]].sort(),
      )
    })

    it("asks for nothing without both a viewer and a deal", async () => {
      expect(await taskQueryService.getMyOpenTasksForOpportunity(null, "opp-1")).toEqual([])
      expect(await taskQueryService.getMyOpenTasksForOpportunity(author.id, null)).toEqual([])
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
        .rejects.toThrow("Task not found")
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
