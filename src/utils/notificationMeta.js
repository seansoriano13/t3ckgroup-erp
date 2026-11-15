/**
 * notificationMeta.js
 * Read-only view of NOTIFICATION_TARGETS for the bell and the popup: which
 * module and icon a type shows, and which bell tab a module lands in.
 * The entries themselves are edited in notificationTargets.js.
 */
import { LEGACY_TYPE_ALIASES, NOTIFICATION_TARGETS } from "./notificationTargets";

/** Bell tabs, in order. `modules` are the map modules each tab shows. */
export const MODULE_TABS = [
  { value: "TASKS", label: "TASKS", modules: ["tasks", "chat"] },
  { value: "SORS", label: "SORS", modules: ["sors"] },
  { value: "PURCHASING", label: "PURCHASING", modules: ["purchasing"] },
  // Meetings are calendar/HR business. "other" (bug reports, old rows) shows under All and Unread only.
  { value: "HR", label: "HR", modules: ["hr", "meetings"] },
];

/**
 * The bell tabs this person sees: All and Unread for everyone, and a module tab
 * only when they can have notifications of that module. HR and Super Admin see
 * every tab. Leave, Offset and Meeting notices reach anyone, so HR is always there.
 */
export function tabsFor(ctx) {
  const all = ctx.isHr || ctx.isSuperAdmin;
  const shows = {
    TASKS: all || ctx.hasTaskFlow,
    SORS: all || ctx.hasSalesFlow,
    PURCHASING: all || ctx.hasPurchasingFlow || ctx.hasSalesFlow || ctx.hasFinanceFlow,
    HR: true,
  };
  return [
    { value: "ALL", label: "ALL" },
    { value: "UNREAD", label: "UNREAD" },
    ...MODULE_TABS.filter((t) => shows[t.value]).map(({ value, label }) => ({ value, label })),
  ];
}

/** { module, icon } for a notification type. Unknown types are "other" with the Bell. */
export function getNotificationMeta(type) {
  const entry = NOTIFICATION_TARGETS[type] ?? NOTIFICATION_TARGETS[LEGACY_TYPE_ALIASES[type]];
  return { module: entry?.module ?? "other", icon: entry?.icon ?? "Bell" };
}

/** True when a notification of this type belongs under the given tab value. */
export function typeInTab(type, tabValue) {
  const tab = MODULE_TABS.find((t) => t.value === tabValue);
  return !!tab && tab.modules.includes(getNotificationMeta(type).module);
}
