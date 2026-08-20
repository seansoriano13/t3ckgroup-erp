import { describe, expect, it } from "vitest"

import {
    PO_NUMBER_PATTERN,
    PROCUREMENT_OUTCOME,
    PROCUREMENT_TEAM,
    REQUEST_UNITS,
    buildRequisitionTitle,
    countResolved,
    isRequisitionTitle,
    isResolved,
    isValidPoNumber,
    normalizePoNumber,
    openRequests,
    procurementAffinity,
    requisitionBatchNumber,
} from "./procurement"

/**
 * The requisition side of procurement: how a purchasing task is named, how it
 * is recognised again afterwards, and when a request counts as answered.
 *
 * The naming and the recognition have to agree exactly. A title this module
 * mints and then fails to match reads as an ordinary task on the approvals
 * screen and loses its resolution panel — which is the bug the batch prefix
 * was added to fix.
 *
 * Outcome vocabulary and theming are covered in procurement.test.js.
 */

describe("buildRequisitionTitle", () => {
    const base = { salesReference: "S07971", clientName: "Acme Corp", itemCount: 3 }

    it("leads with the sales reference, the only key shared with Odoo", () => {
        expect(buildRequisitionTitle(base)).toBe(
            "[PR] S07971 — Acme Corp — 3 items to source",
        )
    })

    it("names an unquoted deal by its client instead", () => {
        expect(
            buildRequisitionTitle({ clientName: "Acme Corp", itemCount: 2 }),
        ).toBe("[PR] Acme Corp — 2 items to source")
    })

    it("does not repeat the client either side of the dash", () => {
        const title = buildRequisitionTitle({ clientName: "Acme Corp", itemCount: 1 })
        expect(title).not.toMatch(/Acme Corp — Acme Corp/)
    })

    it("falls back to a placeholder when there is neither reference nor client", () => {
        expect(buildRequisitionTitle({ itemCount: 1 })).toBe(
            "[PR] Unreferenced opportunity — Unknown client — 1 item to source",
        )
    })

    it.each([
        [1, "1 item to source"],
        [2, "2 items to source"],
        [0, "0 items to source"],
        [11, "11 items to source"],
    ])("counts %i as %s", (itemCount, expected) => {
        expect(buildRequisitionTitle({ ...base, itemCount })).toContain(expected)
    })

    it.each([
        ["undefined", undefined],
        ["null", null],
        ["a non-numeric string", "three"],
    ])("treats %s as no items rather than rendering NaN", (_label, itemCount) => {
        expect(buildRequisitionTitle({ ...base, itemCount })).toContain(
            "0 items to source",
        )
    })

    it("counts a numeric string", () => {
        expect(buildRequisitionTitle({ ...base, itemCount: "4" })).toContain(
            "4 items to source",
        )
    })

    it.each([
        ["the first batch", 1, "[PR]"],
        ["no batch at all", undefined, "[PR]"],
        ["the second batch", 2, "[PR #2]"],
        ["a later batch", 7, "[PR #7]"],
    ])("prefixes %s with %s", (_label, batchNumber, prefix) => {
        expect(buildRequisitionTitle({ ...base, batchNumber })).toMatch(
            new RegExp(`^\\${prefix[0]}PR`),
        )
        expect(buildRequisitionTitle({ ...base, batchNumber }).startsWith(prefix)).toBe(
            true,
        )
    })
})

