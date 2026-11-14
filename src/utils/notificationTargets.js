/**
 * notificationTargets.js
 * One entry per notification type: which module it belongs to, which icon it
 * shows, and where a click on it lands. `handleNotificationRoute` (in
 * notificationRouter.js) is a thin runner over this map.
 *
 * To add a notification type, add ONE entry under its module below. A guard test
 * (notificationTargets.sync.test.js) fails when a type the app writes has no entry.
 *
 * Entry shape:
 *   module  "tasks" | "sors" | "purchasing" | "hr" | "meetings" | "chat" | "other"
 *   icon    a lucide-react icon name (plain data; the bell does not read it yet, #1028)
 *   target  one of:
 *             - a function ({ notif, user, navigate }) that opens the record
 *             - PENDING: a real type whose click target another ticket is still adding
 *             - LEGACY: an old type from a replaced feature; the click says so in one line
 *
 * Entries are grouped by module and kept one per type on purpose, so tickets that
 * fill different entries touch different lines.
 */
import { getPermissionContext } from "./permissions";

export const MODULES = ["tasks", "sors", "purchasing", "hr", "meetings", "chat", "other"];

/** Click target still to be built by another ticket of spec #1013. The click only closes the bell. */
export const PENDING = "pending";
/** Old type from a replaced feature. The click shows LEGACY_MESSAGE. */
export const LEGACY = "legacy";
export const LEGACY_MESSAGE = "This notification is from an older version of the portal.";
export const NO_REFERENCE_MESSAGE = "This notification has nothing to open";

const openEntity = (detail) => window.dispatchEvent(new CustomEvent("OPEN_ENTITY_DETAILS", { detail }));
const openChat = (entityId, entityType) =>
  window.dispatchEvent(new CustomEvent("OPEN_CHAT_MODAL", { detail: { entityId, entityType } }));

// ---- targets shared by several types ----

/** Types that land in an approver's queue (head grade, HR verification). */
const APPROVAL_QUEUE_TYPES = new Set([
  "NEW_TASK_SUBMITTED",
  "TASK_AWAITING_APPROVAL",
  "TASK_SUBMITTED",
  "TASK_APPROVED_BY_HEAD",
]);

/**
 * #1018: an approver's queue item opens as `/approvals/tasks?record=<id>`; any other
 * task opens as `?open=task:<id>` over the page the reader is on (GlobalDetailManager
 * writes the address from this event). Both addresses survive a refresh.
 */
const taskTarget = ({ notif, user, navigate }) => {
  const { isHr, isHead, isSuperAdmin } = getPermissionContext(user);
  if ((isHead || isSuperAdmin || isHr) && APPROVAL_QUEUE_TYPES.has(notif.type)) {
    navigate(`/approvals/tasks?record=${encodeURIComponent(notif.reference_id)}`);
  } else {
    openEntity({ id: notif.reference_id, type: "TASK" });
  }
};

/** A mention happens inside a Chat thread, not the detail view. */
const taskMentionTarget = ({ notif, navigate }) => {
  navigate("/tasks");
  openChat(notif.reference_id, "TASK");
};
const groupChatTarget = ({ notif, navigate }) => {
  navigate("/group-tasks");
  openChat(notif.reference_id, "GROUP_TASK");
};
const groupTaskTarget = ({ notif, navigate }) => {
  navigate("/group-tasks");
  openEntity({ id: notif.reference_id, type: "GROUP_TASK" });
};

/** Opens through the global window, which branches on access level (works outside the deal team). */
const sorTarget = ({ notif }) => openEntity({ id: notif.reference_id, type: "OPPORTUNITY" });
/** #941: a Bid Decision opens the SOR on its PMS tab. */
const sorPmsTarget = ({ notif }) => openEntity({ id: notif.reference_id, type: "OPPORTUNITY", view: "pms" });
/** #706: reference_id is the SOR. Opens the Technical sheet. */
const technicalSheetTarget = ({ notif, navigate }) =>
  navigate(`/technical/${encodeURIComponent(notif.reference_id)}`);

