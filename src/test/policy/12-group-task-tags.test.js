/**
 * Issue #205 — Group Task Tags against real Postgres.
 *
 * task_tags: every signed-in employee reads; only a Super Admin or a head can
 * create/rename/recolor (archive is an update, same rule). committee_task_tags:
 * read follows the group task's own (wide-open) visibility; only the group
 * task's creator or a Super Admin may tag/untag it — an ordinary member, or
 * anyone else, cannot.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, ensureCastLoaded, clientFor } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"
import { canRead, tryInsert, tryUpdate, RLS_VIOLATION } from "./support/access.js"

const svc = () => serviceClient()

let tagId
let groupTaskId

beforeAll(async () => {
  await ensureCastLoaded()

  const tag = await svc()
    .from("task_tags")
    .insert({ name: `${MARKER} Bidding`, color: "blue", created_by: ids.superAdmin })
    .select("id")
    .single()
  if (tag.error) throw new Error(tag.error.message)
  tagId = tag.data.id

  // The group task's creator is the "head" cast — the person allowed to tag it.
  const groupTask = await svc()
    .from("committee_tasks")
    .insert({ title: `${MARKER} Year-end inventory`, created_by: ids.head, status: "ACTIVE" })
    .select("id")
    .single()
  if (groupTask.error) throw new Error(groupTask.error.message)
  groupTaskId = groupTask.data.id
})

afterAll(async () => {
  await svc().from("committee_tasks").delete().like("title", `${MARKER}%`)
  await svc().from("task_tags").delete().like("name", `${MARKER}%`)
})

describe("task_tags", () => {
  it("lets an ordinary employee read tags", async () => {
    const client = await clientFor("ordinary")
    expect(await canRead(client, "task_tags", tagId)).toBe(true)
  })

  it("refuses an ordinary employee creating a tag", async () => {
    const client = await clientFor("ordinary")
    const result = await tryInsert(client, "task_tags", { name: `${MARKER} Self-made`, color: "amber" })
    expect(result.ok).toBe(false)
    expect(result.code).toBe(RLS_VIOLATION)
  })

  it("lets a head create a tag", async () => {
    const client = await clientFor("head")
    const result = await tryInsert(client, "task_tags", { name: `${MARKER} Head made`, color: "green" })
    expect(result.ok, result.message).toBe(true)
  })

  it("lets a Super Admin create and rename a tag", async () => {
    const client = await clientFor("superAdmin")
    const created = await tryInsert(client, "task_tags", { name: `${MARKER} Admin made`, color: "violet" })
    expect(created.ok, created.message).toBe(true)

    const renamed = await tryUpdate(client, "task_tags", created.id, { name: `${MARKER} Renamed` })
    expect(renamed.affected).toBe(1)
  })
})

describe("committee_task_tags", () => {
  it("lets an ordinary employee read tag links (group tasks are wide open today)", async () => {
    const link = await svc()
      .from("committee_task_tags")
      .insert({ committee_task_id: groupTaskId, tag_id: tagId, added_by: ids.head })
      .select("committee_task_id")
      .single()
    if (link.error) throw new Error(link.error.message)

    const client = await clientFor("ordinary")
    const { data, error } = await client
      .from("committee_task_tags")
      .select("*")
      .eq("committee_task_id", groupTaskId)
    expect(error).toBeNull()
    expect(data.length).toBeGreaterThan(0)

    await svc().from("committee_task_tags").delete().eq("committee_task_id", groupTaskId).eq("tag_id", tagId)
  })

  // committee_task_tags has a composite primary key (no `id` column), so the
  // generic tryInsert/canRead helpers (which select "id") don't fit here.
  const insertLink = (client) =>
    client.from("committee_task_tags").insert({ committee_task_id: groupTaskId, tag_id: tagId })

  it("refuses a non-creator tagging a group task", async () => {
    const client = await clientFor("ordinary")
    const { error } = await insertLink(client)
    expect(error).not.toBeNull()
    expect(error.code).toBe(RLS_VIOLATION)
  })

  it("lets the group task's creator tag it", async () => {
    const client = await clientFor("head")
    const { error } = await insertLink(client)
    expect(error, error?.message).toBeNull()

    await svc().from("committee_task_tags").delete().eq("committee_task_id", groupTaskId).eq("tag_id", tagId)
  })

  it("lets a Super Admin tag any group task", async () => {
    const client = await clientFor("superAdmin")
    const { error } = await insertLink(client)
    expect(error, error?.message).toBeNull()

    await svc().from("committee_task_tags").delete().eq("committee_task_id", groupTaskId).eq("tag_id", tagId)
  })
})
