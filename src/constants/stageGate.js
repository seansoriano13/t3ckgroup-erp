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
 * updateStage, does not read stage_conditions, and does not write
 * sor_condition_status — those are ticket 2 and ticket 5's job. Everything
 * here is the shared logic both the live gate check and a historical/audit
 * read can call, told apart by the `asOf` timestamp each passes in (see
 * evaluateCondition).
 */

import { stageByCode } from "./sor"

export const CONDITION_KINDS = {
  ATTACHMENT: "attachment",
  FIELD: "field",
  TICKBOX: "tickbox",
  ASSIGNMENT: "assignment",
  DEADLINE: "deadline",
  // Issue #50: gates on a Project Evaluation (issue #48) existing for the
  // deal. Existence alone satisfies it — sign-off is recorded but never
  // required, the decision needs an owner, not a second approval step.
  PROJECT_EVALUATION: "project_evaluation",
  INCLUSIONS: "inclusions",
  PURCHASING: "purchasing",
}

/**
 * The kinds offered when adding a *new* condition (issue #203): Field on
 * record and Project Evaluation are gone outright; Inclusions and the old
 * Purchasing kind are hidden pending the Purchase Requests spec, though a
 * condition already using one keeps evaluating. Shared by
 * `stageConditionService`'s own validation and the picker's dropdown, so the
 * two lists can't quietly drift apart.
 */
export const NEW_CONDITION_KINDS = [
  CONDITION_KINDS.ATTACHMENT,
  CONDITION_KINDS.TICKBOX,
  CONDITION_KINDS.ASSIGNMENT,
  CONDITION_KINDS.DEADLINE,
]

