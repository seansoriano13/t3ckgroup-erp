import { describe, it, expect } from "vitest";
import {
  NAV_MODULES,
  QUICK_ACTIONS,
  getFilteredNavigationGroups,
  getFilteredQuickActions,
  buildUserPermissionContext,
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
        "My Requests",
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
        "My Requests",
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
        "Leave Approvals",
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
        // Activity Log lives in Human Resources now (#105) — Super Admin uses that entry.
        // Flow Plans folded into Flow Canvas's Sandbox mode by this reshape.
        // System Admin and Lead Sources moved into Settings (#177).
        "Flow Canvas",
        "Commission Pool",
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

    // Issue #133/#134 — the hidden_nav_keys override.
    describe("hidden_nav_keys override", () => {
      it("hides an entry the flags permit when its key is in the override", () => {
        const salesUser = { id: "sales-3", has_sales_flow: true };
        const withOverride = { ...salesUser, hidden_nav_keys: ["sales.commissionDashboard"] };

        const groups = getFilteredNavigationGroups(withOverride);
        const salesGroup = groups.find((g) => g.key === "sales");
        expect(salesGroup.links.map((l) => l.label)).toEqual([
          "SOR / CRM",
          "Commission Formula",
        ]);
      });

      it("leaves an entry visible when the override does not name it", () => {
        const salesUser = { id: "sales-4", has_sales_flow: true, hidden_nav_keys: ["purchasing.queue"] };

        const groups = getFilteredNavigationGroups(salesUser);
        const salesGroup = groups.find((g) => g.key === "sales");
        expect(salesGroup.links.map((l) => l.label)).toEqual([
          "SOR / CRM",
          "Commission Dashboard",
          "Commission Formula",
        ]);
      });

      it("is subtractive only: naming a flag-denied entry in the override changes nothing", () => {
        // Flow Canvas is visible to everyone, so a standard employee still
        // sees the Administration group — the assertion is that naming the
        // flag-denied "Commission Pool" entry in the override doesn't reveal it.
        const standardUser = { id: "std-2", hidden_nav_keys: ["admin.commissionPool"] };

        const groups = getFilteredNavigationGroups(standardUser);
        const adminGroup = groups.find((g) => g.key === "administration");
        expect(adminGroup.links.map((l) => l.label)).not.toContain("Commission Pool");
        expect(adminGroup.links.map((l) => l.label)).toEqual(["Flow Canvas"]);
      });

      it("ignores an unknown key without error", () => {
        const salesUser = { id: "sales-5", has_sales_flow: true, hidden_nav_keys: ["not.a.real.key"] };

        expect(() => getFilteredNavigationGroups(salesUser)).not.toThrow();
        const groups = getFilteredNavigationGroups(salesUser);
        const salesGroup = groups.find((g) => g.key === "sales");
        expect(salesGroup.links.map((l) => l.label)).toEqual([
          "SOR / CRM",
          "Commission Dashboard",
          "Commission Formula",
        ]);
      });

      it.each([
        { isSuperAdmin: true },
        { isHead: true, subDepartment: "Engineering" },
        { isHead: true },
        { isHr: true },
        { canManageLeaves: true },
        { has_sales_flow: true },
        { has_task_flow: true },
        { has_purchasing_flow: true },
        { isHr: true, has_sales_flow: true, has_task_flow: true },
        {},
      ])(
        "no override resolves to exactly the un-overridden result across the flag matrix: %j",
        (flags) => {
          const user = { id: "matrix-user", ...flags };
          expect(getFilteredNavigationGroups(user)).toEqual(
            getFilteredNavigationGroups({ ...user, hidden_nav_keys: [] }),
          );
          expect(getFilteredQuickActions(user)).toEqual(
            getFilteredQuickActions({ ...user, hidden_nav_keys: [] }),
          );
        },
      );

      it("also hides a quick action named in the override", () => {
        const salesUser = { id: "sales-7", has_sales_flow: true, hidden_nav_keys: ["quick.sor"] };
        const actions = getFilteredQuickActions(salesUser);
        expect(actions.find((a) => a.category === "Sales")).toBeUndefined();
      });
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

  // The safety net for issue #124: every combination of the seven
  // capability flags, crossed with department present/absent and
  // sub-department present/absent, run through every navigation predicate.
  // A single differing cell fails the build — that is what makes the
  // permission-helper extraction in #126 provably a refactor rather than a
  // rewrite.
  describe("permission matrix (characterisation)", () => {
    const FLAGS = [
      "isSuperAdmin",
      "isHead",
      "isHr",
      "canManageLeaves",
      "hasSalesFlow",
      "hasTaskFlow",
      "hasPurchasingFlow",
    ];

    function* flagCombinations() {
      const total = 2 ** FLAGS.length;
      for (let mask = 0; mask < total; mask++) {
        const combo = {};
        FLAGS.forEach((flag, i) => {
          combo[flag] = Boolean(mask & (1 << i));
        });
        yield combo;
      }
    }

    function* userMatrix() {
      for (const flags of flagCombinations()) {
        for (const department of [undefined, "Engineering"]) {
          for (const subDepartment of [undefined, "Backend"]) {
            yield { ...flags, department, subDepartment };
          }
        }
      }
    }

    function allLinks() {
      return Object.values(NAV_MODULES).flatMap((module) =>
        module.links.map((link) => ({
          module: module.key,
          label: link.label,
          isPermitted: link.isPermitted,
        })),
      );
    }

    function allQuickActionItems() {
      return QUICK_ACTIONS.flatMap((group) =>
        group.items.map((item) => ({
          category: group.category,
          id: item.id,
          isPermitted: item.isPermitted,
        })),
      );
    }

    it("produces a stable permission matrix across every flag/department combination", () => {
      const links = allLinks();
      const quickActionItems = allQuickActionItems();
      const rows = [];

      for (const user of userMatrix()) {
        const ctx = buildUserPermissionContext(user);
        const permittedLinks = links
          .filter((link) => link.isPermitted(ctx))
          .map((link) => `${link.module}:${link.label}`);
        const permittedActions = quickActionItems
          .filter((item) => item.isPermitted(ctx))
          .map((item) => `${item.category}:${item.id}`);

        rows.push({
          flags: FLAGS.map((f) => (user[f] ? "1" : "0")).join(""),
          department: user.department ?? "none",
          subDepartment: user.subDepartment ?? "none",
          permittedLinks,
          permittedActions,
        });
      }

      expect(rows).toMatchSnapshot();
    });
  });
});
