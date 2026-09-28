/**
 * Removing a member from a Group Task against real Postgres.
 *
 * committee_task_members had no DELETE policy, so every removal matched zero
 * rows without an error — the app toasted success and logged MEMBER_REMOVED
 * while the member stayed. Who may remove now mirrors who may add: the group
 * task's creator or a Super Admin. Anyone else, the member included, removes
 * nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, ensureCastLoaded, clientFor } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"
import { tryDelete } from "./support/access.js"

const svc = () => serviceClient()

let groupTaskId

beforeAll(async () => {
  await ensureCastLoaded()

  // The "head" cast creates the task — the person allowed to remove members.
  const groupTask = await svc()
    .from("committee_tasks")
    .insert({ title: `${MARKER} Member removal`, created_by: ids.head, status: "ACTIVE" })
    .select("id")
    .single()
  if (groupTask.error) throw new Error(groupTask.error.message)
  groupTaskId = groupTask.data.id
})

afterAll(async () => {
  await svc().from("committee_tasks").delete().like("title", `${MARKER}%`)
})

const addMember = async (employeeId) => {
  const { data, error } = await svc()
    .from("committee_task_members")
    .insert({ committee_task_id: groupTaskId, employee_id: employeeId, task_description: "Count aisle A" })
    .select("id")
    .single()
  if (error) throw new Error(error.message)
  return data.id
}

describe("removing a group task member", () => {
  it("lets the creator remove a member", async () => {
    const memberId = await addMember(ids.ordinary)
    const result = await tryDelete(await clientFor("head"), "committee_task_members", memberId)
    expect(result.affected).toBe(1)
  })

  it("lets a Super Admin remove a member of anyone's task", async () => {
    const memberId = await addMember(ids.ordinary)
    const result = await tryDelete(await clientFor("superAdmin"), "committee_task_members", memberId)
    expect(result.affected).toBe(1)
  })

  it("does not let a member remove themselves", async () => {
    const memberId = await addMember(ids.ordinary)
    const result = await tryDelete(await clientFor("ordinary"), "committee_task_members", memberId)
    expect(result.affected).toBe(0)
  })

  it("does not let an outsider remove anyone", async () => {
    const memberId = await addMember(ids.ordinary)
    const result = await tryDelete(await clientFor("outsider"), "committee_task_members", memberId)
    expect(result.affected).toBe(0)
  })
})
