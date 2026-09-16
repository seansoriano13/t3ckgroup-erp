/**
 * What the registration form builder is allowed to change.
 *
 * The built-in default fields of the SOR registration form
 * (`OpportunityFormModal`), described here so the builder, the form and the
 * service all read one list rather than three that can drift.
 *
 * Three tiers, and the tier is the whole rule:
 *
 *   core      — relabel and reorder only. Never hidden, never optional. These
 *               are `required` on the form and back NOT NULL columns, so
 *               hiding one yields a form that passes the builder and fails on
 *               submit.
 *   optional  — fully customizable: relabel, reorder, hide, require.
 *   fixed     — not in the builder at all. The Ownership block is out of
 *               scope for now, and Sales Division/Registration Date are
 *               derived or stamped rather than typed, so "customizing" them
 *               would misdescribe what they are.
 *
 * Ownership deliberately has no entries here. Absence is how it stays out.
 */

export const FORM_FIELD_TIERS = {
  CORE: "core",
  OPTIONAL: "optional",
}

/** The built-in fields the builder may touch, in their default order. */
export const SOR_FORM_DEFAULT_FIELDS = [
  { key: "sales_reference", label: "Sales Reference", inputType: "text", tier: "optional" },
  { key: "lead_source", label: "Lead Source", inputType: "choice", tier: "core" },
  { key: "client_name", label: "Company", inputType: "text", tier: "core" },
  { key: "contact_person", label: "Contact Person", inputType: "text", tier: "core" },
  { key: "project_title", label: "Project", inputType: "text", tier: "core" },
  { key: "expected_award_date", label: "Expected Award Date", inputType: "date", tier: "optional" },
  { key: "lead_source_detail", label: "Referral", inputType: "text", tier: "optional" },
]

// Deliberately absent: ITB Number. It is an SOR field, but it has never been
// on the *registration* form — it is filled in later, from the deal's own
// screen. Listing it here would silently add a field to every registration
// form the moment the builder shipped, which is a change to the default, not a
// customization of it. The default must be what the form actually was.

export const SOR_FORM_DEFAULT_KEYS = SOR_FORM_DEFAULT_FIELDS.map((f) => f.key)

const byKey = Object.fromEntries(SOR_FORM_DEFAULT_FIELDS.map((f) => [f.key, f]))

export const formDefaultField = (key) => byKey[key] || null

export const isFormDefaultKey = (key) => Object.hasOwn(byKey, key)

/** Core fields may be relabelled and reordered, never hidden or made optional. */
export const isCoreFormField = (key) => byKey[key]?.tier === FORM_FIELD_TIERS.CORE

/** Custom registration field input types — same four as a custom Stage Field. */
export const FORM_FIELD_TYPES = ["text", "number", "date", "choice"]

/**
 * The flow's form, resolved: the built-in defaults with any customization
 * applied, then the flow's custom fields, all in one ordered list.
 *
 * Pure, so the builder's preview and the registration form itself can render
 * from the identical result rather than each deriving its own. A default with
 * no row is returned untouched — that absence is what "restorable by default"
 * is built on.
 */
export function resolveFormFields(rows = []) {
  const live = rows.filter((r) => !r.archived_at)
  const overrideByKey = Object.fromEntries(
    live.filter((r) => r.source === "default").map((r) => [r.default_key, r]),
  )

  const defaults = SOR_FORM_DEFAULT_FIELDS.map((field, index) => {
    const override = overrideByKey[field.key]
    const core = field.tier === FORM_FIELD_TIERS.CORE
    return {
      ...field,
      source: "default",
      id: override?.id ?? null,
      label: override?.label?.trim() || field.label,
      help: override?.help || null,
      // A core field ignores a stored hidden/optional flag rather than
      // trusting it: a row written before the guard existed, or by hand,
      // must not be able to break registration.
      isHidden: core ? false : Boolean(override?.is_hidden),
      isRequired: core ? true : Boolean(override?.is_required),
      sortOrder: override?.sort_order ?? index,
    }
  })

  const customs = live
    .filter((r) => r.source === "custom")
    .map((r) => ({
      key: r.id,
      id: r.id,
      source: "custom",
      label: r.label,
      help: r.help || null,
      inputType: r.field_type,
      options: r.options || [],
      isHidden: Boolean(r.is_hidden),
      isRequired: Boolean(r.is_required),
      sortOrder: r.sort_order ?? SOR_FORM_DEFAULT_FIELDS.length,
    }))

  return [...defaults, ...customs].sort((a, b) => a.sortOrder - b.sortOrder)
}
