import { GROUP_TASK_STATUS, TASK_STATUS } from "@/constants/status";

const ALL_STATUSES = { value: "ALL", label: "All statuses" };

// The real `tasks.status` values.
export const TASK_STATUS_OPTIONS = [
  ALL_STATUSES,
  { value: TASK_STATUS.INCOMPLETE, label: "Incomplete" },
  { value: TASK_STATUS.AWAITING_APPROVAL, label: "Awaiting approval" },
  { value: TASK_STATUS.COMPLETE, label: "Completed" },
  { value: TASK_STATUS.NOT_APPROVED, label: "Not approved" },
  { value: TASK_STATUS.ON_HOLD, label: "On hold" },
  { value: TASK_STATUS.CANCELLED, label: "Cancelled" },
  { value: TASK_STATUS.DELETED, label: "Deleted" },
];

// The real `committee_tasks.status` values.
export const GROUP_TASK_STATUS_OPTIONS = [
  ALL_STATUSES,
  { value: GROUP_TASK_STATUS.ACTIVE, label: "Active" },
  { value: GROUP_TASK_STATUS.AWAITING_EVALUATION, label: "Awaiting evaluation" },
  { value: GROUP_TASK_STATUS.HR_PENDING, label: "HR pending" },
  { value: GROUP_TASK_STATUS.HR_VERIFIED, label: "HR verified" },
  { value: GROUP_TASK_STATUS.ON_HOLD, label: "On hold" },
  { value: GROUP_TASK_STATUS.CANCELLED, label: "Cancelled" },
];
