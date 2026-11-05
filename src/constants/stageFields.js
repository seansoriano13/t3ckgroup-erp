/**
 * Stage Fields — the SOR fields a Stage may ask for (issue #203).
 *
 * Named once, here, so the Fields tab's picker and `missingStageFields`
 * (constants/stageGate.js) agree on exactly what "an sor-source field" can
 * mean. Deliberately small: the Client PO Date is not offered (Q49 — it's
 * meant to be entered once, at the point of award, not repeated per Stage),
 * and neither are the money and people fields on the SOR itself — those keep
 * their own dedicated surfaces (the item list, Deal Team). A custom Stage
 * Field can still be a `currency` or an `employee` (spec #907, ticket #893),
 * kept per Stage Visit.
 */

export const SOR_STAGE_FIELDS = {
  expected_award_date: { label: "Expected Award Date", inputType: "date" },
  sales_reference: { label: "Sales Reference", inputType: "text" },
  contact_person: { label: "Contact Person", inputType: "text" },
  client_name: { label: "Company", inputType: "text" },
}

export const SOR_STAGE_FIELD_KEYS = Object.keys(SOR_STAGE_FIELDS)

export const isSorStageField = (key) => SOR_STAGE_FIELD_KEYS.includes(key)

/** Custom Stage Field input types (issue #203) — kept per Stage Visit, not written to the SOR. */
export const CUSTOM_FIELD_TYPES = {
  TEXT: "text",
  NUMBER: "number",
  DATE: "date",
  CHOICE: "choice",
  CURRENCY: "currency",
  EMPLOYEE: "employee",
}

export const CUSTOM_FIELD_TYPE_VALUES = Object.values(CUSTOM_FIELD_TYPES)

/**
 * Reads what a user typed as a `currency` amount: a finite number, stored as a
 * JSON number. Returns `null` when it is not a plain number, so the caller can
 * say why. Thousands commas, spaces and a peso sign are allowed, so
 * "1,370,535.74" and "₱1370535.74" read as the same amount. Never throws, so
 * it is safe on render paths.
 */
export function parseCurrencyValue(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  const cleaned = String(raw ?? "").replace(/[₱,\s]/g, "")
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  return Number(cleaned)
}

/** Shows a saved `currency` value as pesos, e.g. "₱1,370,535.74". A value that is not a number shows as it was saved. */
export function formatCurrencyValue(value) {
  const amount = typeof value === "number" ? value : parseCurrencyValue(value)
  if (amount === null) return String(value ?? "")
  return `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Shows a saved custom value for its field type. An `employee` value is an
 * employee id, shown as that person's name. A value saved before the type
 * changed (typed text) is shown exactly as it was, as read-only history.
 */
export function formatStageFieldValue(fieldType, value, employeeNames = {}) {
  if (value === null || value === undefined) return ""
  if (fieldType === CUSTOM_FIELD_TYPES.CURRENCY) return formatCurrencyValue(value)
  if (fieldType === CUSTOM_FIELD_TYPES.EMPLOYEE) return employeeNames[value] ?? String(value)
  return String(value)
}
