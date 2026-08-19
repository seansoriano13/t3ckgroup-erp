import { parseChecklist } from "@/utils/checklist";

/**
 * Group task template helpers — pure transforms with no Supabase call, same
 * split as checklist.js. These translate between the DB shape a template row
 * comes back in (snake_case, employee_id/task_description/...) and the
 * modal's local member-draft shape (camelCase, employeeId/taskDescription/...
 * plus UI-only fields like isRemoving).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Blank member-draft shape, matching CreateGroupTaskModal's makeMember(). */
export const makeMemberDraft = () => ({
  id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  employeeId: null,
  taskDescription: "",
  checklist: null,
  showChecklist: false,
  role: "",
  customRole: "",
  isRemoving: false,
});

/**
 * Maps a template's slots into member-draft rows.
 *
 * A slot's bound employee is treated as deactivated if it is not present in
 * `employees` — that list already excludes soft-deleted rows
 * (employeeService.getAllEmployees filters is_deleted), so no extra query is
 * needed to tell "gone" from "still active". A deactivated slot is left
 * blank rather than silently kept or blocking the whole template.
 */
export function applyTemplateToMembers(template, employees) {
  const activeIds = new Set((employees || []).map((e) => e.id));
  let skippedCount = 0;

  const members = (template.members || []).map((m) => {
    const rawEmployeeId = m.employeeId ?? m.employee_id ?? null;
    const isActive = rawEmployeeId && activeIds.has(rawEmployeeId);
    if (rawEmployeeId && !isActive) skippedCount += 1;

    const parsed = parseChecklist(m.checklist);
    const validItems = parsed
      .filter((i) => i?.text?.trim())
      .map((i) => ({ text: i.text.trim(), checked: false }));

    const checklist = validItems.length > 0 ? validItems : null;

    return {
      ...makeMemberDraft(),
      employeeId: isActive ? rawEmployeeId : null,
      taskDescription: m.task_description ?? m.taskDescription ?? "",
      checklist,
      showChecklist: !!checklist,
      role: m.role || "",
      customRole: m.custom_role ?? m.customRole ?? "",
    };
  });

  return { members, skippedCount };
}

/**
 * Fills title/description/dueDate from a template.
 * Overwrites with the template's defaults when defined on the template.
 */
export function applyTemplateDefaults(template, current = {}) {
  const next = { ...current };

  if (template.title != null && template.title.trim() !== "") {
    next.title = template.title;
  }
  if (template.description != null && template.description.trim() !== "") {
    next.description = template.description;
  }
  if (template.due_date_offset_days != null) {
    next.dueDate = new Date(Date.now() + template.due_date_offset_days * DAY_MS);
  }

  return next;
}

/** True when the draft has anything worth confirming-before-replace over. */
export function hasDraftContent(members, headerInfo = {}) {
  const hasHeaderContent =
    !!headerInfo.title?.trim() ||
    !!headerInfo.description?.trim() ||
    !!headerInfo.dueDate;

  const hasMemberContent = (members || []).some(
    (m) =>
      m.employeeId ||
      m.taskDescription?.trim() ||
      (m.checklist && parseChecklist(m.checklist).some((i) => i?.text?.trim())),
  );

  return hasHeaderContent || hasMemberContent;
}

/** Whole-day offset from today to `dueDate`, for saving a template. */
export function computeDueDateOffsetDays(dueDate) {
  if (!dueDate) return null;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const startOfDue = new Date(dueDate).setHours(0, 0, 0, 0);
  return Math.round((startOfDue - startOfToday) / DAY_MS);
}
