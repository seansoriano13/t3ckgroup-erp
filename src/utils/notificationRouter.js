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

  if (notif.type === "BUG_REPORT_SUBMITTED" || notif.type === "BUG_REPORT_NOTE") {
    navigate(`/bug-reports?record=${encodeURIComponent(notif.reference_id)}`);
  } else if (notif.type.startsWith("PURCHASE_REQUEST_")) {
    // Purchase Request notifications (#307): reference_id is the request.
    // Before the generic `includes("TASK")` branch, though no type here may
    // contain "TASK" anyway. The Purchase Requests list opens the request named
    // by `?request=`.
    // #309: a modal over the current page, no navigation.
    window.dispatchEvent(
      new CustomEvent("OPEN_ENTITY_DETAILS", {
        detail: { id: notif.reference_id, type: "PURCHASE_REQUEST" },
      }),
    );
  } else if (notif.type === "GROUP_TASK_COMMENT") {
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
    notif.type === "TASK_MENTION" ||
    notif.type === "GROUP_TASK_MENTION"
  ) {
    // A mention happens inside a Chat thread, not the task/group-task detail
    // view. Without this branch these fall through to the generic
    // `includes("TASK")` handler below, which sends TASK_MENTION to the task
    // list (or an approvals queue the recipient may not even have access to)
    // and sends GROUP_TASK_MENTION's committee-task reference_id to the
    // personal /tasks page, which can't find it in the "tasks" table at all —
    // the click silently does nothing.
    const entityType =
      notif.type === "GROUP_TASK_MENTION" ? "GROUP_TASK" : "TASK";
    navigate(entityType === "GROUP_TASK" ? "/group-tasks" : "/tasks");
    window.dispatchEvent(
      new CustomEvent("OPEN_CHAT_MODAL", {
        detail: {
          entityId: notif.reference_id,
          entityType,
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
  } else if (notif.type.startsWith("SOR_")) {
    // `SOR_STAGE_PARTICIPANT_ADDED` (ADR 0021) is the ONLY way a Stage
    // Participant reaches the deal: `sor_read` has no participant clause, so
    // the SOR never appears in their register.
    //
    // It deliberately does NOT go through /sors like OPPORTUNITY_ below. That
    // route hands the id to the register, whose deep-link fetch is
    // `getOpportunityById` — a plain `.single()` on `sales_opportunities`,
    // which RLS returns no row for at participant or locked access. It throws,
    // `selected` stays null, and `isOpen={!!selected}` keeps the modal shut:
    // the notification would appear to do nothing at all.
    //
    // GlobalDetailManager (mounted in SideNav, so present on every signed-in
    // page) opens the modal through `getOpportunityForModal`, which branches on
    // access level and reads `sor_participant_record` / `sor_locked_summary`
    // instead. Same event `SorLink` uses to open an SOR from a task.
    window.dispatchEvent(
      new CustomEvent("OPEN_ENTITY_DETAILS", {
        detail: { id: notif.reference_id, type: "OPPORTUNITY" },
      }),
    );
  } else if (notif.type === "OPPORTUNITY_MENTION") {
    // Same reason as SOR_* above: the register's deep-link fetch is a plain
    // `.single()` that RLS empties for anyone outside the deal team (an old
    // pipeline SOR notifies every live mention), so the click did nothing.
    // The global modal branches on access level instead.
    window.dispatchEvent(
      new CustomEvent("OPEN_ENTITY_DETAILS", {
        detail: { id: notif.reference_id, type: "OPPORTUNITY" },
      }),
    );
  } else if (notif.type.startsWith("OPPORTUNITY_")) {
    navigate("/sors", {
      state: { openOpportunityId: notif.reference_id },
    });
  }

  onClose();
}
