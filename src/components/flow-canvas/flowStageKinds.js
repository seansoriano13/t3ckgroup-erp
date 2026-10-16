/**
 * What a Stage's conditions and actions are called, and what they look like.
 *
 * The canvas satellite, the panel's list and the panel's add-form all name the
 * same five condition kinds and two action kinds. Naming them in three places
 * is how "Self-certified" quietly becomes "Tickbox" on one screen only, so the
 * label, the icon and the one-line description of each kind live here.
 */

import {
  Paperclip,
  CheckSquare,
  UserCheck,
  Timer,
  Users,
  User,
  ListChecks,
  ShoppingCart,
  PackageCheck,
  Calculator,
  Database,
  Type,
  Hash,
  CalendarDays,
} from "lucide-react"

import { CONDITION_KINDS } from "../../constants/stageGate"
import { SOR_STAGE_FIELDS } from "../../constants/stageFields"
import { acceptsLabel } from "../../utils/attachments"

/**
 * "Purchasing (group)" / "Ana Reyes" for an assignment condition's `who`
 * (issue #203) — null when there's nothing to summarize (no who and no
 * legacy department), so callers fall back to "Anyone".
 */
function whoLabel(who) {
  if (!Array.isArray(who) || who.length === 0) return null
  return who
    .map((selector) => {
      if (selector.type === "group") return `${selector.label || selector.id} (group)`
      if (selector.type === "team") return `${selector.label || selector.id} (team)`
      return selector.label || selector.id
    })
    .join(", ")
}

export const CONDITION_KIND_META = {
  [CONDITION_KINDS.ATTACHMENT]: {
    label: "Attachment",
    icon: Paperclip,
    hint: "A document has to be on the record.",
  },
  [CONDITION_KINDS.TICKBOX]: {
    label: "Self-certified",
    icon: CheckSquare,
    hint: "Somebody confirms it by hand. The tick is the evidence.",
  },
  [CONDITION_KINDS.ASSIGNMENT]: {
    label: "Assignment",
    icon: UserCheck,
    hint: "Somebody from a department has to be on the deal.",
  },
  [CONDITION_KINDS.DEADLINE]: {
    label: "Deadline",
    icon: Timer,
    hint: "Counts days from Stage entry. Warns and breaches — never blocks.",
  },
  [CONDITION_KINDS.INCLUSIONS]: {
    label: "Inclusions",
    icon: ListChecks,
    hint: "Inclusions must be created. Sign-off is not required.",
  },
  [CONDITION_KINDS.PURCHASING]: {
    label: "Purchasing",
    icon: ShoppingCart,
    hint: "At least one procurement request must exist.",
  },
  [CONDITION_KINDS.PURCHASING_SETTLED]: {
    label: "Purchasing settled",
    icon: PackageCheck,
    hint: "Every Requested Item is closed. Met when there is no Purchase Request.",
  },
}

export const ACTION_KIND_META = {
  create_group_task: {
    label: "Group Task",
    icon: Users,
    hint: "Multiple assignees and checklists.",
  },
  create_individual_task: {
    label: "Individual Task",
    icon: User,
    hint: "One assignee.",
  },
  open_purchase_request: {
    label: "Open Purchase Request",
    icon: ShoppingCart,
    hint: "Starts buying for the SOR. One request per SOR.",
    // Saves no title of its own, so it is named by its label.
    titled: false,
  },
  open_costing_matrix: {
    label: "Open Costing Matrix",
    icon: Calculator,
    hint: "Opens the SOR's Costing Matrix. One per SOR.",
    // Saves no title of its own, so it is named by its label.
    titled: false,
  },
}

/**
 * The configured detail worth reading at a glance — the column a `field`
 * condition watches, the document a `attachment` wants, the day count on a
 * deadline. Null when the kind carries nothing beyond its label.
 */
export function conditionDetail(condition) {
  const config = condition?.config ?? {}
  switch (condition?.kind) {
    case CONDITION_KINDS.ATTACHMENT:
      return config.documentType || acceptsLabel(config.accepts)
    case CONDITION_KINDS.ASSIGNMENT:
      return config.department || whoLabel(config.who) || "Anyone"
    case CONDITION_KINDS.DEADLINE:
      return Number.isFinite(Number(config.days)) && Number(config.days) > 0
        ? `${config.days} day${Number(config.days) === 1 ? "" : "s"}`
        : null
    default:
      return null
  }
}

