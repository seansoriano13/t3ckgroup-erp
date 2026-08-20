import {
  LayoutList,
  ListCheck,
  Clock,
  UsersRound,
  LayoutTemplate,
  Target,
  ShieldCheck,
  Users,
  ClipboardList,
  Crown,
  SquarePen,
} from "lucide-react";

export const NAV_MODULES = {
  workspace: {
    key: "workspace",
    label: "Workspace",
    defaultExpanded: true,
    links: [
      {
        label: "Dashboard",
        link: "/",
        icon: LayoutList,
        isPermitted: () => true,
        exactMatch: true,
      },
      {
        label: "My Tasks",
        link: "/tasks",
        icon: ListCheck,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.hasTaskFlow,
      },
      {
        label: "My Leaves & Overtime",
        link: "/offsets",
        icon: Clock,
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
        label: "Group Tasks",
        link: "/group-tasks",
        icon: UsersRound,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.hasTaskFlow,
        exactMatch: true,
      },
      {
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
        label: "SOR Register",
        link: "/opportunities",
        icon: Target,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.isHr || ctx.hasSalesFlow,
      },
    ],
  },
  approvals: {
    key: "approvals",
    label: "Approvals",
    defaultExpanded: true,
    links: [
      {
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
        label: "HR Verifications",
        link: "/approvals/hr-verification",
        icon: ShieldCheck,
        badgeKey: "hrVerifications",
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.isHr,
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
        label: "Employee Directory",
        link: "/hr/management",
        icon: Users,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.isHr,
      },
      {
        label: "Leaves Manager",
        link: "/hr/offsets",
        icon: Clock,
        badgeKey: "leaveApprovals",
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.isHr,
      },
      {
        label: "HR Master Log",
        link: "/hr-master-log",
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
      {
        label: "System Admin",
        link: "/super-admin",
        icon: Crown,
        isPermitted: (ctx) => ctx.isSuperAdmin,
        exactMatch: true,
      },
      {
        label: "Activity Log",
        link: "/super-admin/activity-log",
        icon: ClipboardList,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.isHr,
      },
    ],
  },
};

/**
 * Normalizes user object into a clean context object for permission checking.
 */
export function buildUserPermissionContext(user) {
  const isSuperAdmin = !!(user?.is_super_admin || user?.isSuperAdmin);
  const isHead = !!(user?.is_head || user?.isHead);
  const isHr = !!(user?.is_hr || user?.isHr);
  const hasSalesFlow = !!(user?.has_sales_flow ?? user?.hasSalesFlow);
  const hasTaskFlow = !!(user?.has_task_flow ?? user?.hasTaskFlow);
  const subDepartment = user?.subDepartment || user?.sub_department || null;
  const canManage = isHead || isSuperAdmin;

  return {
    user,
    isSuperAdmin,
    isHead,
    isHr,
    hasSalesFlow,
    hasTaskFlow,
    subDepartment,
    canManage,
  };
}

/**
 * Returns the navigation groups filtered by the given user's permissions.
 * Groups with zero visible links are omitted.
 */
export function getFilteredNavigationGroups(user) {
  const ctx = buildUserPermissionContext(user);

  return Object.values(NAV_MODULES)
    .map((module) => {
      const visibleLinks = module.links.filter((link) => link.isPermitted(ctx));
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
        label: "Log Task",
        icon: SquarePen,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.hasTaskFlow,
      },
      {
        id: "offset",
        label: "Apply Leave / Overtime",
        icon: Clock,
        isPermitted: () => true,
      },
    ],
  },
  {
    category: "Operations",
    items: [
      {
        id: "group-task",
        label: "Create Group Task",
        icon: UsersRound,
        isPermitted: (ctx) => ctx.isSuperAdmin || (ctx.canManage && ctx.hasTaskFlow),
      },
    ],
  },
  {
    category: "Sales",
    items: [
      {
        id: "sor",
        label: "Register SOR",
        icon: Target,
        isPermitted: (ctx) => ctx.isSuperAdmin || ctx.isHr || ctx.hasSalesFlow,
      },
    ],
  },
];

/**
 * Returns categorized quick actions filtered by user role.
 * Categories with zero permitted items are excluded.
 */
export function getFilteredQuickActions(user) {
  const ctx = buildUserPermissionContext(user);

  return QUICK_ACTIONS.map((group) => {
    const visibleItems = group.items.filter((item) => item.isPermitted(ctx));
    return {
      category: group.category,
      items: visibleItems,
    };
  }).filter((group) => group.items.length > 0);
}

