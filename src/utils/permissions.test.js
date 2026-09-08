import { describe, it, expect } from "vitest";
import { getPermissionContext } from "./permissions";

describe("getPermissionContext", () => {
  it("returns every flag false for a user with no capabilities", () => {
    const ctx = getPermissionContext({ id: "u1" });
    expect(ctx.isSuperAdmin).toBe(false);
    expect(ctx.isHead).toBe(false);
    expect(ctx.isHr).toBe(false);
    expect(ctx.canManageLeaves).toBe(false);
    expect(ctx.hasSalesFlow).toBe(false);
    expect(ctx.hasTaskFlow).toBe(false);
    expect(ctx.hasPurchasingFlow).toBe(false);
    expect(ctx.isRoleSimulator).toBe(false);
    expect(ctx.canManage).toBe(false);
  });

  it("returns false for every flag on a null/undefined user", () => {
    expect(getPermissionContext(null).isSuperAdmin).toBe(false);
    expect(getPermissionContext(undefined).isHr).toBe(false);
  });

  it.each([
    ["is_super_admin", "isSuperAdmin", "isSuperAdmin"],
    ["is_head", "isHead", "isHead"],
    ["is_hr", "isHr", "isHr"],
    ["can_manage_leaves", "canManageLeaves", "canManageLeaves"],
    ["has_sales_flow", "hasSalesFlow", "hasSalesFlow"],
    ["has_task_flow", "hasTaskFlow", "hasTaskFlow"],
    ["has_purchasing_flow", "hasPurchasingFlow", "hasPurchasingFlow"],
    ["is_role_simulator", "isRoleSimulator", "isRoleSimulator"],
  ])("reconciles the snake_case spelling of %s", (snakeKey, _camelKey, ctxKey) => {
    const ctx = getPermissionContext({ [snakeKey]: true });
    expect(ctx[ctxKey]).toBe(true);
  });

  it.each([
    ["is_super_admin", "isSuperAdmin", "isSuperAdmin"],
    ["is_head", "isHead", "isHead"],
    ["is_hr", "isHr", "isHr"],
    ["can_manage_leaves", "canManageLeaves", "canManageLeaves"],
    ["has_sales_flow", "hasSalesFlow", "hasSalesFlow"],
    ["has_task_flow", "hasTaskFlow", "hasTaskFlow"],
    ["has_purchasing_flow", "hasPurchasingFlow", "hasPurchasingFlow"],
    ["is_role_simulator", "isRoleSimulator", "isRoleSimulator"],
  ])("reconciles the camelCase spelling of %s", (_snakeKey, camelKey, ctxKey) => {
    const ctx = getPermissionContext({ [camelKey]: true });
    expect(ctx[ctxKey]).toBe(true);
  });

  it("does not fail closed when only the snake_case spelling is present (the cached-profile bug)", () => {
    const cachedSuperAdmin = { id: "u2", is_super_admin: true };
    expect(getPermissionContext(cachedSuperAdmin).isSuperAdmin).toBe(true);
  });

  it("derives canManage from isHead or isSuperAdmin", () => {
    expect(getPermissionContext({ isHead: true }).canManage).toBe(true);
    expect(getPermissionContext({ isSuperAdmin: true }).canManage).toBe(true);
    expect(getPermissionContext({}).canManage).toBe(false);
  });

  it("prefers subDepartment over sub_department, falling back to null", () => {
    expect(getPermissionContext({ subDepartment: "Engineering" }).subDepartment).toBe("Engineering");
    expect(getPermissionContext({ sub_department: "Engineering" }).subDepartment).toBe("Engineering");
    expect(getPermissionContext({}).subDepartment).toBeNull();
  });
});
