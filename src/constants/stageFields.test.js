import { describe, expect, it } from "vitest"
import {
  isSorStageField,
  SOR_STAGE_FIELD_KEYS,
  SOR_STAGE_FIELDS,
  CUSTOM_FIELD_TYPE_VALUES,
} from "./stageFields"

describe("stageFields", () => {
  it("offers exactly the four SOR fields issue #203 names", () => {
    expect(SOR_STAGE_FIELD_KEYS.sort()).toEqual(
      ["client_name", "contact_person", "expected_award_date", "sales_reference"].sort(),
    )
  })

  it("does not offer the Client PO Date, money fields, or people", () => {
    expect(SOR_STAGE_FIELDS.po_date).toBeUndefined()
    expect(SOR_STAGE_FIELDS.expected_value).toBeUndefined()
    expect(SOR_STAGE_FIELDS.deal_owner_id).toBeUndefined()
  })

  it("isSorStageField recognizes only the offered keys", () => {
    expect(isSorStageField("expected_award_date")).toBe(true)
    expect(isSorStageField("po_date")).toBe(false)
  })

  it("names the four custom field types", () => {
    expect(CUSTOM_FIELD_TYPE_VALUES.sort()).toEqual(["choice", "date", "number", "text"])
  })
})
