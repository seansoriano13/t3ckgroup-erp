/**
 * notificationRouter.js
 * Centralised deep-link routing logic for notification clicks.
 * Extracted from NotificationDrawer so the component stays lean.
 */

/**
 * @param {object} notif   - The notification object
 * @param {object} user    - The current auth user
 * @param {function} navigate - react-router navigate fn
 * @param {function} onClose  - Drawer close callback
 */
export function handleNotificationRoute(notif, user, navigate, onClose) {
  if (!notif.reference_id) return;

  if (notif.type === "COMMITTEE_TASK_COMMENT") {
    navigate("/committee");
    window.dispatchEvent(
      new CustomEvent("OPEN_CHAT_MODAL", {
        detail: {
          entityId: notif.reference_id,
          entityType: "COMMITTEE_TASK",
        },
      }),
    );
  } else if (
    notif.type === "COMMITTEE_ASSIGNED" ||
    notif.type === "COMMITTEE_TASK_READY_FOR_HR" ||
    notif.type === "COMMITTEE_MEMBER_DONE"
  ) {
    navigate("/committee");
    window.dispatchEvent(
      new CustomEvent("OPEN_ENTITY_DETAILS", {
        detail: { id: notif.reference_id, type: "COMMITTEE_TASK" },
      }),
    );
  } else if (notif.type.includes("TASK")) {
    const isHrUser = user?.isHr || user?.is_hr;
    const isHeadUser = user?.isHead || user?.is_head;
    const isSA = user?.isSuperAdmin || user?.is_super_admin;

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
    navigate("/opportunities", {
      state: { openOpportunityId: notif.reference_id },
    });
  }

  onClose();
}
