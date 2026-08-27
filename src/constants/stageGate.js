/**
 * Stage Gate Engine — pure evaluation.
 *
 * No database, no network: every value comes in as an argument and every
 * result goes out as a plain object. Prior art: constants/sor.js ↔
 * sor.test.js, utils/commission.js ↔ commission.test.js.
 *
 * Source: docs/stage-gate-engine-spec.md.
 * Ticket: .scratch/stage-gate-engine/issues/01-schema-and-evaluation-engine.md
 *
 * This module answers what the gate needs asked of it; it does not call
 * updateStage, does not read stage_requirements, and does not write
 * sor_requirement_status — those are ticket 2 and ticket 5's job. Everything
 * here is the shared logic both the live gate check and a historical/audit
 * read can call, told apart by the `asOf` timestamp each passes in (see
 * evaluateRequirement).
 */

import { stageByCode } from "./sor"

export const REQUIREMENT_KINDS = {
  ATTACHMENT: "attachment",
  FIELD: "field",
  TICKBOX: "tickbox",
  ASSIGNMENT: "assignment",
  DEADLINE: "deadline",
  // Issue #50: gates on a Project Evaluation (issue #48) existing for the
  // deal. Existence alone satisfies it — sign-off is recorded but never
  // required, the decision needs an owner, not a second approval step.
  PROJECT_EVALUATION: "project_evaluation",
}

export const REQUIREMENT_STATUS = {
  SATISFIED: "satisfied",
  UNSATISFIED: "unsatisfied",
  // Absence is the answer, not a gap: a requirement created after the SOR
  // already crossed its Stage never applied to it (D18, D41), and an
  // archived requirement stops applying from the moment it is archived.
  NOT_APPLICABLE: "not_applicable",
}

/**
 * Every Stage a move from `fromCode` to `toCode` crosses: the Stage being
 * left and every Stage passed over — `[from, to)` — per the spec's
 * load-bearing decision that the gate evaluates the whole crossing, not just
 * the destination. A backward move, a same-Stage move, or a code the stage
 * list does not recognise crosses nothing, the same fail-safe direction
 * sor.js already takes for an unknown code.
 */
export function stagesCrossed(fromCode, toCode, stages = []) {
  const from = stageByCode(fromCode, stages)
  const to = stageByCode(toCode, stages)
  if (!from || !to) return []
  if (to.sort_order <= from.sort_order) return []

  return stages
    .filter((s) => s.sort_order >= from.sort_order && s.sort_order < to.sort_order)
    .sort((a, b) => a.sort_order - b.sort_order)
}

/**
 * Requirements that can actually stand in the way of a move: active, marked
 * required, and not a `deadline` — deadlines never gate by kind, regardless
 * of is_required (D42).
 */
export function blockingRequirements(requirements = []) {
  return requirements.filter(
    (r) => !r.archived_at && r.is_required && r.kind !== REQUIREMENT_KINDS.DEADLINE,
  )
}

function isNonEmpty(value) {
  return value !== null && value !== undefined && String(value).trim() !== ""
}

const notApplicable = () => ({
  status: REQUIREMENT_STATUS.NOT_APPLICABLE,
  satisfiedBy: null,
  satisfiedAt: null,
})
const unsatisfied = () => ({
  status: REQUIREMENT_STATUS.UNSATISFIED,
  satisfiedBy: null,
  satisfiedAt: null,
})
const satisfied = (satisfiedBy = null, satisfiedAt = null) => ({
  status: REQUIREMENT_STATUS.SATISFIED,
  satisfiedBy,
  satisfiedAt,
})

/**
 * Whether a single requirement is satisfied, unsatisfied, or never applied,
 * as of a point in time.
 *
 * `asOf` is the crossing being evaluated: "now" for a live move (ticket 2
 * passes the current time), or a Stage's historical entry time for an audit
 * read (ticket 6/story 32). A requirement whose `created_at` is after `asOf`
 * never applied to that crossing — its absence is correct, not missing data.
 * Callers that don't care about that distinction (a live check evaluated the
 * instant a requirement is read back will never trip it) can omit `asOf`.
 *
 * - **attachment** and **field** are evaluated live against the record — no
 *   status row, because the record itself is the evidence and can change
 *   (emptying a field un-satisfies it).
 * - **assignment** is evaluated live against the SOR's members.
 * - **tickbox** is satisfied iff a status row exists — it has no other
 *   evidence, so the row IS the certification.
 * - **deadline** is always reported satisfied here because it never gates;
 *   call `deadlineStatus` for its actual display/notify state.
 * - **project_evaluation** is satisfied iff `hasProjectEvaluation` is true —
 *   evaluated live against whether a Project Evaluation row exists for the
 *   deal (issue #48), the same way `field` is evaluated live against the
 *   record rather than a status row.
 */
