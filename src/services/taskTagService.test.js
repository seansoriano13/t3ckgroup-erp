import { beforeEach, describe, expect, it } from "vitest"
import { taskTagService } from "./taskTagService"
import { makeEmployee } from "@/test/factories"

/**
 * The single managed vocabulary for Group Task tags (issue #205). Names are
 * unique case-insensitively among active tags only, so retiring a name frees
 * it up again without touching the archived tag's history.
 */
describe("taskTagService", () => {
  let admin

  beforeEach(() => {
    admin = makeEmployee({ name: "Admin Ana", is_super_admin: true })
  })

  it("creates a tag", async () => {
    const tag = await taskTagService.create({ name: "Bidding", color: "blue", createdBy: admin.id })

    expect(tag.name).toBe("Bidding")
    expect(tag.color).toBe("blue")
    expect(tag.archived_at).toBeNull()
  })

  it("lists only active tags by default", async () => {
    const active = await taskTagService.create({ name: "Bidding", color: "blue", createdBy: admin.id })
    const archived = await taskTagService.create({ name: "Old Committee", color: "green", createdBy: admin.id })
    await taskTagService.archive(archived.id)

    const rows = await taskTagService.list()
    expect(rows.map((r) => r.id)).toEqual([active.id])
  })

  it("includes archived tags when asked", async () => {
    const tag = await taskTagService.create({ name: "Bidding", color: "blue", createdBy: admin.id })
    await taskTagService.archive(tag.id)

    const rows = await taskTagService.list({ includeArchived: true })
    expect(rows).toHaveLength(1)
    expect(rows[0].archived_at).not.toBeNull()
  })

  it("refuses a duplicate name among active tags", async () => {
    await taskTagService.create({ name: "Bidding", color: "blue", createdBy: admin.id })

    await expect(
      taskTagService.create({ name: "bidding", color: "amber", createdBy: admin.id }),
    ).rejects.toThrow()
  })

  it("lets a retired name be reused", async () => {
    const first = await taskTagService.create({ name: "Bidding", color: "blue", createdBy: admin.id })
    await taskTagService.archive(first.id)

    const second = await taskTagService.create({ name: "Bidding", color: "amber", createdBy: admin.id })
    expect(second.name).toBe("Bidding")
  })

  it("renames and recolors a tag", async () => {
    const tag = await taskTagService.create({ name: "Bidding", color: "blue", createdBy: admin.id })

    await taskTagService.rename(tag.id, "Bid Docs")
    const recolored = await taskTagService.recolor(tag.id, "violet")

    expect(recolored.name).toBe("Bid Docs")
    expect(recolored.color).toBe("violet")
  })

  it("restores an archived tag", async () => {
    const tag = await taskTagService.create({ name: "Bidding", color: "blue", createdBy: admin.id })
    await taskTagService.archive(tag.id)

    const restored = await taskTagService.restore(tag.id)
    expect(restored.archived_at).toBeNull()
  })
})
