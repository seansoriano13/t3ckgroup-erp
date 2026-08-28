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
  TextCursorInput,
  CheckSquare,
  UserCheck,
  Timer,
  Calculator,
  Users,
  User,
  ListChecks,
  ShoppingCart,
} from "lucide-react"

import { CONDITION_KINDS } from "../../constants/stageGate"

export const CONDITION_KIND_META = {
  [CONDITION_KINDS.ATTACHMENT]: {
    label: "Attachment",
    icon: Paperclip,
    hint: "A document has to be on the record.",
  },
  [CONDITION_KINDS.FIELD]: {
    label: "Field on record",
    icon: TextCursorInput,
    hint: "A column on the deal has to be filled in.",
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
  [CONDITION_KINDS.PROJECT_EVALUATION]: {
    label: "Project Evaluation",
    icon: Calculator,
    hint: "A Project Evaluation has to exist for the deal. Sign-off is not required.",
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
}

/**
 * The configured detail worth reading at a glance — the column a `field`
 * condition watches, the document a `attachment` wants, the day count on a
 * deadline. Null when the kind carries nothing beyond its label.
 */
export function conditionDetail(condition) {
  const config = condition?.config ?? {}
  switch (condition?.kind) {
    case CONDITION_KINDS.FIELD:
      return config.column || null
    case CONDITION_KINDS.ATTACHMENT:
      return config.documentType || "Any document"
    case CONDITION_KINDS.ASSIGNMENT:
      return config.department || "Anyone"
    case CONDITION_KINDS.DEADLINE:
      return Number.isFinite(Number(config.days)) && Number(config.days) > 0
        ? `${config.days} day${Number(config.days) === 1 ? "" : "s"}`
        : null
    case CONDITION_KINDS.PROJECT_EVALUATION:
      return config.referenceLink || null
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
  return (typeof named === "string" && named.trim()) || "Untitled action"
}

/** The one line worth reading under an action's title. */
export function actionSummary(action) {
  const config = action?.config ?? {}
  const label = ACTION_KIND_META[action?.kind]?.label ?? action?.kind ?? ""

  if (action?.kind === "create_group_task") {
    const count = config.members?.length ?? 0
    return count > 0 ? `${label} · ${count} assignee${count === 1 ? "" : "s"}` : label
  }
  if (config.priority) return `${label} · ${String(config.priority).toLowerCase()} priority`
  return label
}
