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
      // Three entries are deliberately visible to everyone, so a standard
      // employee sees four groups rather than one:
      //
      // - Flow Canvas (issue #36) — its tables are writable by every signed-in
      //   employee (see the policy tier).
      // - My SORs (ADR 0021) — anyone can be called into a deal, and the
      //   people ADR 0021 names (a purchaser, an engineer, a finance officer)
      //   are exactly the ones who may hold no sales flow. Gating it on
      //   `hasSalesFlow` would hide the only screen that lists the deals they
      //   already have enforced access to. The page shows an empty state.
      // - Purchase Requests (#179) — anyone asks Purchasing to buy something
      //   and follows their own requests; the database limits what they read.
      expect(groups).toHaveLength(4);
      expect(groups[0].key).toBe("workspace");
      expect(groups[0].label).toBe("Workspace");
      expect(groups[0].links.map((l) => l.label)).toEqual([
        "Dashboard",
        "My Requests",
        // Open to everyone (ADR 0030).
        "Release Notes",
      ]);
      expect(groups[1].key).toBe("sales");
      expect(groups[1].links.map((l) => l.label)).toEqual(["My SORs"]);
      expect(groups[2].key).toBe("purchasing");
      expect(groups[2].links.map((l) => l.label)).toEqual(["Purchase Requests"]);
      expect(groups[3].key).toBe("administration");
      expect(groups[3].links.map((l) => l.label)).toEqual(["Flow Canvas"]);
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
        "Release Notes",
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
        has_retail_access: true,
      };

      const groups = getFilteredNavigationGroups(salesUser);
      const salesGroup = groups.find((g) => g.key === "sales");
      expect(salesGroup).toBeDefined();
      expect(salesGroup.links.map((l) => l.label)).toEqual([
        "SORS",
        // ADR 0021: the SORs this person was called into, which `sor_read`
        // keeps out of the register above. Ungated — see the standard
        // employee case.
        "My SORs",
        "Commission Dashboard",
        // Retail moved out of the register's tab strip onto its own screen,
        // gated by the Retail access right (on by default for SALES).
        "Retail",
      ]);
    });

    it("keeps Retail out of the sidebar for an employee without the Retail access right", () => {
      const taskUser = { id: "task-1", has_task_flow: true };

      const groups = getFilteredNavigationGroups(taskUser);
      // The Sales group now survives for this user, but only for My SORs —
      // Retail must still be absent from it.
      const salesGroup = groups.find((g) => g.key === "sales");
      expect(salesGroup.links.map((l) => l.label)).toEqual(["My SORs"]);

      // Asserted against the entry itself as well: checking only the group's
      // contents would not catch Retail's own gate being loosened.
      const retail = NAV_MODULES.sales.links.find((l) => l.key === "sales.retail");
      expect(retail).toBeDefined();
      expect(retail.link).toBe("/retail");
      expect(retail.isPermitted(buildUserPermissionContext(taskUser))).toBe(false);
      // Sales flow alone no longer opens Retail — the access right does.
      expect(
        retail.isPermitted(buildUserPermissionContext({ id: "s", has_sales_flow: true })),
      ).toBe(false);
      expect(
        retail.isPermitted(buildUserPermissionContext({ id: "s", has_retail_access: true })),
      ).toBe(true);
      expect(
        retail.isPermitted(buildUserPermissionContext({ id: "a", isSuperAdmin: true })),
      ).toBe(true);
    });

    it("shows Bug Reports only to a Super Admin or a holder of the Bug Reports access right", () => {
      const entry = NAV_MODULES.administration.links.find((l) => l.key === "admin.bugReports");
      expect(entry).toBeDefined();
      expect(entry.link).toBe("/bug-reports");
      const permitted = (user) => entry.isPermitted(buildUserPermissionContext(user));
      expect(permitted({ id: "e" })).toBe(false);
      expect(permitted({ id: "h", is_hr: true, is_head: true })).toBe(false);
      expect(permitted({ id: "it", has_bug_report_access: true })).toBe(true);
      expect(permitted({ id: "a", isSuperAdmin: true })).toBe(true);
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
        // Flow Plans / the Sandbox mode were removed by #186.
        // System Admin and Lead Sources moved into Settings (#177).
        // Commission Pool moved onto the Commission Dashboard's Formula tab (#441).
        "Flow Canvas",
        // Release Notes moved to Workspace, open to everyone (ADR 0030).
        "Bug Reports",
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
        "Purchase Requests",
      ]);
    });

    // Purchase Requests is open to everyone (#179), so the Purchasing group
    // shows without the flag. What the flag grants (Take, Buyer pills) is the
    // page's and the database's business, and stays off the department field.
    it("shows Purchase Requests to an employee in a purchasing department without the flag", () => {
      const buyerWithoutAccess = {
        id: "buyer-2",
        department: "OPERATIONS",
        sub_department: "PURCHASING",
        has_task_flow: true,
      };

      const groups = getFilteredNavigationGroups(buyerWithoutAccess);
      expect(groups.find((g) => g.key === "purchasing")?.links.map((l) => l.label)).toEqual(["Purchase Requests"]);
    });

    it("shows Purchase Requests to sales and task flow too", () => {
      const salesUser = {
        id: "sales-2",
        has_sales_flow: true,
        has_task_flow: true,
      };

      const groups = getFilteredNavigationGroups(salesUser);
      expect(groups.map((g) => g.key)).toContain("purchasing");
    });

    // Issue #133/#134 — the hidden_nav_keys override.
    describe("hidden_nav_keys override", () => {
      it("hides an entry the flags permit when its key is in the override", () => {
        const salesUser = { id: "sales-3", has_sales_flow: true, has_retail_access: true };
        const withOverride = { ...salesUser, hidden_nav_keys: ["sales.commissionDashboard"] };

        const groups = getFilteredNavigationGroups(withOverride);
        const salesGroup = groups.find((g) => g.key === "sales");
        expect(salesGroup.links.map((l) => l.label)).toEqual([
          "SORS",
          "My SORs",
          "Retail",
        ]);
      });

      it("leaves an entry visible when the override does not name it", () => {
        const salesUser = { id: "sales-4", has_sales_flow: true, has_retail_access: true, hidden_nav_keys: ["purchasing.queue"] };

        const groups = getFilteredNavigationGroups(salesUser);
        const salesGroup = groups.find((g) => g.key === "sales");
        expect(salesGroup.links.map((l) => l.label)).toEqual([
          "SORS",
          "My SORs",
          "Commission Dashboard",
          "Retail",
        ]);
      });

      it("is subtractive only: naming a flag-denied entry in the override changes nothing", () => {
        // A sales employee without the Retail access right: naming the
        // flag-gated "Retail" entry in the override doesn't reveal it.
        const salesUser = { id: "std-2", has_sales_flow: true, has_retail_access: false, hidden_nav_keys: ["sales.retail"] };

        const groups = getFilteredNavigationGroups(salesUser);
        const salesGroup = groups.find((g) => g.key === "sales");
        expect(salesGroup.links.map((l) => l.label)).not.toContain("Retail");
      });

      it("ignores an unknown key without error", () => {
        const salesUser = { id: "sales-5", has_sales_flow: true, has_retail_access: true, hidden_nav_keys: ["not.a.real.key"] };

        expect(() => getFilteredNavigationGroups(salesUser)).not.toThrow();
        const groups = getFilteredNavigationGroups(salesUser);
        const salesGroup = groups.find((g) => g.key === "sales");
        expect(salesGroup.links.map((l) => l.label)).toEqual([
          "SORS",
          "My SORs",
          "Commission Dashboard",
          "Retail",
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

  // The safety net for issue #124: every combination of the eight
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
      "hasRetailAccess",
      "hasBugReportAccess",
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
