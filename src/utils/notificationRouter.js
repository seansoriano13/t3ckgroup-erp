/**
 * notificationRouter.js
 * Centralised deep-link routing logic for notification clicks.
 * Extracted from NotificationDrawer so the component stays lean.
 */
import toast from "react-hot-toast";
import { LEGACY, LEGACY_MESSAGE, LEGACY_TYPE_ALIASES, NO_REFERENCE_MESSAGE, NOTIFICATION_TARGETS } from "./notificationTargets";

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
