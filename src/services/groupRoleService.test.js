import { describe, expect, it } from "vitest"
import { groupRoleService } from "./groupRoleService"
import { db } from "@/test/db/store"

/**
 * The list of roles a group member can hold. Small, but it feeds a
 * dropdown that heads use on every group task, and role names must stay
 * unique so two entries cannot mean the same thing.
 */
describe("groupRoleService", () => {
  it("lists roles in the order they were added", async () => {
    db.seed("committee_roles", [{ role_name: "Chair" }, { role_name: "Secretary" }])

    const roles = await groupRoleService.getRoles()

    expect(roles.map((r) => r.role_name)).toEqual(["Chair", "Secretary"])
  })

  it("adds a role and returns it", async () => {
    const created = await groupRoleService.addRole("Treasurer")

    expect(created.role_name).toBe("Treasurer")
    expect((await groupRoleService.getRoles()).map((r) => r.role_name)).toEqual(["Treasurer"])
  })

  it("refuses a role name that already exists", async () => {
    await groupRoleService.addRole("Chair")

    await expect(groupRoleService.addRole("Chair")).rejects.toMatchObject({ code: "23505" })
  })

  it("renames a role", async () => {
    const created = await groupRoleService.addRole("Treasurer")

    await groupRoleService.updateRole(created.id, "Finance Lead")

    expect((await groupRoleService.getRoles()).map((r) => r.role_name)).toEqual([
      "Finance Lead",
    ])
  })

  it("removes a role", async () => {
    const created = await groupRoleService.addRole("Treasurer")

    await groupRoleService.deleteRole(created.id)

    expect(await groupRoleService.getRoles()).toEqual([])
  })
})
