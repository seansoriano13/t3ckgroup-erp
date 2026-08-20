import { describe, expect, it } from "vitest"

import {
    extractOthersDetailsFromRemarks,
    formatChecklistToString,
    formatTaskPreview,
    isCategoryMetadataRemarks,
} from "./taskFormatters"

/**
 * The other half of the task formatters — flattening a checklist for a plain
 * text field, and reading the bracketed metadata the category picker writes
 * into `remarks`.
 *
 * A task description can hold prose, a serialised checklist array, the legacy
 * `{ title, items }` object, or a value that only looks like JSON. All four
 * reach these functions from real rows, so all four are covered here.
 * `formatTaskPreview`'s prose and mixed cases are covered in
 * taskFormatters.test.js; what is added here are the checklist shapes.
 */

describe("formatChecklistToString", () => {
    it("renders a serialised checklist as a bulleted list", () => {
        const checklist = JSON.stringify([{ text: "Order the part" }, { text: "Fit it" }])

        expect(formatChecklistToString(checklist)).toBe("• Order the part\n• Fit it")
    })

    it("renders an already-parsed array the same way", () => {
        expect(
            formatChecklistToString([{ text: "Order the part" }, { text: "Fit it" }]),
        ).toBe("• Order the part\n• Fit it")
    })

    it("puts a titled checklist's title on its own first line", () => {
        const checklist = JSON.stringify({
            title: "Switch replacement",
            items: [{ text: "Order the part" }],
        })

        expect(formatChecklistToString(checklist)).toBe(
            "Switch replacement\n• Order the part",
        )
    })

    it("renders a titled object that was not serialised", () => {
        expect(
            formatChecklistToString({ title: "Rack work", items: [{ text: "Label" }] }),
        ).toBe("Rack work\n• Label")
    })

    it("omits the title line when the checklist has no title", () => {
        const checklist = JSON.stringify({ items: [{ text: "Order the part" }] })

        expect(formatChecklistToString(checklist)).toBe("• Order the part")
    })

    it("names an item with no text rather than rendering an empty bullet", () => {
        expect(formatChecklistToString(JSON.stringify([{ checked: true }]))).toBe(
            "• Task",
        )
    })

    it("renders a single-item checklist without a trailing newline", () => {
        expect(formatChecklistToString(JSON.stringify([{ text: "Only one" }]))).toBe(
            "• Only one",
        )
    })

    it("renders an empty checklist as nothing at all", () => {
        expect(formatChecklistToString(JSON.stringify([]))).toBe("")
    })

    it.each([
        ["prose", "Replaced the office switch"],
        ["prose that opens with a bracketed tag", "[URGENT] fix the printer"],
        ["a string of broken JSON", "[{oops"],
    ])("returns %s unchanged", (_label, value) => {
        expect(formatChecklistToString(value)).toBe(value)
    })

    it.each([
        ["null", null],
        ["undefined", undefined],
        ["an empty string", ""],
    ])("returns an empty string for %s", (_label, value) => {
        expect(formatChecklistToString(value)).toBe("")
    })

    it("stringifies a value that is neither prose nor a checklist", () => {
        expect(formatChecklistToString(42)).toBe("42")
    })
})

describe("formatTaskPreview with a checklist", () => {
    it("counts the items on a serialised checklist description", () => {
        const checklist = JSON.stringify([{ text: "a" }, { text: "b" }, { text: "c" }])

        expect(formatTaskPreview(checklist)).toBe("Checklist: 3 Items")
    })

    it("counts the items on an explicit checklist column", () => {
        expect(formatTaskPreview(null, JSON.stringify([{ text: "a" }, { text: "b" }]))).toBe(
            "Checklist: 2 Items",
        )
    })

    it("names a titled checklist by its title", () => {
        const checklist = JSON.stringify({
            title: "Switch replacement",
            items: [{ text: "a" }, { text: "b" }],
        })

        expect(formatTaskPreview(checklist)).toBe("Switch replacement (2 Items)")
    })

    it("shows the description alongside the item count when a task has both", () => {
        const preview = formatTaskPreview("Replace the switch", JSON.stringify([{ text: "a" }]))

        expect(preview).toBe("Replace the switch (Checklist: 1 Items)")
    })

    it("truncates a long description before appending the count", () => {
        const long = "x".repeat(60)

        const preview = formatTaskPreview(long, JSON.stringify([{ text: "a" }]))

        expect(preview).toBe(`${"x".repeat(40)}... (Checklist: 1 Items)`)
    })

    it("does not truncate a description that fits", () => {
        const short = "x".repeat(40)

        expect(formatTaskPreview(short, JSON.stringify([{ text: "a" }]))).toBe(
            `${short} (Checklist: 1 Items)`,
        )
    })

    it("prefers the checklist column over a legacy checklist in the description", () => {
        const preview = formatTaskPreview(
            JSON.stringify([{ text: "old" }, { text: "old" }, { text: "old" }]),
            JSON.stringify([{ text: "new" }]),
        )

        expect(preview).toBe("Checklist: 1 Items")
    })

    it("counts an already-parsed array description", () => {
        expect(formatTaskPreview([{ text: "a" }, { text: "b" }])).toBe(
            "Checklist: 2 Items",
        )
    })

    it("counts an already-parsed titled object", () => {
        expect(formatTaskPreview({ title: "Rack work", items: [{ text: "a" }] })).toBe(
            "Rack work (1 Items)",
        )
    })

    it("counts an already-parsed checklist column", () => {
        expect(formatTaskPreview(null, [{ text: "a" }, { text: "b" }])).toBe(
            "Checklist: 2 Items",
        )
    })

    it("ignores an empty checklist column and shows the description", () => {
        expect(formatTaskPreview("Replace the switch", JSON.stringify([]))).toBe(
            "Replace the switch",
        )
    })

    it("ignores a checklist column that is not JSON", () => {
        expect(formatTaskPreview("Replace the switch", "not json")).toBe(
            "Replace the switch",
        )
    })

    it("keeps prose that merely opens with a bracket as prose", () => {
        expect(formatTaskPreview("[URGENT] fix the printer")).toBe(
            "[URGENT] fix the printer",
        )
    })

    it("keeps a broken JSON description as prose rather than losing it", () => {
        expect(formatTaskPreview("[{broken]")).toBe("[{broken]")
        expect(formatTaskPreview("{broken}")).toBe("{broken}")
    })

    it("has nothing to show for an empty task", () => {
        expect(formatTaskPreview("")).toBe("")
        expect(formatTaskPreview(null)).toBe("")
        expect(formatTaskPreview(undefined, undefined)).toBe("")
    })
})

