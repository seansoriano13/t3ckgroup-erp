import {
  LayoutList,
  CalendarDays,
  ListCheck,
  ListTodo,
  Clock,
  UsersRound,
  LayoutTemplate,
  Target,
  ShieldCheck,
  Users,
  ClipboardList,
  SquarePen,
  Percent,
  Workflow,
  ShoppingCart,
  ShoppingBag,
  Sparkles,
  Handshake,
  Bug,
  PackageOpen,
  ReceiptText,
  PackageCheck,
  Gavel,
  Scale,
  LayoutDashboard,
  Calculator,
} from "lucide-react";
import { getPermissionContext, isNavEntryVisible } from "@/utils/permissions";

export const NAV_MODULES = {
  workspace: {
    key: "workspace",
    label: "Workspace",
    defaultExpanded: true,
    links: [
      {
        key: "workspace.dashboard",
        label: "Dashboard",
        link: "/",
        icon: LayoutList,
        isPermitted: () => true,
        exactMatch: true,
      },
      {
        key: "workspace.myTasks",
        label: "My Tasks",
        link: "/tasks",
        icon: ListCheck,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.hasTaskFlow,
      },
      {
        key: "workspace.myLeaves",
        label: "My Requests",
        link: "/offsets",
        icon: Clock,
        isPermitted: () => true,
      },
      // The company-wide Calendar, for everyone (ADR 0037). The server decides
      // what each viewer may see on it.
      {
        key: "workspace.calendar",
        label: "Calendar",
        link: "/calendar",
        icon: CalendarDays,
        isPermitted: () => true,
      },
      // What changed in the ERP, for everyone (ADR 0030). The What's new
      // popup points here once; this entry is how people find it again.
      {
        key: "workspace.releaseNotes",
        label: "Release Notes",
        link: "/release-notes",
        icon: Sparkles,
        isPermitted: () => true,
      },
    ],
  },
  operations: {
    key: "operations",
    label: "Operations",
    defaultExpanded: true,
    links: [
      {
        key: "operations.groupTasks",
        label: "Group Tasks",
        link: "/group-tasks",
        icon: UsersRound,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.hasTaskFlow,
        exactMatch: true,
      },
      {
        key: "operations.taskTemplates",
        label: "Task Templates",
        link: "/group-tasks/templates",
        icon: LayoutTemplate,
        isPermitted: (ctx) => ctx.isSuperAdmin || (ctx.canManage && ctx.hasTaskFlow),
      },
    ],
  },
  sales: {
    key: "sales",
    label: "Sales",
    defaultExpanded: true,
    links: [
      {
        key: "sales.sors",
        label: "SORS",
        link: "/sors",
        icon: Target,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.isHr || ctx.hasSalesFlow,
        exactMatch: true,
      },
      // The Costing Matrix page (#606): every SOR's matrix with Planned and
      // Actual Revenue. The Closed Book only (Super Admins and the Final
      // Acquire list); the page sends anyone else home and the database
      // refuses the read.
      {
        key: "sales.costingMatrix",
        label: "Costing Matrix",
        link: "/costing-matrix",
        icon: Calculator,
        isPermitted: (ctx) => ctx.isBidDecider,
        exactMatch: true,
      },
      // ADR 0021 keeps a Stage Participant out of `sales_opportunities`, so a
      // deal someone was called into can never appear in the SORS register.
      // This is where it appears instead. Deliberately ungated, like Flow
      // Canvas: `isPermitted` is synchronous and cannot ask whether this
      // person holds a window, and gating on `hasSalesFlow` would lock out
      // exactly the people ADR 0021 names — a purchaser, an engineer, a
      // finance officer — none of whom need Sales access to be called in.
      // The page shows an empty state to anyone who has none.
      {
        key: "sales.mySors",
        label: "My SORs",
        link: "/my-sors",
        icon: Handshake,
        badgeKey: "mySors",
        isPermitted: () => true,
        exactMatch: true,
      },
      {
        key: "sales.commissionDashboard",
        label: "Commission Dashboard",
        link: "/sors/commission",
        icon: Percent,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.isHr || ctx.hasSalesFlow,
        exactMatch: true,
      },
      // Issues #170-#174 put the Retail Queue and Retail totals in the
      // register's tab strip. They live on their own screen now — the strip
      // was the crowded thing, and retail is a sideline that nobody scans the
      // register for. Last in the group for the same reason.
      //
      // Gated by the Retail access right (`has_retail_access`, System Access
      // Rights in the employee form), which is on by default for SALES
      // employees. The same right backs the screen, the queue table's RLS
      // policy and the approve RPC, so the sidebar and the data agree.
      {
        key: "sales.retail",
        label: "Retail",
        link: "/retail",
        icon: ShoppingBag,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.hasRetailAccess,
        exactMatch: true,
      },
    ],
  },
  purchasing: {
    key: "purchasing",
    label: "Purchasing",
    defaultExpanded: true,
    links: [
      {
        // Every employee opens and follows their own Purchase Requests (#179);
        // Purchasing access is what lets someone take and buy them.
        key: "purchasing.queue",
        label: "Purchase Requests",
        link: "/purchasing",
        icon: ShoppingCart,
        isPermitted: () => true,
        exactMatch: true,
      },
      // The Purchasing Dashboard (#322): every SOR's buying grouped by what is
      // outstanding, with Order Monitoring (#263) folded into its tracker since
      // 2026-10-20. Purchasing access, Finance access and Super Admins; the
      // database limits the rows and the page sends anyone else home.
      {
        key: "purchasing.dashboard",
        label: "Purchasing Dashboard",
        link: "/purchasing/dashboard",
        icon: LayoutDashboard,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.hasPurchasingFlow || ctx.hasFinanceFlow,
        exactMatch: true,
      },
      // Canvasses (#566, ADR 0034): every Canvass, project ones included. For
      // everyone with Purchasing access; the page sends anyone else home.
      {
        key: "purchasing.canvasses",
        label: "Canvasses",
        link: "/purchasing/canvasses",
        icon: Scale,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.hasPurchasingFlow,
        exactMatch: true,
      },
      // The IPAS (#241): one per purchase order that needs one. Read by
      // Purchasing access, Finance access, Super Admins and the sign-off
      // lists; the database refuses everyone else, so this only spares the
      // rest an empty screen. Not an exact match: an open IPAS is a child
      // route.
      {
        key: "purchasing.ipas",
        label: "IPAS",
        link: "/purchasing/ipas",
        icon: ReceiptText,
        isPermitted: (ctx) =>
          ctx.isSuperAdmin || ctx.hasPurchasingFlow || ctx.hasFinanceFlow || ctx.isIpasSigner,
      },
      // Transmittals (#252): the TG03 slips. Read by the IPAS readers and the
      // four Transmittal staff lists; the database refuses everyone else.
      {
        key: "purchasing.transmittals",
        label: "Transmittals",
        link: "/purchasing/transmittals",
        icon: ReceiptText,
        isPermitted: (ctx) =>
          ctx.isSuperAdmin ||
          ctx.hasPurchasingFlow ||
          ctx.hasFinanceFlow ||
          ctx.isIpasSigner ||
          ctx.isIpasApprover ||
          ctx.isTransmittalStaff,
      },
      // Packing Lists (#255): the boxes packed for an SOR. Read by the IPAS
      // readers and the Warehouse list; the database refuses everyone else.
      {
        key: "purchasing.packing_lists",
        label: "Packing Lists",
        link: "/purchasing/packing-lists",
        icon: PackageOpen,
        isPermitted: (ctx) =>
          ctx.isSuperAdmin ||
          ctx.hasPurchasingFlow ||
          ctx.hasFinanceFlow ||
          ctx.isIpasSigner ||
          ctx.isTransmittalWarehouse,
      },
    ],
  },
  approvals: {
    key: "approvals",
    label: "Approvals",
    defaultExpanded: true,
    links: [
      {
        key: "approvals.tasks",
        label: "Task Approvals",
        link: "/approvals/tasks",
        icon: ShieldCheck,
        badgeKey: "taskApprovals",
        isPermitted: (ctx) => {
          if (ctx.isSuperAdmin) return true;
          if (ctx.isHead) {
            const isMasterHead = !ctx.subDepartment;
            return isMasterHead || ctx.hasTaskFlow;
          }
          return false;
        },
        exactMatch: true,
      },
      {
        key: "approvals.hrVerifications",
        label: "HR Verifications",
        link: "/approvals/hr-verification",
        icon: ShieldCheck,
        badgeKey: "hrVerifications",
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.isHr,
        exactMatch: true,
      },
      {
        label: "Time Off & Overtime",
        link: "/approvals/leaves",
        icon: Clock,
        badgeKey: "leaveApprovals",
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.isHead,
        exactMatch: true,
      },
      {
        // Meeting Requests (#624): the head step and HR's final say.
        key: "approvals.meetings",
        label: "Meeting Requests",
        link: "/approvals/meetings",
        icon: Clock,
        badgeKey: "meetingApprovals",
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.isHead || ctx.isHr,
        exactMatch: true,
      },
      {
        // IPAS sign-offs (#247, #248): sections 1 and 3, and section 7's
        // Received, Noted, Checked and Approved, for the people on those
        // lists. A Super Admin signs only when on a list, so no pass here.
        key: "approvals.ipas",
        label: "IPAS Sign-offs",
        link: "/approvals/ipas",
        icon: ReceiptText,
        badgeKey: "ipasSignoffs",
        isPermitted: (ctx) => ctx.isIpasApprover,
        exactMatch: true,
      },
      {
        // Transmittal Check by (#254): slips awaiting the two Check by
        // signatures, for the Check by list only.
        key: "approvals.transmittals",
        label: "Transmittal Check by",
        link: "/approvals/transmittals",
        icon: PackageCheck,
        isPermitted: (ctx) => ctx.isTransmittalCheckBy,
        exactMatch: true,
      },
      {
        // Costing Matrix Bid Decisions (#320): matrices waiting for Go, No-go
        // or Revise, for Super Admins and the Final Acquire list.
        key: "approvals.bidDecisions",
        label: "Bid Decisions",
        link: "/approvals/bid-decisions",
        icon: Gavel,
        isPermitted: (ctx) => ctx.isBidDecider,
        exactMatch: true,
      },
      {
        // Canvass sign-offs (#279): Canvasses with a winner and a reason, waiting for the
        // purchasing approver list (the one that approves Transmittals).
        key: "approvals.canvassSignoffs",
        label: "Canvass Sign-offs",
        link: "/approvals/canvass-signoffs",
        icon: Scale,
        isPermitted: (ctx) => ctx.isTransmittalCheckBy,
        exactMatch: true,
      },
    ],
  },
  human_resources: {
    key: "human_resources",
    label: "Human Resources",
    defaultExpanded: false,
    links: [
      {
        key: "hr.employeeDirectory",
        label: "Employee Directory",
        link: "/hr/management",
        icon: Users,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.isHr,
      },
      {
        key: "hr.leavesManager",
        label: "Time Off & Overtime",
        link: "/hr/offsets",
        icon: Clock,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.isHr || ctx.canManageLeaves,
      },
      {
        // #105 — HR needs a route to the log without a Super Admin opening it
        // for them. The narrower leave-management capability stays excluded,
        // the same way it stays out of the Employee Directory: the activity
        // log spans every HR entity (employee edits, category changes,
        // settings), not just leave records, so it stays scoped to full HR.
        key: "hr.activityLog",
        label: "Activity Log",
        link: "/super-admin/activity-log",
        icon: ClipboardList,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.isHr,
      },
    ],
  },
  administration: {
    key: "administration",
    label: "Administration",
    defaultExpanded: false,
    links: [
      // System Admin (announcements) and Lead Sources moved into Settings
      // (#177) — both now live there, gated the same way (Super Admin).

      // Activity Log moved to the Human Resources group (#105) — Super
      // Admin already qualifies for that entry's isPermitted check, so it
      // isn't duplicated here.

      // Issue #36/#83 — a long-lived feature, not a one-time build. One
      // editing surface since #186 removed the Sandbox mode. The Flow Canvas
      // tables are writable by every signed-in employee (see the policy
      // tier), so the entry stays visible to all; the Flow Snapshot history
      // reached from the canvas is Super-Admin-gated.
      {
        key: "admin.flowCanvas",
        label: "Flow Canvas",
        link: "/super-admin/flow-canvas",
        icon: Workflow,
        isPermitted: () => true,
      },
      // Bug Reports sent from the floating button on every page. Gated by the
      // Bug Reports access right (`has_bug_report_access`, on by default for
      // the IT Team), the same right behind the table's RLS policy.
      {
        key: "admin.bugReports",
        label: "Bug Reports",
        link: "/bug-reports",
        icon: Bug,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.hasBugReportAccess,
        exactMatch: true,
      },
    ],
  },
};

