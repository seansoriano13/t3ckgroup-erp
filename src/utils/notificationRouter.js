/**
 * notificationRouter.js
 * Centralised deep-link routing logic for notification clicks.
 * Extracted from NotificationDrawer so the component stays lean.
 */
import toast from "react-hot-toast";
import { LEGACY, LEGACY_MESSAGE, NO_REFERENCE_MESSAGE, NOTIFICATION_TARGETS } from "./notificationTargets";

/**
 * TODO: transition shim — drop after one release.
 *
 * The COMMITTEE_* notification types were renamed to GROUP_* and existing rows
 * backfilled by 0014_group_task_rename.sql. This app is an SPA, so a client
 * running the pre-rename bundle can still write a COMMITTEE_* row after the
 * backfill has run. Those rows must keep routing, so both spellings are
 * accepted here while only GROUP_* is ever written.
 *
 * Note the fallthrough below is `notif.type.includes("TASK")` — an unmatched
 * COMMITTEE_ASSIGNED misses it entirely and silently no-ops, which is why this
 * shim exists rather than relying on the generic branch.
 *
 * Once no COMMITTEE_* rows remain, delete this map and inline the GROUP_* checks.
 */
const LEGACY_TYPE_ALIASES = {
  COMMITTEE_TASK_COMMENT: "GROUP_TASK_COMMENT",
  COMMITTEE_ASSIGNED: "GROUP_ASSIGNED",
  COMMITTEE_TASK_READY_FOR_HR: "GROUP_TASK_READY_FOR_HR",
  COMMITTEE_MEMBER_DONE: "GROUP_MEMBER_DONE",
};

/**
 * Thin runner: looks the type up in NOTIFICATION_TARGETS (notificationTargets.js)
 * and runs its target. Add or change a click target there, not here.
 *
 * @param {object} notif   - The notification object
 * @param {object} user    - The current auth user
 * @param {function} navigate - react-router navigate fn
 * @param {function} onClose  - Drawer close callback
 */
export function handleNotificationRoute(notif, user, navigate, onClose) {
  if (!notif.reference_id) {
    toast(NO_REFERENCE_MESSAGE);
    onClose();
    return;
  }

  // TODO: remove alongside LEGACY_TYPE_ALIASES.
  const type = LEGACY_TYPE_ALIASES[notif.type] ?? notif.type;
  notif = notif.type === type ? notif : { ...notif, type };

  const entry = NOTIFICATION_TARGETS[notif.type];
  if (typeof entry?.target === "function") {
    entry.target({ notif, user, navigate });
  } else if (!entry || entry.target === LEGACY) {
    // Old type from a replaced feature, or a type nobody gave a target: say so instead of closing silently.
    toast(LEGACY_MESSAGE);
  }

  onClose();
}