export function evaluateRequirement(requirement, {
  opportunity = {},
  attachments = [],
  members = [],
  statusRow = null,
  asOf = null,
  hasProjectEvaluation = false,
} = {}) {
  if (requirement.archived_at) return notApplicable()
  if (asOf && requirement.created_at && requirement.created_at > asOf) return notApplicable()

  switch (requirement.kind) {
    case REQUIREMENT_KINDS.ATTACHMENT: {
      const documentType = requirement.config?.documentType ?? null
      const match = attachments.find((a) => !documentType || a.documentType === documentType)
      return match ? satisfied(match.uploadedBy ?? null, match.uploadedAt ?? null) : unsatisfied()
    }
    case REQUIREMENT_KINDS.FIELD: {
      const column = requirement.config?.column
      const value = column ? opportunity[column] : undefined
      return isNonEmpty(value) ? satisfied() : unsatisfied()
    }
    case REQUIREMENT_KINDS.ASSIGNMENT: {
      const department = requirement.config?.department ?? null
      const match = members.find((m) => !department || m.department === department)
      return match ? satisfied(match.employeeId ?? match.employee_id ?? null, match.assignedAt ?? null) : unsatisfied()
    }
    case REQUIREMENT_KINDS.TICKBOX: {
      return statusRow ? satisfied(statusRow.satisfied_by ?? null, statusRow.satisfied_at ?? null) : unsatisfied()
    }
    case REQUIREMENT_KINDS.DEADLINE: {
      return satisfied()
    }
    case REQUIREMENT_KINDS.PROJECT_EVALUATION: {
      return hasProjectEvaluation ? satisfied() : unsatisfied()
    }
    default:
      return unsatisfied()
  }
}

/**
 * How close to breaching counts as "approaching" for a notification (ticket
 * 7, D42's "a notification fires as the date approaches and again when it
 * passes") — not specified by the spec beyond that phrase, so fixed here at
 * a flat 3 days regardless of the requirement's own day count. Both
 * statutory examples (10 and 12 days) leave a multi-day window at 3, rather
 * than the boundary day being the only warning anyone gets.
 */
export const DEADLINE_APPROACHING_DAYS = 3

/**
 * Deadline arithmetic: days remaining (negative once breached), whether the
 * deadline has been breached, and whether it's close enough to warn about —
 * from a Stage's entry timestamp and the requirement's configured day count.
 * The boundary day itself — exactly `days` days after entry — is not yet
 * breached; the day after is.
 *
 * Every deadline in this spec is a calendar-day count (RA 12009 and the
 * Philippine Bidding Documents count calendar days), so no business-day
 * arithmetic is implemented.
 */
export function deadlineStatus(requirement, { enteredAt, asOf } = {}) {
  const days = requirement.config?.days
  if (!enteredAt || !asOf || !Number.isFinite(days)) {
    return { daysRemaining: null, isBreached: false, isApproaching: false }
  }

  const msPerDay = 24 * 60 * 60 * 1000
  const due = new Date(enteredAt).getTime() + days * msPerDay
  const daysRemaining = Math.ceil((due - new Date(asOf).getTime()) / msPerDay)
  const isBreached = daysRemaining < 0
  const isApproaching = !isBreached && daysRemaining <= DEADLINE_APPROACHING_DAYS
  return { daysRemaining, isBreached, isApproaching }
}

/**
 * The full gate check for one move: every Stage crossed, and every blocking
 * requirement on those Stages that is not satisfied. `requirementsByStage`
 * maps a Stage code to its requirements; `statusRowsByRequirement` maps a
 * requirement id to its `sor_requirement_status` row, if any.
 */
export function evaluateCrossing({
  fromCode,
  toCode,
  stages = [],
  requirementsByStage = {},
  opportunity = {},
  attachments = [],
  members = [],
  statusRowsByRequirement = {},
  asOf = null,
  hasProjectEvaluation = false,
}) {
  const crossed = stagesCrossed(fromCode, toCode, stages)
  const missing = []

  for (const stage of crossed) {
    const requirements = blockingRequirements(requirementsByStage[stage.code] ?? [])
    for (const requirement of requirements) {
      const result = evaluateRequirement(requirement, {
        opportunity,
        attachments,
        members,
        statusRow: statusRowsByRequirement[requirement.id] ?? null,
        asOf,
        hasProjectEvaluation,
      })
      if (result.status === REQUIREMENT_STATUS.UNSATISFIED) {
        missing.push({ stage, requirement })
      }
    }
  }

  return { crossed, missing, blocked: missing.length > 0 }
}