describe("isRequisitionTitle", () => {
    it("recognises a title it just minted", () => {
        const title = buildRequisitionTitle({ clientName: "Acme", itemCount: 1 })
        expect(isRequisitionTitle(title)).toBe(true)
    })

    it("recognises a batched title it just minted", () => {
        // A plain startsWith("[PR]") missed this, and the second requisition
        // lost its resolution panel.
        const title = buildRequisitionTitle({
            clientName: "Acme",
            itemCount: 1,
            batchNumber: 3,
        })
        expect(isRequisitionTitle(title)).toBe(true)
    })

    it.each([[1], [2], [9], [42]])(
        "recognises every batch number it can mint — %i",
        (batchNumber) => {
            const title = buildRequisitionTitle({
                salesReference: "S001",
                clientName: "Acme",
                itemCount: 1,
                batchNumber,
            })
            expect(isRequisitionTitle(title)).toBe(true)
        },
    )

    it.each([
        ["an ordinary task", "Replace the office switch"],
        ["a task that merely mentions PR", "Follow up on the PR"],
        ["a differently bracketed tag", "[URGENT] fix the printer"],
        ["a lowercase prefix", "[pr] Acme"],
        ["an empty description", ""],
        ["null", null],
        ["undefined", undefined],
    ])("does not mistake %s for a requisition", (_label, description) => {
        expect(isRequisitionTitle(description)).toBe(false)
    })
})

describe("requisitionBatchNumber", () => {
    it("reads an unnumbered requisition as batch 1", () => {
        expect(requisitionBatchNumber("[PR] Acme — 1 item to source")).toBe(1)
    })

    it.each([[2], [3], [12]])("reads batch %i off the prefix", (batchNumber) => {
        const title = buildRequisitionTitle({
            clientName: "Acme",
            itemCount: 1,
            batchNumber,
        })
        expect(requisitionBatchNumber(title)).toBe(batchNumber)
    })

    it("round-trips every batch it can mint", () => {
        for (const batchNumber of [1, 2, 5, 20]) {
            const title = buildRequisitionTitle({
                clientName: "Acme",
                itemCount: 1,
                batchNumber,
            })
            expect(requisitionBatchNumber(title)).toBe(batchNumber)
        }
    })

    it.each([
        ["an ordinary task", "Replace the office switch"],
        ["an empty description", ""],
        ["null", null],
    ])("answers batch 1 for %s rather than throwing", (_label, description) => {
        expect(requisitionBatchNumber(description)).toBe(1)
    })
})

describe("isResolved", () => {
    it("reads a request purchasing has not answered as open", () => {
        expect(isResolved({ outcome: PROCUREMENT_OUTCOME.IN_PROGRESS })).toBe(false)
    })

    it.each([
        ["null", null],
        ["undefined", undefined],
        ["an empty string", ""],
    ])("reads an outcome of %s as open", (_label, outcome) => {
        expect(isResolved({ outcome })).toBe(false)
    })

    it("reads a request with no outcome field at all as open", () => {
        expect(isResolved({})).toBe(false)
        expect(isResolved(undefined)).toBe(false)
    })

    it.each(
        Object.values(PROCUREMENT_OUTCOME).filter(
            (o) => o !== PROCUREMENT_OUTCOME.IN_PROGRESS,
        ),
    )("reads the definitive outcome %s as resolved", (outcome) => {
        expect(isResolved({ outcome })).toBe(true)
    })
})

describe("countResolved", () => {
    const open = { outcome: PROCUREMENT_OUTCOME.IN_PROGRESS }
    const done = { outcome: PROCUREMENT_OUTCOME.PURCHASED }

    it("counts the answered against the total for the rail", () => {
        expect(countResolved([done, open, done])).toEqual({ total: 3, resolved: 2 })
    })

    it("counts nothing done when every request is open", () => {
        expect(countResolved([open, open])).toEqual({ total: 2, resolved: 0 })
    })

    it("counts everything done when every request is answered", () => {
        expect(countResolved([done, done])).toEqual({ total: 2, resolved: 2 })
    })

    it("counts an empty set as zero of zero", () => {
        expect(countResolved([])).toEqual({ total: 0, resolved: 0 })
        expect(countResolved()).toEqual({ total: 0, resolved: 0 })
    })

    it("agrees with openRequests on what is left", () => {
        const requests = [done, open, done, open]
        const { total, resolved } = countResolved(requests)
        expect(openRequests(requests)).toHaveLength(total - resolved)
    })
})

