import { describe, it, expect } from "vitest";
import {
  NAV_MODULES,
  getFilteredNavigationGroups,
  getFilteredQuickActions,
} from "./navigation";

describe("navigation registry", () => {
  it("defines the 7 canonical ERP modules adhering to CONTEXT.md", () => {
    const moduleKeys = Object.keys(NAV_MODULES);
    expect(moduleKeys).toEqual([
      "workspace",
      "operations",
      "sales",
      "purchasing",
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
      // Flow Canvas (issue #36) is deliberately visible to everyone: Live
      // editing is Super-Admin gated internally, and its Sandbox mode (the
      // former standalone Flow Plans, folded in by this reshape) stays open
      // to anyone, so even a standard employee sees the Administration group
      // for that one link.
      expect(groups).toHaveLength(2);
      expect(groups[0].key).toBe("workspace");
      expect(groups[0].label).toBe("Workspace");
      expect(groups[0].links.map((l) => l.label)).toEqual([
        "Dashboard",
        "My Leaves & Overtime",
      ]);
      expect(groups[1].key).toBe("administration");
      expect(groups[1].links.map((l) => l.label)).toEqual(["Flow Canvas"]);
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
        "Activity Log",
      ]);

      const approvalsGroup = groups.find((g) => g.key === "approvals");
      expect(approvalsGroup.links.map((l) => l.label)).toEqual([
        "HR Verifications",
      ]);

      // The Administration copy of this link is Super Admin-only (#105) — HR
      // reaches the log through its own module, not a second sidebar entry
      // pointing at the same route.
      const adminGroup = groups.find((g) => g.key === "administration");
      expect(adminGroup.links.map((l) => l.label)).not.toContain("Activity Log");
    });

    it("opens Leaves Manager for a leave-management capability holder without full HR access", () => {
      const leaveManager = {
        id: "lm-1",
        canManageLeaves: true,
      };

      const groups = getFilteredNavigationGroups(leaveManager);
      const hrGroup = groups.find((g) => g.key === "human_resources");
      expect(hrGroup).toBeDefined();
      // Employee Directory and Activity Log stay hidden — the capability is
      // scoped to leave management, not the broader HR flag's access to the
      // directory or the org-wide activity trail (#105).
      expect(hrGroup.links.map((l) => l.label)).toEqual(["Leaves Manager"]);
    });

    it("hides Leaves Manager from an employee without the capability", () => {
      const standardUser = { id: "std-1" };

      const groups = getFilteredNavigationGroups(standardUser);
      expect(groups.find((g) => g.key === "human_resources")).toBeUndefined();
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

    it("returns all 7 modules for Super Admin", () => {
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
        "purchasing",
        "approvals",
        "human_resources",
        "administration",
      ]);

      const adminGroup = groups.find((g) => g.key === "administration");
      expect(adminGroup.links.map((l) => l.label)).toEqual([
        "System Admin",
        // Activity Log lives in Human Resources now (#105) — Super Admin uses that entry.
        // Flow Plans folded into Flow Canvas's Sandbox mode by this reshape.
        "Flow Canvas",
        "Commission Pool",
        "Lead Sources",
      ]);

      const hrGroup = groups.find((g) => g.key === "human_resources");
      expect(hrGroup.links.map((l) => l.label)).toContain("Activity Log");
    });

    // Issue #39. The Module is gated on an explicit flag rather than on the
    // free-text `department` column: the org files purchasing as a
    // sub-department under OPERATIONS, so a string match would work on the day
    // it was written and then hide a purchaser's whole queue, with no error
    // anywhere, the first time somebody typed it differently.
    it("returns Purchasing for a user with purchasing flow", () => {
      const purchaser = {
        id: "buyer-1",
        has_purchasing_flow: true,
      };

      const groups = getFilteredNavigationGroups(purchaser);
      const purchasingGroup = groups.find((g) => g.key === "purchasing");
      expect(purchasingGroup).toBeDefined();
      expect(purchasingGroup.links.map((l) => l.label)).toEqual([
        "Purchasing Queue",
      ]);
    });

    it("hides Purchasing from an employee in a purchasing department without the flag", () => {
      const buyerWithoutAccess = {
        id: "buyer-2",
        department: "OPERATIONS",
        sub_department: "PURCHASING",
        has_task_flow: true,
      };

      const groups = getFilteredNavigationGroups(buyerWithoutAccess);
      expect(groups.map((g) => g.key)).not.toContain("purchasing");
    });

    it("does not grant Purchasing to sales or task flow", () => {
      const salesUser = {
        id: "sales-2",
        has_sales_flow: true,
        has_task_flow: true,
      };

      const groups = getFilteredNavigationGroups(salesUser);
      expect(groups.map((g) => g.key)).not.toContain("purchasing");
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
