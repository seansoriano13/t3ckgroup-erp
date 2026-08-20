import { describe, expect, it } from "vitest"

import {
    MAX_ATTACHMENTS,
    MAX_ATTACHMENT_BYTES,
    formatBytes,
    isImageAttachment,
    toDescriptor,
} from "./attachments"
import { activeMentionQuery } from "./mentions"
import { countChecklist, hasChecklistContent, parseChecklist, resolveAssignment } from "./checklist"

/**
 * The small readers that sit between stored JSON and what a component renders.
 *
 * All three files here read values written by more than one generation of the
 * app — a bare URL string where a descriptor is expected, a checklist in the
 * description column where the checklist column is now, a mention typed
 * halfway. Each of those shapes is still in the database, so each is asserted
 * rather than assumed away.
 */

describe("toDescriptor", () => {
    it("reads a full descriptor straight through", () => {
        expect(
            toDescriptor({
                url: "https://cdn.test/receipt.pdf",
                name: "Receipt.pdf",
                type: "application/pdf",
                bytes: 2048,
            }),
        ).toEqual({
            url: "https://cdn.test/receipt.pdf",
            name: "Receipt.pdf",
            type: "application/pdf",
            bytes: 2048,
        })
    })

    it("wraps the bare URL string task comments stored", () => {
        expect(toDescriptor("https://cdn.test/photo.png")).toEqual({
            url: "https://cdn.test/photo.png",
            name: "photo.png",
            type: "",
        })
    })

    it("names a descriptor from its URL when the name is missing", () => {
        expect(toDescriptor({ url: "https://cdn.test/report.xlsx" }).name).toBe(
            "report.xlsx",
        )
    })

    it("decodes an escaped filename", () => {
        expect(toDescriptor("https://cdn.test/August%20report.pdf").name).toBe(
            "August report.pdf",
        )
    })

    it("falls back to a generic name when the URL has no filename", () => {
        expect(toDescriptor("https://cdn.test/").name).toBe("Attachment")
    })

    it("falls back to a generic name when the URL is unparseable", () => {
        expect(toDescriptor("not a url at all").name).toBe("Attachment")
    })

    it("keeps an explicit name over one derived from the URL", () => {
        expect(
            toDescriptor({ url: "https://cdn.test/abc123.pdf", name: "Delivery receipt" })
                .name,
        ).toBe("Delivery receipt")
    })

    it.each([
        ["null", null],
        ["undefined", undefined],
        ["an empty string", ""],
        ["an object with no url", { name: "orphan.pdf" }],
    ])("has no descriptor for %s", (_label, value) => {
        expect(toDescriptor(value)).toBeNull()
    })
})

describe("isImageAttachment", () => {
    it.each([
        ["image/png"],
        ["image/jpeg"],
        ["image/webp"],
    ])("trusts the %s mime type", (type) => {
        expect(isImageAttachment({ url: "https://cdn.test/x", type })).toBe(true)
    })

    it.each([["png"], ["jpg"], ["jpeg"], ["gif"], ["webp"], ["avif"], ["bmp"], ["svg"]])(
        "reads a .%s URL as an image when there is no mime type",
        (ext) => {
            expect(isImageAttachment({ url: `https://cdn.test/photo.${ext}` })).toBe(true)
        },
    )

    it("reads an image URL that carries a query string", () => {
        expect(
            isImageAttachment({ url: "https://cdn.test/photo.png?v=2" }),
        ).toBe(true)
    })

    it("is not fooled by case", () => {
        expect(isImageAttachment({ url: "https://cdn.test/PHOTO.PNG" })).toBe(true)
    })

    it.each([
        ["a PDF", { url: "https://cdn.test/receipt.pdf", type: "application/pdf" }],
        ["a spreadsheet", { url: "https://cdn.test/report.xlsx" }],
        ["a URL with no extension", { url: "https://cdn.test/file" }],
        ["nothing at all", null],
        ["an empty descriptor", {}],
    ])("does not read %s as an image", (_label, descriptor) => {
        expect(isImageAttachment(descriptor)).toBe(false)
    })
})

describe("formatBytes", () => {
    it.each([
        [0, "0 B"],
        [1, "1 B"],
        [1023, "1023 B"],
        [1024, "1 KB"],
        [2048, "2 KB"],
        [1024 * 1023, "1023 KB"],
        [1024 * 1024, "1.0 MB"],
        [1024 * 1024 * 2.5, "2.5 MB"],
        [10 * 1024 * 1024, "10.0 MB"],
    ])("renders %i bytes as %s", (bytes, expected) => {
        expect(formatBytes(bytes)).toBe(expected)
    })

    it.each([
        ["null", null],
        ["undefined", undefined],
    ])("renders nothing for %s", (_label, bytes) => {
        expect(formatBytes(bytes)).toBe("")
    })

    it("renders the upload ceiling in a unit a person reads", () => {
        expect(formatBytes(MAX_ATTACHMENT_BYTES)).toBe("10.0 MB")
    })
})

describe("attachment limits", () => {
    it("caps an upload at five files", () => {
        expect(MAX_ATTACHMENTS).toBe(5)
    })

    it("caps a single file at ten megabytes", () => {
        expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024)
    })
})

