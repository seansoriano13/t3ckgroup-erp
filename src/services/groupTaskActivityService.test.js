import { beforeEach, describe, expect, it } from "vitest"
import { groupTaskActivityService } from "./groupTaskActivityService"
import { makeGroupTask, makeEmployee, makeHead, makeHrEmployee } from "@/test/factories"

/**
 * The group equivalent of the task timeline. It feeds the same super-admin
 * activity screen, so it has to produce the same shape and honour the same
 * filters.
 */
describe("groupTaskActivityService", () => {
  let author
  let task

  beforeEach(() => {
    author = makeEmployee({ name: "Alice Santos" })
    task = makeGroupTask({ title: "Year-end inventory", created_by: makeHead().id })
  })

  it("adds a comment attributed to its author", async () => {
    await groupTaskActivityService.addComment(task.id, author.id, "Aisle A is counted")

    const [entry] = await groupTaskActivityService.getActivityForTask(task.id)
    expect(entry).toMatchObject({
      type: "COMMENT",
      content: "Aisle A is counted",
      authorName: "Alice Santos",
    })
  })

  it("accepts a comment that is only an attachment", async () => {
    await groupTaskActivityService.addComment(task.id, author.id, "", {
      attachments: [{ url: "https://res.cloudinary.test/count.pdf" }],
    })

    expect(await groupTaskActivityService.getActivityForTask(task.id)).toHaveLength(1)
  })

  it("refuses a comment with neither text nor attachment", async () => {
    expect(await groupTaskActivityService.addComment(task.id, author.id, "  ")).toBeNull()
  })

  it("does nothing without a task or an author", async () => {
    expect(await groupTaskActivityService.addComment(null, author.id, "Hi")).toBeNull()
    expect(await groupTaskActivityService.addComment(task.id, null, "Hi")).toBeNull()
  })

  it("records an unattributed system entry", async () => {
    await groupTaskActivityService.addSystemEvent(task.id, "Group task created", {
      event: "CREATED",
    })

    const [entry] = await groupTaskActivityService.getActivityForTask(task.id)
    expect(entry).toMatchObject({ type: "SYSTEM", authorId: null })
  })

  it("records an approval and an HR note against their authors", async () => {
    const head = makeHead({ name: "Head Ito" })
    const hr = makeHrEmployee({ name: "HR Officer" })

    await groupTaskActivityService.addApprovalEntry(task.id, head.id, "Members graded")
    await groupTaskActivityService.addHrEntry(task.id, hr.id, "Counts verified")

    const timeline = await groupTaskActivityService.getActivityForTask(task.id)
    expect(timeline.map((e) => [e.type, e.authorName])).toEqual([
      ["APPROVAL", "Head Ito"],
      ["HR_NOTE", "HR Officer"],
    ])
  })

  it("returns an empty timeline for no task", async () => {
    expect(await groupTaskActivityService.getActivityForTask(null)).toEqual([])
  })

  describe("the cross-task feed", () => {
    it("joins each entry to its group task", async () => {
      await groupTaskActivityService.addComment(task.id, author.id, "Aisle A is counted")

      const [entry] = await groupTaskActivityService.getRecentGroupActivity()

      expect(entry).toMatchObject({
        taskId: task.id,
        taskDescription: "Year-end inventory",
        authorName: "Alice Santos",
      })
    })

    it("returns the newest entry first", async () => {
      await groupTaskActivityService.addComment(task.id, author.id, "First")
      await groupTaskActivityService.addComment(task.id, author.id, "Second")

      const feed = await groupTaskActivityService.getRecentGroupActivity()

      expect(feed.map((e) => e.content)).toEqual(["Second", "First"])
    })

    it("filters by entry type and by author", async () => {
      await groupTaskActivityService.addComment(task.id, author.id, "A comment")
      await groupTaskActivityService.addSystemEvent(task.id, "A system event")

      const comments = await groupTaskActivityService.getRecentGroupActivity({
        type: "COMMENT",
      })
      const systemOnly = await groupTaskActivityService.getRecentGroupActivity({
        authorId: "SYSTEM",
      })

      expect(comments.map((e) => e.content)).toEqual(["A comment"])
      expect(systemOnly.map((e) => e.content)).toEqual(["A system event"])
    })

    it("searches entry text", async () => {
      await groupTaskActivityService.addComment(task.id, author.id, "Escalated to purchasing")
      await groupTaskActivityService.addComment(task.id, author.id, "Nothing to report")

      const found = await groupTaskActivityService.getRecentGroupActivity({
        search: "escalated",
      })

      expect(found.map((e) => e.content)).toEqual(["Escalated to purchasing"])
    })
  })
})