export const CONDITION_STATUS = {
  SATISFIED: "satisfied",
  UNSATISFIED: "unsatisfied",
  // Absence is the answer, not a gap: a condition created after the SOR
  // already crossed its Stage never applied to it (D18, D41), and an
  // archived condition stops applying from the moment it is archived.
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
 * Conditions that can actually stand in the way of a move: active, marked
 * required, and not a `deadline` — deadlines never gate by kind, regardless
 * of is_required (D42).
 */
export function blockingConditions(conditions = []) {
  return conditions.filter(
    (r) => !r.archived_at && r.is_required && r.kind !== CONDITION_KINDS.DEADLINE,
  )
}

function isNonEmpty(value) {
  return value !== null && value !== undefined && String(value).trim() !== ""
}

const notApplicable = () => ({
  status: CONDITION_STATUS.NOT_APPLICABLE,
  satisfiedBy: null,
  satisfiedAt: null,
})
const unsatisfied = () => ({
  status: CONDITION_STATUS.UNSATISFIED,
  satisfiedBy: null,
  satisfiedAt: null,
})
const satisfied = (satisfiedBy = null, satisfiedAt = null) => ({
  status: CONDITION_STATUS.SATISFIED,
  satisfiedBy,
  satisfiedAt,
})

/**
 * Whether a single condition is satisfied, unsatisfied, or never applied,
 * as of a point in time.
 *
 * `asOf` is the crossing being evaluated: "now" for a live move (ticket 2
 * passes the current time), or a Stage's historical entry time for an audit
 * read (ticket 6/story 32). A condition whose `created_at` is after `asOf`
 * never applied to that crossing — its absence is correct, not missing data.
 * Callers that don't care about that distinction (a live check evaluated the
 * instant a condition is read back will never trip it) can omit `asOf`.
 *
 * - **attachment** and **field** are evaluated live against the record — no
 *   status row, because the record itself is the evidence and can change
 *   (emptying a field un-satisfies it).
 * - **assignment** is evaluated live against the SOR's members.
 * - **tickbox** is satisfied iff a status row exists — it has no other
 *   evidence, so the row IS the certification.
 * - **deadline** is always reported satisfied here because it never gates;
 *   call `deadlineStatus` for its actual display/notify state.
 * - **project_evaluation** and **field** are removed kinds (issue #203):
 *   evaluated as not_applicable regardless of record state, so an SOR still
 *   carrying one from an older flow version is never stranded by a kind that
 *   no longer exists. `field`'s old evidence (a hidden SOR column or
 *   metadata key) is not read here any more — see Stage Fields
 *   (`missingStageFields`, below) for the kind that replaces it.
 *
 * Assignment resolves against `who` (issue #203): a list of
 * `{ type: "employee"|"group"|"team", id }` selectors, met when any SOR
 * member resolves into one of them. `member.groupIds`/`member.teamId` carry
 * that resolution — this module doesn't itself know what a group or team
 * contains. The legacy `config.department` match stays for conditions saved
 * before #203 that never got a `who`.
 *
 * Attachment resolves against `config.accepts` (issue #203): a list of file
 * type keys (see `src/utils/attachments.js`), met only by an attachment
 * tagged with this condition's own id (`attachment.conditionId`) whose type
 * is in the list — or any type when the list is empty ("Any", the default).
 * The legacy `config.documentType` match stays for conditions saved before
 * #203, and does not require `conditionId` tagging.
 */
export function evaluateCondition(condition, {
  // Issue #203 removed the last case (`field`) that read the record
  // directly — kept in the signature so every existing caller's argument
  // object shape stays valid unchanged.
  opportunity: _opportunity = {},
  attachments = [],
  members = [],
  statusRow = null,
  asOf = null,
  hasInclusions = false,
  hasPurchasing = false,
} = {}) {
  if (condition.archived_at) return notApplicable()
  if (asOf && condition.created_at && condition.created_at > asOf) return notApplicable()

  switch (condition.kind) {
    case CONDITION_KINDS.ATTACHMENT: {
      const documentType = condition.config?.documentType ?? null
      if (documentType) {
        const match = attachments.find((a) => a.documentType === documentType)
        return match ? satisfied(match.uploadedBy ?? null, match.uploadedAt ?? null) : unsatisfied()
      }
      const accepts = Array.isArray(condition.config?.accepts) ? condition.config.accepts : []
      const match = attachments.find(
        (a) => a.conditionId === condition.id && (accepts.length === 0 || accepts.includes(a.type)),
      )
      return match ? satisfied(match.uploadedBy ?? null, match.uploadedAt ?? null) : unsatisfied()
    }
    case CONDITION_KINDS.FIELD: {
      return notApplicable()
    }
    case CONDITION_KINDS.ASSIGNMENT: {
      const department = condition.config?.department ?? null
      if (department) {
        const match = members.find((m) => m.department === department)
        return match
          ? satisfied(match.employeeId ?? match.employee_id ?? null, match.assignedAt ?? null)
          : unsatisfied()
      }
      const who = Array.isArray(condition.config?.who) ? condition.config.who : []
      if (who.length === 0) return unsatisfied()
      const match = members.find((m) =>
        who.some((selector) => {
          if (selector.type === "employee") return (m.employeeId ?? m.employee_id) === selector.id
          if (selector.type === "group") return (m.groupIds ?? []).includes(selector.id)
          if (selector.type === "team") return m.teamId === selector.team
          return false
        }),
      )
      return match
        ? satisfied(match.employeeId ?? match.employee_id ?? null, match.assignedAt ?? null)
        : unsatisfied()
    }
    case CONDITION_KINDS.TICKBOX: {
      return statusRow ? satisfied(statusRow.satisfied_by ?? null, statusRow.satisfied_at ?? null) : unsatisfied()
    }
    case CONDITION_KINDS.DEADLINE: {
      return satisfied()
    }
    case CONDITION_KINDS.PROJECT_EVALUATION: {
      return notApplicable()
    }
    case CONDITION_KINDS.INCLUSIONS: {
      return hasInclusions ? satisfied() : unsatisfied()
    }
    case CONDITION_KINDS.PURCHASING: {
      return hasPurchasing ? satisfied() : unsatisfied()
    }
    default:
      return unsatisfied()
  }
}

/**
 * Stage Fields (issue #203) that block leaving: required fields with no
 * value, in `flow_stage_fields` sort order. `visitValues` maps a custom
 * field's id to the current visit's saved value; an `sor`-source field reads
 * `opportunity[sorField]` directly, since it writes straight through
 * (#199's single-field write) rather than through a visit row. Pure and
 * synchronous, same shape as `blockingConditions` — the caller decides what
 * to do with a non-empty result (`moveAlongFlow`'s "Fill in: …").
 */
export function missingStageFields(stageFields = [], { opportunity = {}, visitValues = {} } = {}) {
  return (stageFields || []).filter((field) => {
    if (field.archived_at) return false
    if (!field.is_required) return false
    const value =
      field.source === "sor" ? opportunity[field.sor_field] : visitValues[field.id]
    return !isNonEmpty(value)
  })
}

/**
 * How close to breaching counts as "approaching" for a notification (ticket
 * 7, D42's "a notification fires as the date approaches and again when it
 * passes") — not specified by the spec beyond that phrase, so fixed here at
 * a flat 3 days regardless of the condition's own day count. Both
 * statutory examples (10 and 12 days) leave a multi-day window at 3, rather
 * than the boundary day being the only warning anyone gets.
 */
export const DEADLINE_APPROACHING_DAYS = 3

/**
 * Deadline arithmetic: days remaining (negative once breached), whether the
 * deadline has been breached, and whether it's close enough to warn about —
 * from a Stage's entry timestamp and the condition's configured day count.
 * The boundary day itself — exactly `days` days after entry — is not yet
 * breached; the day after is.
 *
 * Every deadline in this spec is a calendar-day count (RA 12009 and the
 * Philippine Bidding Documents count calendar days), so no business-day
 * arithmetic is implemented.
 */
export function deadlineStatus(condition, { enteredAt, asOf } = {}) {
  const days = condition.config?.days
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
 * condition on those Stages that is not satisfied. `conditionsByStage`
 * maps a Stage code to its conditions; `statusRowsByCondition` maps a
 * condition id to its `sor_condition_status` row, if any.
 */
export function evaluateCrossing({
  fromCode,
  toCode,
  stages = [],
  conditionsByStage = {},
  opportunity = {},
  attachments = [],
  members = [],
  statusRowsByCondition = {},
  asOf = null,
  hasInclusions = false,
  hasPurchasing = false,
}) {
  const crossed = stagesCrossed(fromCode, toCode, stages)
  const missing = []

  for (const stage of crossed) {
    const conditions = blockingConditions(conditionsByStage[stage.code] ?? [])
    for (const condition of conditions) {
      const result = evaluateCondition(condition, {
        opportunity,
        attachments,
        members,
        statusRow: statusRowsByCondition[condition.id] ?? null,
        asOf,
        hasInclusions,
        hasPurchasing,
      })
      if (result.status === CONDITION_STATUS.UNSATISFIED) {
        missing.push({ stage, condition })
      }
    }
  }

  return { crossed, missing, blocked: missing.length > 0 }
}
