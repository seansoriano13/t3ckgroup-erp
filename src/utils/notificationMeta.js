/**
 * notificationMeta.js
 * Read-only view of NOTIFICATION_TARGETS for the bell and the popup: which
 * module and icon a type shows, and which bell tab a module lands in.
 * The entries themselves are edited in notificationTargets.js.
 */
import { NOTIFICATION_TARGETS } from "./notificationTargets";

// Pre-rename rows (see LEGACY_TYPE_ALIASES in notificationRouter.js) keep the look of their GROUP_* twin.
const COMMITTEE_TWINS = {
  COMMITTEE_TASK_COMMENT: "GROUP_TASK_COMMENT",
  COMMITTEE_ASSIGNED: "GROUP_ASSIGNED",
  COMMITTEE_TASK_READY_FOR_HR: "GROUP_TASK_READY_FOR_HR",
  COMMITTEE_MEMBER_DONE: "GROUP_MEMBER_DONE",
};

/** Bell tabs, in order. `modules` are the map modules each tab shows. */
export const MODULE_TABS = [
  { value: "TASKS", label: "TASKS", modules: ["tasks", "chat"] },
  { value: "SORS", label: "SORS", modules: ["sors"] },
  { value: "PURCHASING", label: "PURCHASING", modules: ["purchasing"] },
  // Meetings are calendar/HR business. "other" (bug reports, old rows) shows under All and Unread only.
  { value: "HR", label: "HR", modules: ["hr", "meetings"] },
];

/** { module, icon } for a notification type. Unknown types are "other" with the Bell. */
export function getNotificationMeta(type) {
  const entry = NOTIFICATION_TARGETS[type] ?? NOTIFICATION_TARGETS[COMMITTEE_TWINS[type]];
  return { module: entry?.module ?? "other", icon: entry?.icon ?? "Bell" };
}

/** True when a notification of this type belongs under the given tab value. */
export function typeInTab(type, tabValue) {
  const tab = MODULE_TABS.find((t) => t.value === tabValue);
  return !!tab && tab.modules.includes(getNotificationMeta(type).module);
}
