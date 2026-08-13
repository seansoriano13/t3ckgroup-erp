import { beforeEach, describe, expect, it } from "vitest"
import { taskActivityService } from "./taskActivityService"
import { db } from "@/test/db/store"
import { makeCategory, makeEmployee, makeHead, makeTask } from "@/test/factories"

/**
 * The activity timeline is the record of who said and did what on a task. It
 * has to stay readable when the same action repeats: `upsertActivityEntry`
 * folds a repeated event into the existing entry instead of stacking
 * near-identical rows.
 */
describe("taskActivityService", () => {
  let author
  let head
  let task

  beforeEach(() => {
    author = makeEmployee({ name: "Ana Reyes" })
    head = makeHead({ name: "Head Ito" })
    task = makeTask({ logged_by: author.id, category_id: makeCategory().category_id })
  })

  describe("comments", () => {
    it("adds a comment attributed to its author", async () => {
      await taskActivityService.addComment(task.id, author.id, "Waiting on the supplier")

      const timeline = await taskActivityService.getActivityForTask(task.id)
      expect(timeline).toHaveLength(1)
      expect(timeline[0]).toMatchObject({
        type: "COMMENT",
        content: "Waiting on the supplier",
        authorName: "Ana Reyes",
      })
    })

    it("accepts a comment that is only an attachment", async () => {
      await taskActivityService.addComment(task.id, author.id, "", {
        attachments: [{ url: "https://res.cloudinary.test/photo.png" }],
      })

      expect(await taskActivityService.getActivityForTask(task.id)).toHaveLength(1)
    })

    it("refuses a comment with neither text nor attachment", async () => {
      expect(await taskActivityService.addComment(task.id, author.id, "   ")).toBeNull()
      expect(await taskActivityService.getActivityForTask(task.id)).toEqual([])
    })

    it("does nothing without a task or an author", async () => {
      expect(await taskActivityService.addComment(null, author.id, "Hi")).toBeNull()
      expect(await taskActivityService.addComment(task.id, null, "Hi")).toBeNull()
    })

    it("reads the timeline oldest first", async () => {
      await taskActivityService.addComment(task.id, author.id, "First")
      await taskActivityService.addComment(task.id, head.id, "Second")

      const timeline = await taskActivityService.getActivityForTask(task.id)

      expect(timeline.map((e) => e.content)).toEqual(["First", "Second"])
    })

    it("returns an empty timeline for no task", async () => {
      expect(await taskActivityService.getActivityForTask(null)).toEqual([])
    })
  })

  describe("system events", () => {
    it("records an unattributed system entry", async () => {
      await taskActivityService.addSystemEvent(task.id, "Task submitted for review", {
        event: "STATUS_CHANGE",
      })

      const [entry] = await taskActivityService.getActivityForTask(task.id)
      expect(entry).toMatchObject({ type: "SYSTEM", authorId: null })
      expect(entry.metadata.event).toBe("STATUS_CHANGE")
    })

    it("does nothing without a task", async () => {
      await expect(taskActivityService.addSystemEvent(null, "x")).resolves.toBeUndefined()
    })
  })

  describe("approval and HR entries", () => {
    it("records an approval against the head who made it", async () => {
      await taskActivityService.addApprovalEntry(task.id, head.id, "Approved — good work", {
        grade: 5,
      })

      const [entry] = await taskActivityService.getActivityForTask(task.id)
      expect(entry).toMatchObject({ type: "APPROVAL", authorName: "Head Ito" })
    })

    it("records an HR note", async () => {
      const hr = makeEmployee({ name: "HR Officer", is_hr: true })

      await taskActivityService.addHrEntry(task.id, hr.id, "Verified against the payroll run")

      const [entry] = await taskActivityService.getActivityForTask(task.id)
      expect(entry).toMatchObject({ type: "HR_NOTE", authorName: "HR Officer" })
    })
  })

  describe("folding repeated events", () => {
    it("keeps one entry when the same event repeats inside the window", async () => {
      await taskActivityService.upsertActivityEntry(
        task.id,
        head.id,
        "APPROVAL",
        "GRADE_UPDATED",
        "Head Ito updated the grade to 3.",
        { event: "GRADE_UPDATED", grade: 3 },
      )
      await taskActivityService.upsertActivityEntry(
        task.id,
        head.id,
        "APPROVAL",
        "GRADE_UPDATED",
        "Head Ito updated the grade to 5.",
        { event: "GRADE_UPDATED", grade: 5 },
      )

      const timeline = await taskActivityService.getActivityForTask(task.id)
      expect(timeline).toHaveLength(1)
      expect(timeline[0].content).toBe("Head Ito updated the grade to 5.")
    })

    it("starts a new entry once the window has passed", async () => {
      // windowMs=0 means "always expired": the service compares the stored
      // entry's created_at against a fresh real-clock read on the SECOND
      // call. The fake store's created_at is a seeded counter, not a live
      // clock, so on a fast runner real time can fail to advance even 1ms
      // between the two calls — letting the counter tie or outrun the real
      // clock and wrongly fold the second call into the first. Backdating the
      // store's clock before the first call removes the race entirely: the
      // first entry's created_at is unambiguously in the past, so "now minus
      // logTime" is seconds, never a coin flip on microseconds.
      db.setClock("2020-01-01T00:00:00.000Z")

      await taskActivityService.upsertActivityEntry(
        task.id,
        head.id,
        "APPROVAL",
        "GRADE_UPDATED",
        "Grade set to 3.",
        { event: "GRADE_UPDATED" },
        0,
      )
      await taskActivityService.upsertActivityEntry(
        task.id,
        head.id,
        "APPROVAL",
        "GRADE_UPDATED",
        "Grade set to 5.",
        { event: "GRADE_UPDATED" },
        0,
      )

      expect(await taskActivityService.getActivityForTask(task.id)).toHaveLength(2)
    })

    it("keeps a different author's entry separate", async () => {
      const otherHead = makeHead({ name: "Other Head" })

      await taskActivityService.upsertActivityEntry(
        task.id,
        head.id,
        "APPROVAL",
        "APPROVED",
        "Approved by Head Ito",
        { event: "APPROVED" },
      )
      await taskActivityService.upsertActivityEntry(
        task.id,
        otherHead.id,
        "APPROVAL",
        "APPROVED",
        "Approved by Other Head",
        { event: "APPROVED" },
      )

      expect(await taskActivityService.getActivityForTask(task.id)).toHaveLength(2)
    })

    it("keeps a different event separate", async () => {
      await taskActivityService.upsertActivityEntry(
        task.id,
        head.id,
        "APPROVAL",
        "APPROVED",
        "Approved",
        { event: "APPROVED" },
      )
      await taskActivityService.upsertActivityEntry(
        task.id,
        head.id,
        "APPROVAL",
        "REJECTED",
        "Rejected",
        { event: "REJECTED" },
      )

      expect(await taskActivityService.getActivityForTask(task.id)).toHaveLength(2)
    })
  })

  describe("the cross-task activity feed", () => {
    it("joins each entry to its task and author", async () => {
      await taskActivityService.addComment(task.id, author.id, "Waiting on the supplier")

      const [entry] = await taskActivityService.getRecentTaskActivity()

      expect(entry).toMatchObject({
        taskId: task.id,
        taskDescription: task.task_description,
        taskStatus: "INCOMPLETE",
        authorName: "Ana Reyes",
        content: "Waiting on the supplier",
      })
    })

    it("returns the newest entry first", async () => {
      await taskActivityService.addComment(task.id, author.id, "First")
      await taskActivityService.addComment(task.id, author.id, "Second")

      const feed = await taskActivityService.getRecentTaskActivity()

      expect(feed.map((e) => e.content)).toEqual(["Second", "First"])
    })

    it("filters by entry type", async () => {
      await taskActivityService.addComment(task.id, author.id, "A comment")
      await taskActivityService.addSystemEvent(task.id, "A system event")

      const comments = await taskActivityService.getRecentTaskActivity({ type: "COMMENT" })

      expect(comments.map((e) => e.content)).toEqual(["A comment"])
    })

    it("filters to system-generated entries", async () => {
      await taskActivityService.addComment(task.id, author.id, "A comment")
      await taskActivityService.addSystemEvent(task.id, "A system event")

      const systemOnly = await taskActivityService.getRecentTaskActivity({ authorId: "SYSTEM" })

      expect(systemOnly.map((e) => e.content)).toEqual(["A system event"])
    })

    it("filters by author", async () => {
      await taskActivityService.addComment(task.id, author.id, "From Ana")
      await taskActivityService.addComment(task.id, head.id, "From the head")

      const byHead = await taskActivityService.getRecentTaskActivity({ authorId: head.id })

      expect(byHead.map((e) => e.content)).toEqual(["From the head"])
    })

    it("finds entries whose task description matches the search", async () => {
      const other = makeTask({
        logged_by: author.id,
        category_id: makeCategory().category_id,
        task_description: "Fix the projector",
      })
      await taskActivityService.addComment(task.id, author.id, "Unrelated note")
      await taskActivityService.addComment(other.id, author.id, "Also unrelated")

      const found = await taskActivityService.getRecentTaskActivity({ search: "projector" })

      expect(found.map((e) => e.taskId)).toEqual([other.id])
    })

    it("finds entries whose own content matches the search", async () => {
      await taskActivityService.addComment(task.id, author.id, "Escalated to the supplier")
      await taskActivityService.addComment(task.id, author.id, "Nothing to report")

      const found = await taskActivityService.getRecentTaskActivity({ search: "escalated" })

      expect(found.map((e) => e.content)).toEqual(["Escalated to the supplier"])
    })

    it("caps the page size at 200 however large a limit is asked for", async () => {
      await taskActivityService.addComment(task.id, author.id, "One")

      await expect(
        taskActivityService.getRecentTaskActivity({ limit: 10000 }),
      ).resolves.toHaveLength(1)
    })

    it("pages with an offset", async () => {
      await taskActivityService.addComment(task.id, author.id, "First")
      await taskActivityService.addComment(task.id, author.id, "Second")

      const page = await taskActivityService.getRecentTaskActivity({ limit: 1, offset: 1 })

      expect(page.map((e) => e.content)).toEqual(["First"])
    })
  })
})
