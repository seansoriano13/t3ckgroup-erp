import { describe, expect, it } from "vitest"

import { TASK_STATUS } from "../constants/status.js"
import { canvassSignoffToItem, leaveToItem, leaveWhen, shortAge, shortDate, shortRef, taskChain, taskHeadline, taskToItem } from "./approvalItems.js"

const NOW = new Date("2026-08-20T15:00:00+08:00").getTime()
const ago = (h) => new Date(NOW - h * 3600000).toISOString()

describe("taskHeadline", () => {
    it("prefers the project title, then the first line of the description", () => {
        expect(taskHeadline({ projectTitle: "Q3 close", taskDescription: "Details" })).toBe("Q3 close")
        expect(taskHeadline({ taskDescription: "\nReplace the switch\nand the cable" })).toBe("Replace the switch")
    })

    it("summarises a checklist by its progress instead of dumping JSON", () => {
        const desc = JSON.stringify([
            { id: "1", text: "a", checked: true },
            { id: "2", text: "b", checked: false },
        ])
        expect(taskHeadline({ taskDescription: desc })).toBe("Checklist · 1/2")
    })
})

describe("taskChain", () => {
    it("puts a pending task on the head's step", () => {
        const chain = taskChain({ status: TASK_STATUS.AWAITING_APPROVAL, loggedByName: "Ana" })
        expect(chain.map((s) => s.state)).toEqual(["done", "current", "next"])
    })

    it("moves a graded task on to HR, carrying the grade", () => {
        const chain = taskChain({ status: TASK_STATUS.COMPLETE, evaluatedById: "h", evaluatedByName: "Head Ito", grade: 4 })
        expect(chain.map((s) => s.state)).toEqual(["done", "done", "current"])
        expect(chain[1]).toMatchObject({ who: "Head Ito", note: "Grade 4/5" })
    })
})

describe("taskToItem", () => {
    const graded = {
        id: "t1",
        status: TASK_STATUS.COMPLETE,
        evaluatedById: "h",
        hrVerified: false,
        createdAt: ago(100),
        evaluatedAt: ago(2),
        attachments: ["a", "b"],
    }

    it("runs HR's clock from the grade, not from logging", () => {
        expect(taskToItem(graded, "hr", NOW).isStale).toBe(false)
        expect(taskToItem({ ...graded, status: TASK_STATUS.INCOMPLETE }, "tasks", NOW).isStale).toBe(true)
    })

    it("calls a graded task done for the head and pending for HR", () => {
        expect(taskToItem(graded, "tasks", NOW).done).toBe(true)
        expect(taskToItem(graded, "hr", NOW).done).toBe(false)
    })

    it("counts attachments so the row can show a paperclip", () => {
        expect(taskToItem(graded, "hr", NOW).attachmentCount).toBe(2)
    })
})

describe("leaveToItem / leaveWhen", () => {
    const request = {
        id: 42,
        table: "overtime_requests",
        matchValue: 42,
        requestType: "OVERTIME",
        created_at: ago(60),
        date: "2026-08-22",
        hours: 3,
        start_time: "17:00:00",
        end_time: "20:00:00",
        employee: { id: "e1", name: "Ana Cruz", department: "IT" },
    }

    it("shapes a request like any other row", () => {
        const item = leaveToItem(request, NOW)
        expect(item).toMatchObject({ queue: "leaves", title: "Overtime", ref: "OT-42", isStale: true, done: false })
        expect(item.person).toMatchObject({ id: "e1", name: "Ana Cruz", dept: "IT" })
    })

    it("reads the when as date, span and hours", () => {
        expect(leaveWhen(request)).toMatch(/Aug 22, 2026 · 17:00–20:00 · 3 hrs$/)
    })
})

describe("formatting", () => {
    it("shortRef keeps the tail of the id", () => {
        expect(shortRef("TSK", "4b1f-9c2a-77aa3")).toBe("TSK-77AA3")
    })

    it("shortAge reads minutes, hours, then days", () => {
        expect(shortAge(ago(0.5), NOW)).toBe("30m")
        expect(shortAge(ago(5), NOW)).toBe("5h")
        expect(shortAge(ago(72), NOW)).toBe("3d")
    })

    it("shortDate drops the year only when it is this year", () => {
        expect(shortDate(ago(24), NOW)).toBe("Aug 19")
        expect(shortDate("2025-03-01T08:00:00+08:00", NOW)).toMatch(/2025/)
    })
})

describe("canvassSignoffToItem", () => {
    const pending = {
        canvassId: "11111111-aaaa-4aaa-8aaa-000000000001",
        number: "CNV_0142",
        subjectName: "Ambulance Folding Stretcher",
        creatorId: "e1",
        creatorName: "Marco Dizon",
        projectTitle: "Rescue vehicle",
        offerCount: 2,
        winnerSupplier: "Redleaf Inc.",
        winnerBrand: "Redleaf",
        waitingSince: ago(2),
    }

    it("names the Canvass, its winner and its offers, and credits who canvassed it", () => {
        const item = canvassSignoffToItem(pending, NOW)
        expect(item).toMatchObject({
            queue: "canvass",
            ref: "CNV_0142",
            title: "Ambulance Folding Stretcher",
            typeLabel: "Winner Redleaf Inc. · Redleaf · 2 offers",
            person: { id: "e1", name: "Marco Dizon", dept: "Rescue vehicle" },
            done: false,
        })
    })

    it("marks a Canvass under three offers as worth a look", () => {
        expect(canvassSignoffToItem(pending, NOW).isHighPriority).toBe(true)
        expect(canvassSignoffToItem({ ...pending, offerCount: 3 }, NOW).isHighPriority).toBe(false)
    })
})
