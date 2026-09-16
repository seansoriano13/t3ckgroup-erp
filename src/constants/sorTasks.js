import { GROUP_MEMBER_STATUS, TASK_STATUS } from "./status";
import { isTaskDeleted, visitOwnsTask } from "./journey";

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
    done: m.status === GROUP_MEMBER_STATUS.DONE,
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

/**
 * The Now tab's rows (#299): what the SOR's current Stage Visit is carrying,
 * not every task it has ever had — #207's Now "shows only the current Stage
 * Visit", and the earlier visits' tasks are the Journey's to list. Ownership
 * is `visitOwnsTask`, the same rule the Journey uses, so a task never shows
 * in Now and under a past visit at once.
 *
 * `visit` is null for a pipeline deal, which never opens a Stage Visit; there
 * is nothing to scope by, so it keeps every task the way the old modal did.
 */
export function currentVisitTaskRows({ individualTasks = [], groupTasks = [] } = {}, visit) {
  const belongs = (task) => !isTaskDeleted(task) && (!visit || visitOwnsTask(task, visit));
  return taskRows({ individualTasks: individualTasks.filter(belongs), groupTasks: groupTasks.filter(belongs) });
}
