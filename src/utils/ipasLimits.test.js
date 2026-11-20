import { describe, expect, it } from "vitest"
import { amountSizeIssue, boxWeightIssue, contentQuantityIssue, formatKg, textLengthIssue } from "./ipasLimits"

describe("ipasLimits", () => {
  it("refuses a text over the limit with a sentence, and trims before counting", () => {
    expect(textLengthIssue("x".repeat(61), "P.I #", 60)).toBe("P.I # can be at most 60 characters.")
    expect(textLengthIssue("x".repeat(60), "P.I #", 60)).toBeNull()
    expect(textLengthIssue(`  ${"x".repeat(60)}  `, "P.I #", 60)).toBeNull()
    expect(textLengthIssue("x".repeat(2001), "Remarks", 2000)).toBe("Remarks can be at most 2,000 characters.")
  })

  it("refuses a P.I/QT Amount over 9,999,999,999.99", () => {
    expect(amountSizeIssue(9_999_999_999.99)).toBeNull()
    expect(amountSizeIssue(1e15)).toBe("P.I/QT Amount is at most 9,999,999,999.99.")
  })

  it("words box weights and content quantities", () => {
    expect(boxWeightIssue("")).toBeNull()
    expect(boxWeightIssue("5000")).toBeNull()
    expect(boxWeightIssue("5001")).toBe("A box can weigh at most 5,000 kg.")
    expect(boxWeightIssue("-1")).toBe("A box can't weigh less than 0 kg.")
    expect(contentQuantityIssue("0")).toBe("Every content needs a quantity above zero.")
    expect(contentQuantityIssue("100001")).toBe("A content's quantity is at most 100,000.")
    expect(contentQuantityIssue("100000")).toBeNull()
  })

  it("shows weights with separators", () => {
    expect(formatKg(1250)).toBe("1,250.00 kg")
    expect(formatKg(12.5)).toBe("12.50 kg")
    expect(formatKg(null)).toBe("")
  })
})
