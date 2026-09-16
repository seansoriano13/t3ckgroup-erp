import { CONDITION_STATUS } from "./stageGate"
import { TASK_STATUS } from "./status"

/**
 * A task that no longer owes the Stage anything. A Group Task past its
 * members' work sits in the HR hand-off (`groupTaskService` moves it to
 * HR_PENDING then HR_VERIFIED), which is finished as far as the Stage Visit
 * that raised it is concerned — counting those as open would leave a closed
 * visit reading as unfinished forever.
 */
const SETTLED_TASK_STATUSES = new Set([TASK_STATUS.COMPLETE, TASK_STATUS.DELETED, "HR_PENDING", "HR_VERIFIED"])

export function isTaskOpen(task) {
  return !SETTLED_TASK_STATUSES.has(task?.status)
}

/**
 * Whether a task belongs to a Stage Visit.
 *
 * #204 stamps `stage_visit_id` on every task a Stage Action creates, and that
 * stamp is the answer whenever it is there — a task stamped to another visit
 * is that visit's, never this one's, even if the windows overlap. Only a task
 * predating the column falls back to when it was created, and that window is
 * half-open on purpose: the instant the SOR left already belongs to the next
 * visit, so a loop back doesn't claim the task that closed the last visit.
 */
export function visitOwnsTask(task, visit) {
  if (!task || !visit) return false
  if (task.stage_visit_id) return task.stage_visit_id === visit.id

  const createdAt = Date.parse(task.created_at)
  const enteredAt = Date.parse(visit.enteredAt)
  if (Number.isNaN(createdAt) || Number.isNaN(enteredAt)) return false
  if (createdAt < enteredAt) return false

  const leftAt = visit.leftAt ? Date.parse(visit.leftAt) : null
  return leftAt === null || createdAt < leftAt
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`

/**
 * The one line the current visit gets at the top of the Journey (story 12).
 * It is a line and not a panel because Now already owns this visit's detail —
 * the Journey would otherwise repeat the whole tab beside it.
 */
export function visitSummary(visit) {
  const outstanding = (visit?.conditions || []).filter((c) => c.status === CONDITION_STATUS.UNSATISFIED).length
  const openTasks = [...(visit?.tasks || []), ...(visit?.groupTasks || [])].filter(isTaskOpen).length

  const parts = []
  if (outstanding > 0) parts.push(`${plural(outstanding, "condition")} outstanding`)
  if (openTasks > 0) parts.push(`${plural(openTasks, "open task")}`)

  return {
    stageName: visit?.stage?.name || "This stage",
    bracket: visit?.stage?.bracket || null,
    enteredAt: visit?.enteredAt || null,
    enteredBy: visit?.enteredBy || null,
    outstandingConditions: outstanding,
    openTasks,
    line: parts.length > 0 ? parts.join(" · ") : "Nothing outstanding",
  }
}

function byLatestFirst(a, b) {
  if (a.sequence !== b.sequence) return (b.sequence ?? 0) - (a.sequence ?? 0)
  return (Date.parse(b.enteredAt) || 0) - (Date.parse(a.enteredAt) || 0)
}

/**
 * The Journey tab's list, latest first (#300, stories 10/12/13) — from the
 * visits `getJourney` already assembled, so ordering and the current-visit
 * summary are provable without a database.
 *
 * `expandedIds` is the only thing the tab knows that this doesn't: which
 * older visits the reader has opened. Everything else is already on a visit.
 * Nothing else belongs in this argument — a row that needs more should carry
 * it on the visit instead, or the shaper stops being the whole ordering rule.
 */
export function journeyRows(visits = [], { expandedIds = [] } = {}) {
  const expanded = new Set(expandedIds)
  const ordered = [...visits].sort(byLatestFirst)
  // The open visit with the highest sequence, matching `currentVisitFor`'s
  // rule server-side — stated here too so a second open row (a move caught
  // mid-flight) can never produce two summary lines.
  const currentId = ordered.find((visit) => !visit.leftAt)?.id ?? null

  return ordered.map((visit) => {
    const isCurrent = visit.id === currentId
    return {
      visit,
      isCurrent,
      // The current visit never collapses: it has no detail here to hide.
      isExpanded: !isCurrent && expanded.has(visit.id),
      summary: isCurrent ? visitSummary(visit) : null,
    }
  })
}
