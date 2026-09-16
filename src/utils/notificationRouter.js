/**
 * notificationRouter.js
 * Centralised deep-link routing logic for notification clicks.
 * Extracted from NotificationDrawer so the component stays lean.
 */
import { getPermissionContext } from "./permissions";

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
 * @param {object} notif   - The notification object
 * @param {object} user    - The current auth user
 * @param {function} navigate - react-router navigate fn
 * @param {function} onClose  - Drawer close callback
 */
export function handleNotificationRoute(notif, user, navigate, onClose) {
  if (!notif.reference_id) return;

  // TODO: remove alongside LEGACY_TYPE_ALIASES.
  const type = LEGACY_TYPE_ALIASES[notif.type] ?? notif.type;
  notif = notif.type === type ? notif : { ...notif, type };

  if (notif.type === "GROUP_TASK_COMMENT") {
    navigate("/group-tasks");
    window.dispatchEvent(
      new CustomEvent("OPEN_CHAT_MODAL", {
        detail: {
          entityId: notif.reference_id,
          entityType: "GROUP_TASK",
        },
      }),
    );
  } else if (
    notif.type === "GROUP_ASSIGNED" ||
    notif.type === "GROUP_TASK_READY_FOR_HR" ||
    notif.type === "GROUP_MEMBER_DONE"
  ) {
    navigate("/group-tasks");
    window.dispatchEvent(
      new CustomEvent("OPEN_ENTITY_DETAILS", {
        detail: { id: notif.reference_id, type: "GROUP_TASK" },
      }),
    );
  } else if (notif.type.includes("TASK")) {
    const { isHr: isHrUser, isHead: isHeadUser, isSuperAdmin: isSA } = getPermissionContext(user);

    if (notif.type === "TASK_APPROVED_BY_HEAD" && isHrUser) {
      navigate("/approvals/hr-verification", {
        state: { openTaskId: notif.reference_id },
      });
    } else if (isHeadUser || isSA) {
      navigate("/approvals/tasks", {
        state: { openTaskId: notif.reference_id },
      });
    } else if (isHrUser) {
      navigate("/approvals/hr-verification", {
        state: { openTaskId: notif.reference_id },
      });
    } else {
      navigate("/tasks", { state: { openTaskId: notif.reference_id } });
    }
  } else if (notif.type.startsWith("OPPORTUNITY_")) {
    navigate("/crm", {
      state: { openOpportunityId: notif.reference_id },
    });
  }

  onClose();
}
