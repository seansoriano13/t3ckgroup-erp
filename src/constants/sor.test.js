import { describe, expect, it } from "vitest"
import {
  formatLeadSource,
  formatPHP,
  isValidSalesReference,
  normalizeSalesReference,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STATUS,
  PROJECT_TYPE_LABELS,
  PROJECT_TYPE_SHORT,
  requiresSalesReference,
  STAGE_LABELS,
} from "./sor"

/**
 * Sales Opportunity Registration rules, fixed by policy CCPR-2026-001. These
 * gate whether a deal may advance and how money is shown to salespeople, so the
 * expected values here come from the policy text quoted in sor.js, not from
 * re-running the implementation.
 */
describe("sales reference validation", () => {
  it("accepts an Odoo quotation number", () => {
    expect(isValidSalesReference("S01237")).toBe(true)
  })

  it("accepts a reference typed in lower case or with stray spaces", () => {
    expect(isValidSalesReference("  s01237 ")).toBe(true)
    expect(normalizeSalesReference("  s01237 ")).toBe("S01237")
  })

  it("rejects anything that is not S followed by digits", () => {
    expect(isValidSalesReference("01237")).toBe(false)
    expect(isValidSalesReference("S")).toBe(false)
    expect(isValidSalesReference("SO1237")).toBe(false)
    expect(isValidSalesReference("S01237-A")).toBe(false)
    expect(isValidSalesReference("QS01237")).toBe(false)
  })

  it("rejects an empty or missing reference", () => {
    expect(isValidSalesReference("")).toBe(false)
    expect(isValidSalesReference(null)).toBe(false)
    expect(isValidSalesReference(undefined)).toBe(false)
  })

  it("normalises a missing value to an empty string rather than throwing", () => {
    expect(normalizeSalesReference(null)).toBe("")
    expect(normalizeSalesReference(undefined)).toBe("")
  })
})

describe("stage gating on sales reference", () => {
  it("requires a reference to leave Lead for any active stage", () => {
    expect(requiresSalesReference("LEAD", "QUALIFIED")).toBe(true)
    expect(requiresSalesReference("LEAD", "PROPOSAL_SUBMITTED")).toBe(true)
    expect(requiresSalesReference("LEAD", "CLOSED_WON")).toBe(true)
  })

  it("lets a lead be closed as lost before it was ever quoted", () => {
    expect(requiresSalesReference("LEAD", "CLOSED_LOST")).toBe(false)
  })

  it("does not gate a move that stays in Lead", () => {
    expect(requiresSalesReference("LEAD", "LEAD")).toBe(false)
  })

  it("does not gate moves between later stages", () => {
    // Rows registered before the field existed keep advancing.
    expect(requiresSalesReference("QUALIFIED", "AWARDED")).toBe(false)
    expect(requiresSalesReference("NEGOTIATION", "CLOSED_LOST")).toBe(false)
    expect(requiresSalesReference("AWARDED", "PO_RECEIVED")).toBe(false)
  })
})

describe("pipeline definition", () => {
  it("lists the twelve Annex C.3 stages in policy order", () => {
    expect(OPPORTUNITY_STAGES.map((s) => s.value)).toEqual([
      "LEAD",
      "QUALIFIED",
      "PROPOSAL_SUBMITTED",
      "BID_SUBMITTED",
      "NEGOTIATION",
      "AWARDED",
      "PO_RECEIVED",
      "PROJECT_DELIVERY",
      "COLLECTION",
      "CLOSED_WON",
      "RETENTION",
      "CLOSED_LOST",
    ])
  })

  it("gives every stage a human label", () => {
    expect(STAGE_LABELS[OPPORTUNITY_STATUS.PROPOSAL_SUBMITTED]).toBe("Proposal Submitted")
    expect(STAGE_LABELS[OPPORTUNITY_STATUS.PO_RECEIVED]).toBe("PO Received")
    expect(STAGE_LABELS[OPPORTUNITY_STATUS.CLOSED_LOST]).toBe("Closed Lost")
  })

  it("labels the three sales divisions", () => {
    expect(PROJECT_TYPE_LABELS.SSP).toBe("SSP — Single Salesperson Project")
    expect(PROJECT_TYPE_SHORT.STRATEGIC).toBe("Strategic")
  })
})

describe("formatPHP", () => {
  it("renders a peso amount with two decimals and thousands separators", () => {
    expect(formatPHP(1234.5)).toBe("₱1,234.50")
    expect(formatPHP(1000000)).toBe("₱1,000,000.00")
  })

  it("renders zero for a missing amount instead of NaN", () => {
    expect(formatPHP(null)).toBe("₱0.00")
    expect(formatPHP(undefined)).toBe("₱0.00")
    expect(formatPHP("")).toBe("₱0.00")
  })

  it("accepts the numeric string Postgres returns for a numeric column", () => {
    expect(formatPHP("2500.75")).toBe("₱2,500.75")
  })

  it("rounds to two decimals", () => {
    expect(formatPHP(0.005)).toBe("₱0.01")
    expect(formatPHP(99.999)).toBe("₱100.00")
  })
})

describe("formatLeadSource", () => {
  const leadSources = [
    { value: "LGU", label: "LGU" },
    { value: "REPEAT_CLIENT", label: "Repeat Client" },
  ]

  it("resolves the label from the dynamic lead source register", () => {
    expect(formatLeadSource("REPEAT_CLIENT", null, leadSources)).toBe("Repeat Client")
  })

  it("appends the free-text detail when one was recorded", () => {
    expect(formatLeadSource("LGU", "Quezon City", leadSources)).toBe("LGU - Quezon City")
  })

  it("falls back to the raw value for a source no longer in the register", () => {
    expect(formatLeadSource("EXHIBITION", null, leadSources)).toBe("EXHIBITION")
  })

  it("shows a dash when there is no source at all", () => {
    expect(formatLeadSource(null, null, leadSources)).toBe("—")
  })

  it("works before the register has loaded", () => {
    expect(formatLeadSource("LGU", null)).toBe("LGU")
  })
})
