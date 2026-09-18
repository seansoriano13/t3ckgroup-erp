/**
 * Stage Fields — the SOR fields a Stage may ask for (issue #203).
 *
 * Named once, here, so the Fields tab's picker and `missingStageFields`
 * (constants/stageGate.js) agree on exactly what "an sor-source field" can
 * mean. Deliberately small: the Client PO Date is not offered (Q49 — it's
 * meant to be entered once, at the point of award, not repeated per Stage),
 * and neither are money fields or people — those already have their own
 * dedicated surfaces (the item list, Deal Team) and letting a Stage Field
 * shadow them would create two ways to set the same thing.
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
}

export const CUSTOM_FIELD_TYPE_VALUES = Object.values(CUSTOM_FIELD_TYPES)