/**
 * #309: a modal over the current page, no navigation. #1019: the window's
 * address is `?open=pr:<id>[&view=chat|items]`, written by GlobalDetailManager
 * from this event.
 */
const purchaseRequestTarget =
  (extra = {}) =>
  ({ notif }) =>
    openEntity({ id: notif.reference_id, type: "PURCHASE_REQUEST", focusChat: false, ...extra });
const ipasTarget = ({ notif, navigate }) => navigate(`/purchasing/ipas/${encodeURIComponent(notif.reference_id)}`);

const bugReportTarget = ({ notif, navigate }) =>
  navigate(`/bug-reports?record=${encodeURIComponent(notif.reference_id)}`);

export const NOTIFICATION_TARGETS = {
  // ---- tasks ----
  NEW_TASK_SUBMITTED: { module: "tasks", icon: "FileText", target: taskTarget },
  TASK_COMMENT: { module: "tasks", icon: "MessageCircle", target: taskTarget },
  TASK_AWAITING_APPROVAL: { module: "tasks", icon: "Clock", target: taskTarget },
  TASK_COMPLETED: { module: "tasks", icon: "CheckCircle2", target: taskTarget },
  TASK_GRADED: { module: "tasks", icon: "CheckCircle2", target: taskTarget },
  TASK_VERIFIED: { module: "tasks", icon: "CheckCircle2", target: taskTarget },
  TASK_ASSIGNED: { module: "tasks", icon: "FileText", target: taskTarget },
  TASK_REJECTED: { module: "tasks", icon: "XCircle", target: taskTarget },
  TASK_APPROVED_BY_HEAD: { module: "tasks", icon: "CheckCircle2", target: taskTarget },
  TASK_REACTION: { module: "tasks", icon: "MessageCircle", target: taskTarget },
  TASK_MENTION: { module: "tasks", icon: "MessageCircle", target: taskMentionTarget },
  TASK_APPROVED: { module: "tasks", icon: "CheckCircle2", target: taskTarget },
  TASK_SUBMITTED: { module: "tasks", icon: "FileText", target: taskTarget },
  PROCUREMENT_TASK_DEAL_LOST: { module: "tasks", icon: "FileText", target: taskTarget },
  TASK_CONVERTED: { module: "tasks", icon: "FileText", target: taskTarget },
  STAGE_ACTION_TASK_CREATED: { module: "tasks", icon: "FileText", target: taskTarget },
  GROUP_ASSIGNED: { module: "tasks", icon: "Target", target: groupTaskTarget },
  GROUP_TASK_COMMENT: { module: "tasks", icon: "MessageCircle", target: groupChatTarget },
  GROUP_TASK_REACTION: { module: "tasks", icon: "MessageCircle", target: groupChatTarget },
  GROUP_TASK_MENTION: { module: "tasks", icon: "MessageCircle", target: groupChatTarget },
  GROUP_TASK_READY_FOR_HR: { module: "tasks", icon: "Target", target: groupTaskTarget },
  GROUP_TASK_AWAITING_EVALUATION: { module: "tasks", icon: "Clock", target: groupTaskTarget },
  GROUP_TASK_EVALUATION_REMINDER: { module: "tasks", icon: "Clock", target: groupTaskTarget },
  GROUP_TASK_REOPENED: { module: "tasks", icon: "Target", target: groupTaskTarget },
  GROUP_MEMBER_DONE: { module: "tasks", icon: "CheckCircle2", target: groupTaskTarget },

  // ---- sors ----
  OPPORTUNITY_STAGE_REVERTED: { module: "sors", icon: "TrendingUp", target: sorTarget },
  OPPORTUNITY_ACTION_DECISION_DUE: { module: "sors", icon: "Briefcase", target: sorTarget },
  OPPORTUNITY_COSTING_INCHARGE_NEEDED: { module: "sors", icon: "Briefcase", target: sorTarget },
  OPPORTUNITY_FOLLOW_UP_DUE: { module: "sors", icon: "Clock", target: sorTarget },
  OPPORTUNITY_STAGE_CHANGED: { module: "sors", icon: "TrendingUp", target: sorTarget },
  OPPORTUNITY_PROCUREMENT_REQUESTED: { module: "sors", icon: "Briefcase", target: sorTarget },
  OPPORTUNITY_PROCUREMENT_RESOLVED: { module: "sors", icon: "Briefcase", target: sorTarget },
  OPPORTUNITY_MENTION: { module: "sors", icon: "MessageCircle", target: sorTarget },
  SOR_AWARDED: { module: "sors", icon: "Trophy", target: sorTarget },
  SOR_BID_DECISION: { module: "sors", icon: "Briefcase", target: sorPmsTarget },
  SOR_STAGE_PARTICIPANT_ADDED: { module: "sors", icon: "Briefcase", target: sorTarget },
  COSTING_EVALUATION_ASSIGNED: { module: "sors", icon: "Briefcase", target: technicalSheetTarget },

  // ---- purchasing ----
  PURCHASE_REQUEST_OPENED: { module: "purchasing", icon: "FileText", target: purchaseRequestTarget() },
  PURCHASE_REQUEST_MESSAGE: {
    module: "purchasing",
    icon: "MessageCircle",
    target: purchaseRequestTarget({ focusChat: false, tab: "chat" }),
  },
  PURCHASE_REQUEST_MENTION: {
    module: "purchasing",
    icon: "MessageCircle",
    target: purchaseRequestTarget({ focusChat: true, tab: "chat" }),
  },
  PURCHASE_REQUEST_ITEM_STATUS: {
    module: "purchasing",
    icon: "FileText",
    target: purchaseRequestTarget({ focusChat: false, tab: "items" }),
  },
  PURCHASE_REQUEST_BUYER_SET: { module: "purchasing", icon: "FileText", target: purchaseRequestTarget({ focusChat: false }) },
  PURCHASE_REQUEST_ORDERED_EARLY: {
    module: "purchasing",
    icon: "FileText",
    target: purchaseRequestTarget({ focusChat: false }),
  },
  IPAS_SIGNOFF_READY: { module: "purchasing", icon: "FileText", target: ipasTarget },
  IPAS_PO_CHANGED: { module: "purchasing", icon: "FileText", target: ipasTarget },
  IPAS_ACCOUNT_FLAGGED: { module: "purchasing", icon: "FileText", target: ipasTarget },
  IPAS_SECTION_3_CLEARED: { module: "purchasing", icon: "FileText", target: ipasTarget },
  PURCHASE_REQUEST_BUYER: { module: "purchasing", icon: "FileText", target: purchaseRequestTarget() },
  PURCHASE_REQUEST_ITEM_ADDED: { module: "purchasing", icon: "FileText", target: purchaseRequestTarget() },
  IPAS_SENT_BACK: { module: "purchasing", icon: "FileText", target: ipasTarget },
  PACKING_LIST_REQUESTED: { module: "purchasing", icon: "FileText", target: PENDING },
  TRANSMITTAL_SUBMITTED: { module: "purchasing", icon: "FileText", target: PENDING },
  TRANSMITTAL_CANCELLED: { module: "purchasing", icon: "FileText", target: PENDING },
  TRANSMITTAL_STAGE_READY: { module: "purchasing", icon: "FileText", target: PENDING },
  TRANSMITTAL_CONFIRM_SIGNATURE: { module: "purchasing", icon: "FileText", target: PENDING },
  TRANSMITTAL_NA_RAISED: { module: "purchasing", icon: "FileText", target: PENDING },
  TRANSMITTAL_CLOSED: { module: "purchasing", icon: "FileText", target: PENDING },
  TRANSMITTAL_SIGNATURE_DECLINED: { module: "purchasing", icon: "FileText", target: PENDING },
  TRANSMITTAL_SIGNATURE_UNDONE: { module: "purchasing", icon: "FileText", target: PENDING },

  // ---- hr ----
  HR_NOTE: { module: "hr", icon: "FileText", target: PENDING },
  SIL_LEAVE_REQUEST: { module: "hr", icon: "Clock", target: PENDING },
  SIL_LEAVE_DECISION: { module: "hr", icon: "CheckCircle2", target: PENDING },
  SIL_LEAVE_HEAD_DECISION: { module: "hr", icon: "CheckCircle2", target: PENDING },
  SIL_LEAVE_CANCELLED: { module: "hr", icon: "XCircle", target: PENDING },
  LWOP_LEAVE_REQUEST: { module: "hr", icon: "Clock", target: PENDING },
  LWOP_LEAVE_DECISION: { module: "hr", icon: "CheckCircle2", target: PENDING },
  LWOP_LEAVE_HEAD_DECISION: { module: "hr", icon: "CheckCircle2", target: PENDING },
  LWOP_LEAVE_CANCELLED: { module: "hr", icon: "XCircle", target: PENDING },
  OFFSET_LEAVE_REQUEST: { module: "hr", icon: "Clock", target: PENDING },
  OFFSET_LEAVE_DECISION: { module: "hr", icon: "CheckCircle2", target: PENDING },
  OFFSET_LEAVE_HEAD_DECISION: { module: "hr", icon: "CheckCircle2", target: PENDING },
  OVERTIME_REQUEST: { module: "hr", icon: "Clock", target: PENDING },
  OVERTIME_DECISION: { module: "hr", icon: "CheckCircle2", target: PENDING },
  OVERTIME_HEAD_DECISION: { module: "hr", icon: "CheckCircle2", target: PENDING },
  UNDERTIME_REQUEST: { module: "hr", icon: "Clock", target: PENDING },
  UNDERTIME_DECISION: { module: "hr", icon: "CheckCircle2", target: PENDING },
  UNDERTIME_HEAD_DECISION: { module: "hr", icon: "CheckCircle2", target: PENDING },

  // ---- meetings ----
  MEETING_REQUEST: { module: "meetings", icon: "Clock", target: PENDING },
  MEETING_REQUEST_DECISION: { module: "meetings", icon: "CheckCircle2", target: PENDING },
  MEETING_APPROVED: { module: "meetings", icon: "CheckCircle2", target: PENDING },
  MEETING_CANCELLED: { module: "meetings", icon: "XCircle", target: PENDING },
  MEETING_CHANGED: { module: "meetings", icon: "Clock", target: PENDING },
  MEETING_REMINDER: { module: "meetings", icon: "Clock", target: PENDING },

  // ---- chat ----
  // (chat mentions live with the record they belong to: TASK_MENTION, PURCHASE_REQUEST_MENTION, ...)

  // ---- other ----
  BUG_REPORT_SUBMITTED: { module: "other", icon: "ShieldAlert", target: bugReportTarget },
  BUG_REPORT_NOTE: { module: "other", icon: "ShieldAlert", target: bugReportTarget },
  // Old rows still in people's bells from features that were replaced (spec #1013, A8).
  UNPLANNED_ACTIVITY: { module: "other", icon: "Bell", target: LEGACY },
  SALES_PLAN_SUBMITTED: { module: "other", icon: "Bell", target: LEGACY },
  SALES_DAY_CONQUERED: { module: "other", icon: "Bell", target: LEGACY },
  SALES_COMMENT: { module: "other", icon: "Bell", target: LEGACY },
  DAY_DELETE_REQUESTED: { module: "other", icon: "Bell", target: LEGACY },
  ACTIVITY_DELETE_REQUESTED: { module: "other", icon: "Bell", target: LEGACY },
  EXPENSE_APPROVED: { module: "other", icon: "Bell", target: LEGACY },
  PLAN_AMENDMENT_RESULT: { module: "other", icon: "Bell", target: LEGACY },
  DAY_DELETE_RESULT: { module: "other", icon: "Bell", target: LEGACY },
  SALES_QUOTA_PUBLISHED: { module: "other", icon: "Bell", target: LEGACY },
};
