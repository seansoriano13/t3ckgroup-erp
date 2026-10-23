/**
 * Who rates a Group Task.
 *
 * A task made by a Stage Action is created by whoever moved the SOR, but the
 * SOR's Deal Owner rates it: `evaluator_id` names them. Every other task has
 * no evaluator, and its creator rates it.
 */
export function groupTaskEvaluatorId(task) {
  return task?.evaluator_id ?? task?.created_by ?? null;
}

export function isGroupTaskEvaluator(task, employeeId) {
  return Boolean(employeeId) && groupTaskEvaluatorId(task) === employeeId;
}