describe("extractOthersDetailsFromRemarks", () => {
    it("reads the free-text detail behind an [OTHERS] category", () => {
        expect(extractOthersDetailsFromRemarks("[OTHERS] Cable tray fabrication")).toBe(
            "Cable tray fabrication",
        )
    })

    it("reads the detail behind a committee's Others option", () => {
        expect(
            extractOthersDetailsFromRemarks("[COMMITTEE - OTHERS] Safety audit"),
        ).toBe("Safety audit")
    })

    it.each([
        ["[others] lower case", "lower case"],
        ["[Others] Mixed Case", "Mixed Case"],
    ])("is case-insensitive about the tag in %s", (remarks, expected) => {
        expect(extractOthersDetailsFromRemarks(remarks)).toBe(expected)
    })

    it("trims the surrounding whitespace off the detail", () => {
        expect(extractOthersDetailsFromRemarks("  [OTHERS]   Spacing   ")).toBe(
            "Spacing",
        )
    })

    it("tolerates spacing around the committee separator", () => {
        expect(extractOthersDetailsFromRemarks("[COMMITTEE-OTHERS] Audit")).toBe("Audit")
    })

    it.each([
        ["ordinary remarks", "Good work"],
        ["a tag with nothing behind it", "[OTHERS]"],
        ["a tag that is not Others", "[COMMITTEE - SAFETY]"],
        ["a tag that is not at the start", "see [OTHERS] below"],
    ])("finds nothing in %s", (_label, remarks) => {
        expect(extractOthersDetailsFromRemarks(remarks)).toBeNull()
    })

    it.each([
        ["null", null],
        ["undefined", undefined],
        ["an empty string", ""],
        ["a number", 42],
    ])("finds nothing in %s", (_label, remarks) => {
        expect(extractOthersDetailsFromRemarks(remarks)).toBeNull()
    })
})

describe("isCategoryMetadataRemarks", () => {
    it.each([
        ["an Others detail", "[OTHERS] Cable tray fabrication"],
        ["a committee Others detail", "[COMMITTEE - OTHERS] Safety audit"],
        ["a bare committee tag", "[COMMITTEE - SAFETY]"],
        ["a bare committee tag with no spacing", "[COMMITTEE-SAFETY]"],
    ])("recognises %s as metadata rather than feedback", (_label, remarks) => {
        expect(isCategoryMetadataRemarks(remarks)).toBe(true)
    })

    it.each([
        ["real feedback", "Good work, keep it up"],
        ["an Others tag with no detail", "[OTHERS]"],
        ["a tag in the middle of a sentence", "please see [OTHERS] above"],
        ["an unrelated bracketed tag", "[URGENT] fix the printer"],
    ])("does not mistake %s for metadata", (_label, remarks) => {
        expect(isCategoryMetadataRemarks(remarks)).toBe(false)
    })

    it.each([
        ["null", null],
        ["undefined", undefined],
        ["an empty string", ""],
        ["a number", 42],
    ])("does not mistake %s for metadata", (_label, remarks) => {
        expect(isCategoryMetadataRemarks(remarks)).toBe(false)
    })

    it("agrees with the extractor on every Others form", () => {
        // If one says a remark is metadata, the other must be able to read the
        // detail out of it — otherwise a reviewer's note vanishes from the UI.
        for (const remarks of [
            "[OTHERS] Cable tray",
            "[COMMITTEE - OTHERS] Safety audit",
        ]) {
            expect(isCategoryMetadataRemarks(remarks)).toBe(true)
            expect(extractOthersDetailsFromRemarks(remarks)).toBeTruthy()
        }
    })
})
