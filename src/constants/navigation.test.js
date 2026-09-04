import { describe, it, expect } from "vitest";
import {
  NAV_MODULES,
  getFilteredNavigationGroups,
  getFilteredQuickActions,
} from "./navigation";

describe("navigation registry", () => {
  it("defines the 6 canonical ERP modules adhering to CONTEXT.md", () => {
    const moduleKeys = Object.keys(NAV_MODULES);
    expect(moduleKeys).toEqual([
      "workspace",
      "operations",
      "sales",
      "approvals",
      "human_resources",
      "administration",
    ]);
  });

  describe("getFilteredNavigationGroups", () => {
    it("returns only Workspace links for a standard employee without extra flows", () => {
      const standardUser = {
        id: "user-1",
        name: "Standard User",
        isSuperAdmin: false,
        isHead: false,
        isHr: false,
        has_sales_flow: false,
        has_task_flow: false,
      };

      const groups = getFilteredNavigationGroups(standardUser);
      expect(groups).toHaveLength(1);
      expect(groups[0].key).toBe("workspace");
      expect(groups[0].label).toBe("Workspace");
      expect(groups[0].links.map((l) => l.label)).toEqual([
        "Dashboard",
        "My Leaves & Overtime",
      ]);
    });

    it("includes My Tasks in Workspace when user has task flow", () => {
      const taskUser = {
        id: "user-2",
        has_task_flow: true,
      };

      const groups = getFilteredNavigationGroups(taskUser);
      const workspaceGroup = groups.find((g) => g.key === "workspace");
      expect(workspaceGroup.links.map((l) => l.label)).toEqual([
        "Dashboard",
        "My Tasks",
        "My Leaves & Overtime",
      ]);
    });

    it("returns Workspace, Operations, and Approvals for a Department Head with task flow", () => {
      const headUser = {
        id: "head-1",
        isHead: true,
        has_task_flow: true,
        subDepartment: "Engineering",
      };

      const groups = getFilteredNavigationGroups(headUser);
      const groupKeys = groups.map((g) => g.key);
      expect(groupKeys).toContain("workspace");
      expect(groupKeys).toContain("operations");
      expect(groupKeys).toContain("approvals");

      const operationsGroup = groups.find((g) => g.key === "operations");
      expect(operationsGroup.links.map((l) => l.label)).toEqual([
        "Group Tasks",
        "Task Templates",
      ]);

      const approvalsGroup = groups.find((g) => g.key === "approvals");
      expect(approvalsGroup.links.map((l) => l.label)).toEqual([
        "Task Approvals",
      ]);
    });

    it("returns Workspace, Approvals (HR Verifications), and Human Resources for HR users", () => {
      const hrUser = {
        id: "hr-1",
        isHr: true,
      };

      const groups = getFilteredNavigationGroups(hrUser);
      const groupKeys = groups.map((g) => g.key);
      expect(groupKeys).toContain("workspace");
      expect(groupKeys).toContain("approvals");
      expect(groupKeys).toContain("human_resources");

      const hrGroup = groups.find((g) => g.key === "human_resources");
      expect(hrGroup.links.map((l) => l.label)).toEqual([
        "Employee Directory",
        "Leaves Manager",
      ]);

      const approvalsGroup = groups.find((g) => g.key === "approvals");
      expect(approvalsGroup.links.map((l) => l.label)).toEqual([
        "HR Verifications",
      ]);
    });

    it("returns Sales with SOR Register when user has sales flow", () => {
      const salesUser = {
        id: "sales-1",
        has_sales_flow: true,
      };

      const groups = getFilteredNavigationGroups(salesUser);
      const salesGroup = groups.find((g) => g.key === "sales");
      expect(salesGroup).toBeDefined();
      expect(salesGroup.links.map((l) => l.label)).toEqual([
        "SOR / CRM",
        "Commission Dashboard",
        "Commission Formula",
      ]);
    });

    it("returns all 6 modules for Super Admin", () => {
      const superAdminUser = {
        id: "admin-1",
        isSuperAdmin: true,
      };

      const groups = getFilteredNavigationGroups(superAdminUser);
      const groupKeys = groups.map((g) => g.key);
      expect(groupKeys).toEqual([
        "workspace",
        "operations",
        "sales",
        "approvals",
        "human_resources",
        "administration",
      ]);

      const adminGroup = groups.find((g) => g.key === "administration");
      expect(adminGroup.links.map((l) => l.label)).toEqual([
        "System Admin",
        "Activity Log",
        "Pipeline Stages",
        "Commission Pool",
        "Lead Sources",
      ]);
    });
  });

  describe("getFilteredQuickActions", () => {
    it("returns categorized quick actions filtered by user role", () => {
      const standardUser = {
        id: "u1",
        has_task_flow: false,
        has_sales_flow: false,
      };

      const actions = getFilteredQuickActions(standardUser);
      expect(actions).toHaveLength(1);
      expect(actions[0].category).toBe("Personal");
      expect(actions[0].items.map((i) => i.label)).toEqual([
        "Apply Leave / Overtime",
      ]);
    });

    it("returns Personal, Operations, and Sales categories for Super Admin", () => {
      const superAdmin = {
        id: "admin-1",
        isSuperAdmin: true,
      };

      const actions = getFilteredQuickActions(superAdmin);
      const categories = actions.map((a) => a.category);
      expect(categories).toEqual(["Personal", "Operations", "Sales"]);
    });
  });
});
