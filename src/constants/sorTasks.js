import { TASK_STATUS } from "./status";

/** Faces on a `TaskRow` before the rest collapse into a "+N" chip (#299). */
export const MAX_AVATARS = 4;

/**
 * Both task kinds as one row shape, so `TaskRow` renders a group task and an
 * individual task the same way and the difference stays here (#299). An
 * individual task is modelled as a one-part group: it keeps "parts done"
 * meaningful on every row instead of two different completion vocabularies
 * sitting side by side in the same list.
 */
export function groupTaskRow(task) {
  const members = (task.members || []).map((m) => ({
    id: m.id,
    name: m.employee?.name || "Unassigned",
    avatarPath: m.employee?.avatar_path || null,
    role: m.role || m.custom_role || "Assignee",
    part: m.task_description || "",
    done: m.status === "DONE",
  }));

  return {
    id: task.id,
    kind: "group",
    entityType: "GROUP_TASK",
    title: task.title || "Group Task",
    dueDate: task.due_date || null,
    members,
    doneCount: members.filter((m) => m.done).length,
    totalCount: members.length,
  };
}

export function individualTaskRow(task) {
  const done = task.status === TASK_STATUS.COMPLETE;
  const member = {
    id: task.id,
    name: task.assignee?.name || "Unassigned",
    avatarPath: task.assignee?.avatar_path || null,
    role: "Assignee",
    part: task.task_description || "",
    done,
  };

  return {
    id: task.id,
    kind: "individual",
    entityType: "TASK",
    // An individual task has no title column of its own — the first line of
    // its description is what the task lists everywhere else show.
    title: task.project_title || task.task_description?.split("\n")[0] || "Individual Task",
    dueDate: task.end_at || null,
    members: [member],
    doneCount: done ? 1 : 0,
    totalCount: 1,
  };
}

export function taskRows({ individualTasks = [], groupTasks = [] } = {}) {
  return [...groupTasks.map(groupTaskRow), ...individualTasks.map(individualTaskRow)];
}