/**
 * What an action is called.
 *
 * The two kinds store different payloads, because each is exactly what its own
 * modal submits: a group task carries `title`, an individual task carries
 * `projectTitle`. Reading only `config.title` labelled every individual-task
 * automation "Untitled action".
 */
export function actionTitle(action) {
  const config = action?.config ?? {}
  const named = config.title || config.projectTitle
  const meta = ACTION_KIND_META[action?.kind]
  if (!named && meta?.titled === false) return meta.label
  return (typeof named === "string" && named.trim()) || "Untitled action"
}

/**
 * The action's own single assignee, if it has exactly one — a group task
 * with more than one member has no single assignee to compare a Decider
 * against, so `deciderSummary` never shortens to "the assignee" for it.
 */
function actionAssigneeId(action) {
  const config = action?.config ?? {}
  if (action?.kind === "create_group_task") {
    const members = config.members || []
    return members.length === 1 ? (members[0]?.employeeId ?? null) : null
  }
  return config.loggedById ?? null
}

/**
 * The one line worth reading under an action's title.
 *
 * Issue #204 Part 2 — how a "When confirmed" action's Decider reads on the
 * canvas card. Issue #411 — a single named employee was always shortened to
 * "the assignee", even when that employee wasn't who the action assigns the
 * work to; now that shorthand is reserved for when it's actually true, and
 * any other employee is named instead.
 */
function deciderSummary(decider, { employees = [], assigneeId = null } = {}) {
  const selectors = decider || []
  if (selectors.length === 0) return "someone"
  if (selectors.length === 1) {
    const s = selectors[0]
    if (s.type === "role") return String(s.role || "").replace(/_/g, " ") || "someone"
    if (s.type === "team") return `${s.team} Team`
    if (s.type === "group") return "the group"
    if (s.type === "employee") {
      if (assigneeId && s.id === assigneeId) return "the assignee"
      return employees.find((e) => e.id === s.id)?.name || "the assignee"
    }
    return "the assignee"
  }
  return `${selectors.length} people`
}

export function actionSummary(action, { employees = [] } = {}) {
  const config = action?.config ?? {}
  const label = ACTION_KIND_META[action?.kind]?.label ?? action?.kind ?? ""

  let summary = label
  if (action?.kind === "create_group_task") {
    const count = config.members?.length ?? 0
    summary = count > 0 ? `${label} · ${count} assignee${count === 1 ? "" : "s"}` : label
  } else if (action?.kind === "open_costing_matrix") {
    const buyer = config.purchasingIncharge?.id
      ? employees.find((e) => e.id === config.purchasingIncharge.id)?.name ?? "someone no longer listed"
      : null
    summary = buyer ? `${label} · Purchasing: ${buyer}` : `${label} · no Purchasing Incharge named`
  } else if (config.priority) {
    summary = `${label} · ${String(config.priority).toLowerCase()} priority`
  }

  if (config.confirmMode === "confirm") {
    const decides = deciderSummary(config.decider, { employees, assigneeId: actionAssigneeId(action) })
    summary = `${summary} · When confirmed · ${decides} decides`
  }

  return summary
}

/**
 * What a Stage Field is, for its canvas satellite: an SOR field (written to
 * the SOR itself) or a custom one of a given input type. Kept beside the
 * condition and action kinds so the canvas names all three the same way the
 * panel does.
 */
const CUSTOM_FIELD_META = {
  text: { label: "Text", icon: Type },
  number: { label: "Number", icon: Hash },
  date: { label: "Date", icon: CalendarDays },
  choice: { label: "Choice", icon: ListChecks },
}

export function fieldMeta(field) {
  if (field?.source === "sor") return { label: "SOR field", icon: Database }
  return CUSTOM_FIELD_META[field?.field_type] ?? { label: "Custom", icon: Type }
}

/**
 * The satellite's second line: what kind of field it is, and — for a required
 * one — that it blocks leaving the Stage. A required Stage Field blocks the way
 * out but is not a Stage Condition, so it says so here rather than being counted
 * under the Gate.
 */
export function fieldDetail(field) {
  const kind =
    field?.source === "sor"
      ? `SOR field · ${SOR_STAGE_FIELDS[field.sor_field]?.label ?? field.sor_field}`
      : fieldMeta(field).label
  return field?.is_required ? `${kind} · blocks leaving` : kind
}
