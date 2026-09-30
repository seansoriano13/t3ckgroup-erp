import { describe, expect, it } from "vitest"

import { TASK_STATUS } from "../constants/status.js"
import {
    hoursSince,
    isStaleSince,
    selectHrPending,
    selectHrVerified,
    selectManagerDecided,
    selectManagerPending,
} from "./approvalQueue.js"

// The queue selectors the three Approval Center pages (and their tab counts)
// share. Kept apart from approvalQueue.test.js, which covers the filter bar.

const NOW = new Date("2026-08-20T15:00:00+08:00").getTime()
const ago = (h) => new Date(NOW - h * 3600000).toISOString()

const HEAD = "head-1"
let seq = 0
const task = (over = {}) => ({
    id: `t${++seq}`,
    loggedById: "emp-1",
    status: TASK_STATUS.AWAITING_APPROVAL,
    priority: "NORMAL",
    createdAt: ago(5),
    ...over,
})
const head = { userId: HEAD, isHead: true, isSuperAdmin: false, reportedToMeOnly: true }

describe("hoursSince / isStaleSince", () => {
    it("measures from any clock, not just createdAt", () => {
        expect(hoursSince(ago(3), NOW)).toBeCloseTo(3)
        expect(isStaleSince(ago(48), NOW)).toBe(true)
        expect(isStaleSince(ago(47), NOW)).toBe(false)
    })

    it("never calls an undateable record stale", () => {
        expect(hoursSince(null, NOW)).toBeNull()
        expect(isStaleSince("not a date", NOW)).toBe(false)
    })
})

describe("selectManagerPending", () => {
    it("takes open tasks reported to this head, and only those", () => {
        const mine = task({ reportedTo: HEAD })
        const theirs = task({ reportedTo: "head-2" })
        const done = task({ reportedTo: HEAD, status: TASK_STATUS.COMPLETE })

        expect(selectManagerPending([mine, theirs, done], head)).toEqual([mine])
    })

    it("widens to every open task on the System-wide scope", () => {
        const theirs = task({ reportedTo: "head-2" })

        expect(selectManagerPending([theirs], { ...head, reportedToMeOnly: false })).toEqual([theirs])
    })

    it("never hands a reviewer their own task", () => {
        expect(selectManagerPending([task({ reportedTo: HEAD, loggedById: HEAD })], head)).toEqual([])
    })

    it("is empty for someone who is neither a head nor a super admin", () => {
        expect(selectManagerPending([task({ reportedTo: HEAD })], { ...head, isHead: false })).toEqual([])
    })

    it("routes a legacy AWAITING_APPROVAL task by department only when the settings allow it", () => {
        const legacy = task({ subDepartment: "IT" })
        const ctx = { ...head, userSubDept: "IT" }

        expect(selectManagerPending([legacy], ctx)).toEqual([])
        expect(selectManagerPending([legacy], { ...ctx, appSettings: { universal_task_submission: true } })).toEqual([legacy])
    })

    it("puts high priority first, then the oldest", () => {
        const old = task({ reportedTo: HEAD, createdAt: ago(30) })
        const fresh = task({ reportedTo: HEAD, createdAt: ago(1) })
        const urgent = task({ reportedTo: HEAD, createdAt: ago(2), priority: "HIGH" })

        expect(selectManagerPending([fresh, old, urgent], head)).toEqual([urgent, old, fresh])
    })
})

describe("selectManagerDecided", () => {
    it("lists what this head graded, newest decision first", () => {
        const a = task({ status: TASK_STATUS.COMPLETE, evaluatedById: HEAD, evaluatedAt: ago(10) })
        const b = task({ status: TASK_STATUS.COMPLETE, evaluatedById: HEAD, evaluatedAt: ago(2) })
        const other = task({ status: TASK_STATUS.COMPLETE, evaluatedById: "head-2" })

        expect(selectManagerDecided([a, other, b], head)).toEqual([b, a])
    })

    it("shows a super admin every graded task on the System-wide scope", () => {
        const other = task({ status: TASK_STATUS.COMPLETE, evaluatedById: "head-2" })

        expect(selectManagerDecided([other], { userId: "sa", isSuperAdmin: true, reportedToMeOnly: false })).toEqual([other])
    })
})

describe("selectHrPending / selectHrVerified", () => {
    const graded = (over = {}) => task({ status: TASK_STATUS.COMPLETE, evaluatedById: HEAD, hrVerified: false, ...over })

    it("waits on HR only once a head has graded it", () => {
        const ready = graded()
        const ungraded = task({ status: TASK_STATUS.COMPLETE, evaluatedById: null })
        const signed = graded({ hrVerified: true })

        expect(selectHrPending([ready, ungraded, signed], "hr-1")).toEqual([ready])
        expect(selectHrVerified([ready, ungraded, signed], "hr-1")).toEqual([signed])
    })

    it("orders HR's queue by when the grade landed, oldest first", () => {
        const early = graded({ evaluatedAt: ago(40), createdAt: ago(1) })
        const late = graded({ evaluatedAt: ago(2), createdAt: ago(90) })

        expect(selectHrPending([late, early], "hr-1")).toEqual([early, late])
    })

    it("keeps HR's own tasks out of their queue", () => {
        expect(selectHrPending([graded({ loggedById: "hr-1" })], "hr-1")).toEqual([])
    })
})
