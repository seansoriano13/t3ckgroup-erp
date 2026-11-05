import { describe, expect, it } from "vitest"
import {
  isSorStageField,
  SOR_STAGE_FIELD_KEYS,
  SOR_STAGE_FIELDS,
  CUSTOM_FIELD_TYPE_VALUES,
  parseCurrencyValue,
  formatCurrencyValue,
  formatStageFieldValue,
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

  it("names the six custom field types, including currency and employee (ticket #893)", () => {
    expect(CUSTOM_FIELD_TYPE_VALUES.sort()).toEqual(
      ["choice", "currency", "date", "employee", "number", "text"].sort(),
    )
  })
})

describe("parseCurrencyValue", () => {
  it.each([
    ["1370535.74", 1370535.74],
    ["1,370,535.74", 1370535.74],
    ["₱1,000", 1000],
    [" 250 ", 250],
    [0, 0],
    [42, 42],
  ])("reads %j as %d", (raw, expected) => {
    expect(parseCurrencyValue(raw)).toBe(expected)
  })

  it.each(["1,370,535.74 pesos", "abc", "", "   ", null, undefined, NaN, Infinity, "1.2.3"])(
    "refuses %j",
    (raw) => {
      expect(parseCurrencyValue(raw)).toBeNull()
    },
  )
})

describe("formatCurrencyValue", () => {
  it("shows a number as pesos with two decimals and thousands separators", () => {
    expect(formatCurrencyValue(1370535.74)).toBe("₱1,370,535.74")
  })

  it("shows an old free-text amount exactly as it was saved", () => {
    expect(formatCurrencyValue("1,370,535.74 pesos")).toBe("1,370,535.74 pesos")
  })
})

describe("formatStageFieldValue", () => {
  it("shows an employee value as the person's name", () => {
    expect(formatStageFieldValue("employee", "emp-1", { "emp-1": "Juan Dela Cruz" })).toBe("Juan Dela Cruz")
  })

  it("falls back to the saved text for a legacy typed name", () => {
    expect(formatStageFieldValue("employee", "Juan Dela Cruz", {})).toBe("Juan Dela Cruz")
  })

  it("leaves number and text fields as plain text", () => {
    expect(formatStageFieldValue("number", 7, {})).toBe("7")
    expect(formatStageFieldValue("text", "hello", {})).toBe("hello")
  })
})