describe("openRequests", () => {
    it("keeps only what purchasing still owes an answer on", () => {
        const open = { id: 1, outcome: PROCUREMENT_OUTCOME.IN_PROGRESS }
        const done = { id: 2, outcome: PROCUREMENT_OUTCOME.PURCHASED }

        expect(openRequests([open, done])).toEqual([open])
    })

    it("returns nothing when the stage gate is clear", () => {
        expect(openRequests([{ outcome: PROCUREMENT_OUTCOME.PURCHASED }])).toEqual([])
    })

    it("returns nothing for an empty set", () => {
        expect(openRequests([])).toEqual([])
        expect(openRequests()).toEqual([])
    })
})

describe("procurementAffinity", () => {
    it("ranks the purchasing sub-department first", () => {
        expect(procurementAffinity({ subDepartment: "Purchasing" })).toBe(0)
    })

    it("ranks a purchasing department first too", () => {
        expect(procurementAffinity({ department: "Purchasing" })).toBe(0)
    })

    it.each([["PURCHASING"], ["purchasing"], ["Purchasing"]])(
        "matches %s regardless of case",
        (value) => {
            expect(procurementAffinity({ subDepartment: value })).toBe(0)
        },
    )

    it("leaves everyone else reachable, just later", () => {
        expect(procurementAffinity({ department: "IT" })).toBe(1)
        expect(procurementAffinity({ subDepartment: "Infra", department: "IT" })).toBe(1)
    })

    it.each([
        ["an empty recipient", {}],
        ["null", null],
        ["undefined", undefined],
    ])("ranks %s last rather than throwing", (_label, recipient) => {
        expect(procurementAffinity(recipient)).toBe(1)
    })

    it("sorts purchasing to the front of a recipient list", () => {
        const people = [
            { name: "Ana", department: "IT" },
            { name: "Ben", subDepartment: "Purchasing" },
            { name: "Cy", department: "Finance" },
        ]

        const sorted = [...people].sort(
            (a, b) => procurementAffinity(a) - procurementAffinity(b),
        )

        expect(sorted[0].name).toBe("Ben")
        expect(sorted).toHaveLength(3)
    })

    it("names the team it ranks for", () => {
        expect(PROCUREMENT_TEAM).toBe("PURCHASING")
    })
})

describe("PO numbers", () => {
    it.each([
        ["p0001", "P0001"],
        ["  P123  ", "P123"],
        ["p123", "P123"],
    ])("normalises %s to %s", (input, expected) => {
        expect(normalizePoNumber(input)).toBe(expected)
    })

    it.each([
        ["null", null],
        ["undefined", undefined],
        ["an empty string", ""],
    ])("normalises %s to an empty string", (_label, input) => {
        expect(normalizePoNumber(input)).toBe("")
    })

    it.each([["P1"], ["P0001"], ["P123456"]])("accepts %s", (value) => {
        expect(isValidPoNumber(value)).toBe(true)
        expect(PO_NUMBER_PATTERN.test(value)).toBe(true)
    })

    it.each([
        ["a bare number", "0001"],
        ["the wrong letter", "S0001"],
        ["a letter with no digits", "P"],
        ["extra text", "P0001-A"],
        ["an empty string", ""],
        ["null", null],
    ])("rejects %s", (_label, value) => {
        expect(isValidPoNumber(value)).toBe(false)
    })

    it("accepts a lowercase number the user typed, once normalised", () => {
        expect(isValidPoNumber(normalizePoNumber("p0001"))).toBe(true)
    })
})

describe("REQUEST_UNITS", () => {
    it("offers a fixed vocabulary rather than free text", () => {
        expect(REQUEST_UNITS.length).toBeGreaterThan(0)
        expect(new Set(REQUEST_UNITS).size).toBe(REQUEST_UNITS.length)
    })

    it("leads with the unit purchasing sees most", () => {
        expect(REQUEST_UNITS[0]).toBe("unit")
    })

    it("spells every unit in lower case so the column reads consistently", () => {
        for (const unit of REQUEST_UNITS) {
            expect(unit).toBe(unit.toLowerCase())
        }
    })

    it("does not offer two spellings of the same thing", () => {
        expect(REQUEST_UNITS).toContain("pc")
        expect(REQUEST_UNITS).not.toContain("pcs")
        expect(REQUEST_UNITS).not.toContain("piece")
    })
})
