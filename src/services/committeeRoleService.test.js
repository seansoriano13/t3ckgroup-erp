import { describe, expect, it } from "vitest"
import { committeeRoleService } from "./committeeRoleService"
import { db } from "@/test/db/store"

/**
 * The list of roles a committee member can hold. Small, but it feeds a
 * dropdown that heads use on every committee task, and role names must stay
 * unique so two entries cannot mean the same thing.
 */
describe("committeeRoleService", () => {
  it("lists roles in the order they were added", async () => {
    db.seed("committee_roles", [{ role_name: "Chair" }, { role_name: "Secretary" }])

    const roles = await committeeRoleService.getRoles()

    expect(roles.map((r) => r.role_name)).toEqual(["Chair", "Secretary"])
  })

  it("adds a role and returns it", async () => {
    const created = await committeeRoleService.addRole("Treasurer")

    expect(created.role_name).toBe("Treasurer")
    expect((await committeeRoleService.getRoles()).map((r) => r.role_name)).toEqual(["Treasurer"])
  })

  it("refuses a role name that already exists", async () => {
    await committeeRoleService.addRole("Chair")

    await expect(committeeRoleService.addRole("Chair")).rejects.toMatchObject({ code: "23505" })
  })

  it("renames a role", async () => {
    const created = await committeeRoleService.addRole("Treasurer")

    await committeeRoleService.updateRole(created.id, "Finance Lead")

    expect((await committeeRoleService.getRoles()).map((r) => r.role_name)).toEqual([
      "Finance Lead",
    ])
  })

  it("removes a role", async () => {
    const created = await committeeRoleService.addRole("Treasurer")

    await committeeRoleService.deleteRole(created.id)

    expect(await committeeRoleService.getRoles()).toEqual([])
  })
})
