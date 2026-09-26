import { CONDITION_STATUS } from "./stageGate"
import { GROUP_TASK_STATUS, TASK_STATUS } from "./status"

/**
 * A task that no longer owes the Stage anything. A Group Task past its
 * members' work sits in the HR hand-off (`groupTaskService` moves it to
 * HR_PENDING then HR_VERIFIED), which is finished as far as the Stage Visit
 * that raised it is concerned — counting those as open would leave a closed
 * visit reading as unfinished forever.
 */
const SETTLED_TASK_STATUSES = new Set([
  TASK_STATUS.COMPLETE,
  TASK_STATUS.DELETED,
  GROUP_TASK_STATUS.HR_PENDING,
  GROUP_TASK_STATUS.HR_VERIFIED,
])

export function isTaskOpen(task) {
  return !SETTLED_TASK_STATUSES.has(task?.status) && task?.status !== TASK_STATUS.ON_HOLD
}

/**
 * A deleted task never blocked or reported on anything, so neither the Now
 * tab nor a Journey visit lists it — one rule for both, not two filters that
 * can drift apart.
 */
export function isTaskDeleted(task) {
  return task?.status === TASK_STATUS.DELETED
}

/**
 * A condition still owed. Not-applicable is not owed: it never applied to
 * this SOR, and counting it would leave a finished Stage reading as
 * unfinished forever.
 */
export function isConditionOutstanding(row) {
  return row?.status === CONDITION_STATUS.UNSATISFIED
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
  // #296: a restricted visit carries no conditions/tasks to count — RLS
  // already stripped them — so its summary line says exactly that instead
  // of misreading "nothing outstanding" as "there is nothing here".
  if (visit?.isRestricted) {
    return {
      stageName: visit?.stage?.name || "This stage",
      bracket: visit?.stage?.bracket || null,
      enteredAt: visit?.enteredAt || null,
      enteredBy: visit?.enteredBy || null,
      outstandingConditions: 0,
      openTasks: 0,
      isRestricted: true,
      line: "This stage is restricted",
    }
  }

  const outstanding = (visit?.conditions || []).filter(isConditionOutstanding).length
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
    isRestricted: false,
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
      // A restricted visit never expands either — #296, there is nothing
      // behind it to open once RLS has stripped its contents.
      isExpanded: !isCurrent && !visit.isRestricted && expanded.has(visit.id),
      summary: isCurrent ? visitSummary(visit) : null,
    }
  })
}
