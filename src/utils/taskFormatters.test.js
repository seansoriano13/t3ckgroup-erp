import { describe, expect, it } from "vitest"
import {
  extractOthersDetailsFromRemarks,
  formatChecklistToString,
  formatTaskPreview,
  isCategoryMetadataRemarks,
} from "./taskFormatters"

/**
 * A task's description can be plain text, a JSON checklist array, or a titled
 * checklist object — and it arrives either parsed or still as a JSON string,
 * depending on which column and which era of the app wrote it. These helpers
 * are what stop that variety from reaching the UI.
 */
describe("formatTaskPreview", () => {
  it("passes plain text through unchanged", () => {
    expect(formatTaskPreview("Draft the quarterly report")).toBe("Draft the quarterly report")
  })

  it("summarises a checklist array by item count", () => {
    expect(formatTaskPreview([{ text: "a" }, { text: "b" }])).toBe("Checklist: 2 Items")
  })

  it("summarises a checklist array that arrived as a JSON string", () => {
    expect(formatTaskPreview('[{"text":"a"},{"text":"b"},{"text":"c"}]')).toBe(
      "Checklist: 3 Items",
    )
  })

  it("uses the checklist title when the object carries one", () => {
    expect(formatTaskPreview({ title: "Onboarding", items: [{ text: "a" }] })).toBe(
      "Onboarding (1 Items)",
    )
  })

  it("uses the title from a stringified titled checklist", () => {
    expect(formatTaskPreview('{"title":"Onboarding","items":[{"text":"a"},{"text":"b"}]}')).toBe(
      "Onboarding (2 Items)",
    )
  })

  it("falls back to a generic count when a checklist object has no title", () => {
    expect(formatTaskPreview({ items: [{ text: "a" }] })).toBe("Checklist: 1 Items")
  })

  it("returns an empty string for a missing description", () => {
    expect(formatTaskPreview(null)).toBe("")
    expect(formatTaskPreview(undefined)).toBe("")
    expect(formatTaskPreview("")).toBe("")
  })

  it("leaves bracketed text that is not valid JSON alone", () => {
    expect(formatTaskPreview("[URGENT] Fix the printer")).toBe("[URGENT] Fix the printer")
  })

  it("leaves brace-wrapped text that is not valid JSON alone", () => {
    expect(formatTaskPreview("{not json}")).toBe("{not json}")
  })
})

describe("formatChecklistToString", () => {
  it("renders each checklist item as a bullet", () => {
    expect(formatChecklistToString([{ text: "First" }, { text: "Second" }])).toBe(
      "• First\n• Second",
    )
  })

  it("prefixes a titled checklist with its title", () => {
    expect(formatChecklistToString({ title: "Onboarding", items: [{ text: "Sign forms" }] })).toBe(
      "Onboarding\n• Sign forms",
    )
  })

  it("parses a checklist that is still a JSON string", () => {
    expect(formatChecklistToString('[{"text":"First"}]')).toBe("• First")
  })

  it("labels an item with no text so the bullet is never empty", () => {
    expect(formatChecklistToString([{ done: true }])).toBe("• Task")
  })

  it("passes plain text through unchanged", () => {
    expect(formatChecklistToString("Just a sentence")).toBe("Just a sentence")
  })

  it("returns an empty string for a missing description", () => {
    expect(formatChecklistToString(null)).toBe("")
  })
})

describe("extractOthersDetailsFromRemarks", () => {
  it("pulls the free-text detail out of an [OTHERS] remark", () => {
    expect(extractOthersDetailsFromRemarks("[OTHERS] Client site visit")).toBe(
      "Client site visit",
    )
  })

  it("pulls the detail out of a group variant", () => {
    expect(extractOthersDetailsFromRemarks("[GROUP - OTHERS] Budget review")).toBe(
      "Budget review",
    )
  })

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(extractOthersDetailsFromRemarks("  [others] Site visit  ")).toBe("Site visit")
  })

  it("returns null for an ordinary remark", () => {
    expect(extractOthersDetailsFromRemarks("Ran late because of traffic")).toBeNull()
  })

  it("returns null for a missing or non-string remark", () => {
    expect(extractOthersDetailsFromRemarks(null)).toBeNull()
    expect(extractOthersDetailsFromRemarks(42)).toBeNull()
  })

  it("returns null for a tag with no detail after it", () => {
    expect(extractOthersDetailsFromRemarks("[OTHERS]")).toBeNull()
  })
})

describe("isCategoryMetadataRemarks", () => {
  it("recognises remarks that only carry category metadata", () => {
    expect(isCategoryMetadataRemarks("[OTHERS] Client site visit")).toBe(true)
    expect(isCategoryMetadataRemarks("[GROUP - OTHERS] Budget review")).toBe(true)
    expect(isCategoryMetadataRemarks("[GROUP - SAFETY]")).toBe(true)
  })

  it("does not treat a real remark as metadata", () => {
    expect(isCategoryMetadataRemarks("Ran late because of traffic")).toBe(false)
    expect(isCategoryMetadataRemarks("[URGENT] Fix the printer")).toBe(false)
  })

  it("handles a missing remark", () => {
    expect(isCategoryMetadataRemarks(null)).toBe(false)
    expect(isCategoryMetadataRemarks("")).toBe(false)
  })
})