/**
 * Normalizes user object into a clean context object for permission checking.
 *
 * Wraps the shared permission helper (`getPermissionContext`) rather than
 * duplicating it — this function stays for callers that already import it
 * from here.
 */
export function buildUserPermissionContext(user) {
  return getPermissionContext(user);
}

/**
 * Returns the navigation groups filtered by the given user's permissions.
 * Groups with zero visible links are omitted.
 */
export function getFilteredNavigationGroups(user) {
  const ctx = buildUserPermissionContext(user);

  return Object.values(NAV_MODULES)
    .map((module) => {
      const visibleLinks = module.links.filter((link) => isNavEntryVisible(ctx, link));
      return {
        key: module.key,
        label: module.label,
        defaultExpanded: module.defaultExpanded,
        links: visibleLinks,
      };
    })
    .filter((group) => group.links.length > 0);
}

/**
 * Categorized quick action templates for the '+' creation popover.
 */
export const QUICK_ACTIONS = [
  {
    category: "Personal",
    items: [
      {
        id: "task",
        key: "quick.task",
        label: "Log Task",
        icon: SquarePen,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.hasTaskFlow,
      },
      {
        id: "offset",
        key: "quick.offset",
        label: "File Time Off / Overtime",
        icon: Clock,
        isPermitted: () => true,
      },
      {
        id: "meeting-request",
        key: "quick.meetingRequest",
        label: "New Meeting Request",
        icon: UsersRound,
        isPermitted: () => true,
      },
    ],
  },
  {
    category: "Operations",
    items: [
      {
        id: "group-task",
        key: "quick.groupTask",
        label: "Create Group Task",
        icon: UsersRound,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.hasTaskFlow,
      },
      {
        // Every employee may open a Purchase Request (#179), as in the nav.
        id: "purchase-request",
        key: "quick.purchaseRequest",
        label: "New Purchase Request",
        icon: ShoppingCart,
        isPermitted: () => true,
      },
    ],
  },
  {
    category: "Sales",
    items: [
      {
        id: "sor",
        key: "quick.sor",
        label: "Register SOR",
        icon: Target,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.isHr || ctx.hasSalesFlow,
      },
    ],
  },
];

/**
 * Every navigation link and quick action that carries a stable `key`,
 * flattened with the group it belongs to — for an override editor to list,
 * not for filtering (that stays `isPermitted`/`isNavEntryVisible`).
 */
export function getAllOverridableEntries() {
  const navEntries = Object.values(NAV_MODULES).flatMap((module) =>
    module.links
      .filter((link) => link.key)
      .map((link) => ({ key: link.key, label: link.label, group: module.label, isPermitted: link.isPermitted })),
  );
  const quickActionEntries = QUICK_ACTIONS.flatMap((group) =>
    group.items
      .filter((item) => item.key)
      .map((item) => ({ key: item.key, label: item.label, group: `Quick Action: ${group.category}`, isPermitted: item.isPermitted })),
  );
  return [...navEntries, ...quickActionEntries];
}

/**
 * Returns categorized quick actions filtered by user role.
 * Categories with zero permitted items are excluded.
 */
export function getFilteredQuickActions(user) {
  const ctx = buildUserPermissionContext(user);

  return QUICK_ACTIONS.map((group) => {
    const visibleItems = group.items.filter((item) => isNavEntryVisible(ctx, item));
    return {
      category: group.category,
      items: visibleItems,
    };
  }).filter((group) => group.items.length > 0);
}