describe("activeMentionQuery", () => {
    it("finds the token being typed at the caret", () => {
        const text = "cc @Ana"
        expect(activeMentionQuery(text, text.length)).toEqual({ at: 3, token: "Ana" })
    })

    it("finds an empty token the moment the @ is typed", () => {
        const text = "cc @"
        expect(activeMentionQuery(text, text.length)).toEqual({ at: 3, token: "" })
    })

    it("allows one space so a full name keeps matching", () => {
        const text = "cc @Ana Cruz"
        expect(activeMentionQuery(text, text.length)).toEqual({
            at: 3,
            token: "Ana Cruz",
        })
    })

    it("gives up after a second space — that is prose again", () => {
        const text = "cc @Ana Cruz please"
        expect(activeMentionQuery(text, text.length)).toBeNull()
    })

    it("finds a mention at the very start of the field", () => {
        expect(activeMentionQuery("@Ana", 4)).toEqual({ at: 0, token: "Ana" })
    })

    it("does not read an email address as a mention", () => {
        const text = "ping ana@t3ckgroup.test"
        expect(activeMentionQuery(text, text.length)).toBeNull()
    })

    it("gives up once the mention is on a previous line", () => {
        const text = "@Ana\nnext line"
        expect(activeMentionQuery(text, text.length)).toBeNull()
    })

    it("reads only up to the caret, not the whole field", () => {
        const text = "cc @Ana and more"
        expect(activeMentionQuery(text, 7)).toEqual({ at: 3, token: "Ana" })
    })

    it("takes the last @ when there are several", () => {
        const text = "@Ana and @Ben"
        expect(activeMentionQuery(text, text.length)).toEqual({ at: 9, token: "Ben" })
    })

    it.each([
        ["plain prose", "no mentions here"],
        ["an empty field", ""],
    ])("finds nothing in %s", (_label, text) => {
        expect(activeMentionQuery(text, text.length)).toBeNull()
    })

    it("survives a null field", () => {
        expect(activeMentionQuery(null, 0)).toBeNull()
    })
})

describe("parseChecklist", () => {
    it("reads a jsonb array straight through", () => {
        const items = [{ text: "a" }]
        expect(parseChecklist(items)).toBe(items)
    })

    it("reads a serialised array", () => {
        expect(parseChecklist('[{"text":"a"}]')).toEqual([{ text: "a" }])
    })

    it("reads the legacy { items } object", () => {
        expect(parseChecklist({ items: [{ text: "a" }] })).toEqual([{ text: "a" }])
    })

    it("reads a serialised { items } object", () => {
        expect(parseChecklist('{"items":[{"text":"a"}]}')).toEqual([{ text: "a" }])
    })

    it("reads an object with no items as an empty checklist", () => {
        expect(parseChecklist({ title: "Untitled" })).toEqual([])
    })

    it.each([
        ["prose", "Replaced the switch"],
        ["prose opening with a bracket", "[URGENT] fix the printer"],
        ["broken JSON", "[{oops"],
        ["null", null],
        ["undefined", undefined],
        ["an empty string", ""],
        ["a number", 42],
    ])("reads %s as an empty checklist", (_label, value) => {
        expect(parseChecklist(value)).toEqual([])
    })
})

describe("countChecklist", () => {
    it("counts the ticked items against the total", () => {
        expect(
            countChecklist([{ checked: true }, { checked: false }, { checked: true }]),
        ).toEqual({ total: 3, checked: 2 })
    })

    it("counts an untouched checklist", () => {
        expect(countChecklist([{ text: "a" }, { text: "b" }])).toEqual({
            total: 2,
            checked: 0,
        })
    })

    it("counts a finished checklist", () => {
        expect(countChecklist([{ checked: true }])).toEqual({ total: 1, checked: 1 })
    })

    it("counts an empty or absent checklist as zero of zero", () => {
        expect(countChecklist([])).toEqual({ total: 0, checked: 0 })
        expect(countChecklist(null)).toEqual({ total: 0, checked: 0 })
    })

    it("survives a null item in the list", () => {
        expect(countChecklist([null, { checked: true }])).toEqual({
            total: 2,
            checked: 1,
        })
    })
})

describe("hasChecklistContent", () => {
    it("is true once an item has real text", () => {
        expect(hasChecklistContent([{ text: "Order the part" }])).toBe(true)
    })

    it.each([
        ["an empty list", []],
        ["items with no text", [{ checked: false }]],
        ["items with only whitespace", [{ text: "   " }]],
        ["nothing at all", null],
    ])("is false for %s", (_label, value) => {
        expect(hasChecklistContent(value)).toBe(false)
    })
})

describe("resolveAssignment", () => {
    it("reads a post-split row: prose in the description, items in the column", () => {
        expect(
            resolveAssignment({
                taskDescription: "Fit the new switch",
                checklist: [{ text: "Order the part" }],
            }),
        ).toEqual({
            description: "Fit the new switch",
            checklist: [{ text: "Order the part" }],
        })
    })

    it("reads a pre-split row with the checklist still in the description", () => {
        expect(
            resolveAssignment({ taskDescription: '[{"text":"Order the part"}]' }),
        ).toEqual({ description: "", checklist: [{ text: "Order the part" }] })
    })

    it("reads a snake_case row the same way", () => {
        expect(resolveAssignment({ task_description: "Fit the switch" })).toEqual({
            description: "Fit the switch",
            checklist: [],
        })
    })

    it("keeps prose that merely opens with a bracket as prose", () => {
        expect(resolveAssignment({ taskDescription: "[URGENT] fix the printer" })).toEqual(
            { description: "[URGENT] fix the printer", checklist: [] },
        )
    })

    it("reads a plain description with no checklist", () => {
        expect(resolveAssignment({ taskDescription: "Fit the switch" })).toEqual({
            description: "Fit the switch",
            checklist: [],
        })
    })

    it("returns an empty assignment for a missing member", () => {
        expect(resolveAssignment(null)).toEqual({ description: "", checklist: [] })
        expect(resolveAssignment(undefined)).toEqual({ description: "", checklist: [] })
    })

    it("returns an empty assignment for a member with neither field", () => {
        expect(resolveAssignment({})).toEqual({ description: "", checklist: [] })
    })
})
