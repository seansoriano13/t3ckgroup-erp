import { describe, expect, it } from "vitest"

import { TASK_STATUS } from "../constants/status.js"
import {
    STALE_AFTER_HOURS,
    checklistProgressLabel,
    deriveVisibleCount,
    filterAndSortTasks,
    isActiveTask,
    isChecklistDescription,
    isStaleTask,
    matchesDateFilter,
    matchesOrgFilter,
    matchesSearchQuery,
    matchesStatusFilter,
    neighbourTaskId,
    partitionByStaleness,
    reconcileActiveTaskId,
    resolveApprovalShortcut,
    resolveNavigationKey,
    sortTasks,
    toggleSelectedId,
    summariseQueueEmployees,
    taskAgeInHours,
    toLocalDateKey,
    weekBoundsFor,
} from "./approvalQueue.js"

// A fixed Manila afternoon. Every age assertion is measured back from here, so
// the numbers in this file are literals rather than a recomputation of the
// production formula.
const NOW = new Date("2026-08-20T15:00:00+08:00").getTime()

/** Builds a task created `hours` before NOW. */
const agedTask = (hours, overrides = {}) => ({
    id: `task-${hours}`,
    createdAt: new Date(NOW - hours * 60 * 60 * 1000).toISOString(),
    ...overrides,
})

// A fake keyboard event. Only the fields the shortcut resolver reads.
const keyEvent = (key, overrides = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: { tagName: "DIV", isContentEditable: false, closest: () => null },
    ...overrides,
})

/** A target that sits inside the queue list rather than the detail pane. */
const queueTarget = {
    tagName: "DIV",
    isContentEditable: false,
    closest: (selector) => (selector === "[data-approval-queue]" ? {} : null),
}

const textTarget = (tagName) => ({
    tagName,
    isContentEditable: false,
    closest: () => null,
})

describe("taskAgeInHours", () => {
    it.each([
        ["an hour old", 1, 1],
        ["a shift old", 8, 8],
        ["a day old", 24, 24],
        ["exactly at the threshold", 48, 48],
        ["a week old", 168, 168],
    ])("reports %s as %i hours", (_label, hoursAgo, expected) => {
        expect(taskAgeInHours(agedTask(hoursAgo), NOW)).toBe(expected)
    })

    it("reports a fraction for a task logged minutes ago", () => {
        expect(taskAgeInHours(agedTask(0.5), NOW)).toBe(0.5)
    })

    it("goes negative for a task dated in the future rather than clamping", () => {
        expect(taskAgeInHours(agedTask(-3), NOW)).toBe(-3)
    })

    it.each([
        ["no task at all", undefined],
        ["a null task", null],
        ["a task with no createdAt", { id: "t" }],
        ["a task with an empty createdAt", { id: "t", createdAt: "" }],
        ["a task with an unparseable createdAt", { id: "t", createdAt: "last tuesday" }],
    ])("returns null for %s", (_label, task) => {
        expect(taskAgeInHours(task, NOW)).toBeNull()
    })

    it("defaults to the current clock when no now is supplied", () => {
        const justNow = { id: "t", createdAt: new Date().toISOString() }
        expect(taskAgeInHours(justNow)).toBeLessThan(1)
    })
})

describe("staleness", () => {
    it("draws the backlog line at 48 hours", () => {
        expect(STALE_AFTER_HOURS).toBe(48)
    })

    it.each([
        ["fresh", 0, false],
        ["one hour", 1, false],
        ["one day", 24, false],
        ["just under the line", 47.9, false],
        ["exactly on the line", 48, true],
        ["just past the line", 48.1, true],
        ["three days", 72, true],
        ["a fortnight", 336, true],
    ])("%s → stale: %s", (_label, hoursAgo, expected) => {
        expect(isStaleTask(agedTask(hoursAgo), NOW)).toBe(expected)
    })

    it("never calls a task stale when it cannot tell how old it is", () => {
        expect(isStaleTask({ id: "t" }, NOW)).toBe(false)
        expect(isStaleTask({ id: "t", createdAt: "nonsense" }, NOW)).toBe(false)
    })

    it("keeps an undateable task visible as active", () => {
        expect(isActiveTask({ id: "t" }, NOW)).toBe(true)
    })

    it.each([
        ["fresh", 2, true],
        ["stale", 96, false],
    ])("%s task is active: %s", (_label, hoursAgo, expected) => {
        expect(isActiveTask(agedTask(hoursAgo), NOW)).toBe(expected)
    })
})

describe("partitionByStaleness", () => {
    it("splits a queue into active and backlog", () => {
        const fresh = agedTask(2)
        const yesterday = agedTask(20)
        const backlog = agedTask(100)

        const { active, stale } = partitionByStaleness(
            [fresh, backlog, yesterday],
            NOW,
        )

        expect(active).toEqual([fresh, yesterday])
        expect(stale).toEqual([backlog])
    })

    it("keeps the incoming order inside each half", () => {
        const tasks = [agedTask(90), agedTask(1), agedTask(200), agedTask(5)]
        const { active, stale } = partitionByStaleness(tasks, NOW)

        expect(active.map((t) => t.id)).toEqual(["task-1", "task-5"])
        expect(stale.map((t) => t.id)).toEqual(["task-90", "task-200"])
    })

    it("files a task with no date under active", () => {
        const { active, stale } = partitionByStaleness([{ id: "t" }], NOW)
        expect(active).toHaveLength(1)
        expect(stale).toHaveLength(0)
    })

    it("returns two empty halves for an empty queue", () => {
        expect(partitionByStaleness([], NOW)).toEqual({ active: [], stale: [] })
    })

    it("returns two empty halves when given nothing", () => {
        expect(partitionByStaleness()).toEqual({ active: [], stale: [] })
    })

    it("loses no task between the two halves", () => {
        const tasks = Array.from({ length: 20 }, (_, i) => agedTask(i * 6))
        const { active, stale } = partitionByStaleness(tasks, NOW)
        expect(active.length + stale.length).toBe(20)
    })
})

describe("summariseQueueEmployees", () => {
    const task = (id, name, extra = {}) => ({
        id: `t-${Math.random()}`,
        loggedById: id,
        loggedByName: name,
        ...extra,
    })

    it("counts one row per author", () => {
        const summary = summariseQueueEmployees([
            task("e1", "Ana"),
            task("e1", "Ana"),
            task("e2", "Ben"),
        ])

        expect(summary).toEqual([
            { id: "e1", name: "Ana", avatar: undefined, count: 2 },
            { id: "e2", name: "Ben", avatar: undefined, count: 1 },
        ])
    })

    it("puts the busiest author first", () => {
        const summary = summariseQueueEmployees([
            task("e1", "Ana"),
            task("e2", "Ben"),
            task("e2", "Ben"),
            task("e3", "Cy"),
            task("e3", "Cy"),
            task("e3", "Cy"),
        ])

        expect(summary.map((e) => e.name)).toEqual(["Cy", "Ben", "Ana"])
    })

    it("breaks a tie alphabetically so the chip order does not shuffle", () => {
        const summary = summariseQueueEmployees([
            task("e2", "Zara"),
            task("e1", "Abe"),
        ])

        expect(summary.map((e) => e.name)).toEqual(["Abe", "Zara"])
    })

    it("carries the avatar through for the chip", () => {
        const summary = summariseQueueEmployees([
            task("e1", "Ana", { loggedByAvatar: "https://img/ana.png" }),
        ])

        expect(summary[0].avatar).toBe("https://img/ana.png")
    })

    it("falls back to Unknown when the author has no name", () => {
        const summary = summariseQueueEmployees([{ loggedById: "e1" }])
        expect(summary[0].name).toBe("Unknown")
    })

    it("skips tasks with no author rather than making an unfilterable chip", () => {
        const summary = summariseQueueEmployees([
            { id: "a", loggedById: null },
            task("e1", "Ana"),
        ])

        expect(summary).toHaveLength(1)
        expect(summary[0].id).toBe("e1")
    })

    it("returns nothing for an empty queue", () => {
        expect(summariseQueueEmployees([])).toEqual([])
        expect(summariseQueueEmployees()).toEqual([])
    })
})

describe("matchesSearchQuery", () => {
    const task = {
        loggedByName: "Maria Santos",
        categoryId: "Network Refresh",
        taskDescription: "Replaced the switch in the annex",
        paymentVoucher: "PV-2026-0041",
    }

    it.each([
        ["a blank query", ""],
        ["whitespace only", "   "],
        ["no query at all", undefined],
    ])("matches everything for %s", (_label, query) => {
        expect(matchesSearchQuery(task, query)).toBe(true)
    })

    it.each([
        ["the author's first name", "maria"],
        ["the author's surname", "santos"],
        ["the category", "network"],
        ["a word in the description", "annex"],
        ["the payment voucher", "pv-2026"],
    ])("matches on %s", (_label, query) => {
        expect(matchesSearchQuery(task, query)).toBe(true)
    })

    it.each([
        ["MARIA"],
        ["MaRiA"],
        ["  maria  "],
    ])("ignores case and surrounding space in %s", (query) => {
        expect(matchesSearchQuery(task, query)).toBe(true)
    })

    it("does not match a term that appears in none of the searchable fields", () => {
        expect(matchesSearchQuery(task, "payroll")).toBe(false)
    })

    it("survives a task missing every searchable field", () => {
        expect(matchesSearchQuery({}, "anything")).toBe(false)
        expect(matchesSearchQuery({}, "")).toBe(true)
    })
})

describe("toLocalDateKey", () => {
    it("formats a date as YYYY-MM-DD in the local zone", () => {
        expect(toLocalDateKey(new Date("2026-08-20T15:00:00+08:00"))).toBe(
            "2026-08-20",
        )
    })

    it("keeps an early-morning Manila task on its own day", () => {
        // 07:00 Manila is the previous day in UTC. Formatting through UTC would
        // file this task under the 19th and hide it from a filter on the 20th.
        expect(toLocalDateKey(new Date("2026-08-20T07:00:00+08:00"))).toBe(
            "2026-08-20",
        )
    })

    it("keeps a late-evening Manila task on its own day", () => {
        expect(toLocalDateKey(new Date("2026-08-20T23:30:00+08:00"))).toBe(
            "2026-08-20",
        )
    })

    it.each([
        ["a single-digit month", "2026-03-05T10:00:00+08:00", "2026-03-05"],
        ["a single-digit day", "2026-11-02T10:00:00+08:00", "2026-11-02"],
        ["the first of January", "2026-01-01T00:30:00+08:00", "2026-01-01"],
        ["the last of December", "2026-12-31T23:00:00+08:00", "2026-12-31"],
    ])("zero-pads %s", (_label, iso, expected) => {
        expect(toLocalDateKey(new Date(iso))).toBe(expected)
    })

    it("accepts an ISO string as well as a Date", () => {
        expect(toLocalDateKey("2026-08-20T15:00:00+08:00")).toBe("2026-08-20")
    })

    it("returns null for a value that is not a date", () => {
        expect(toLocalDateKey("not a date")).toBeNull()
    })
})

describe("weekBoundsFor", () => {
    it("starts the week on Monday", () => {
        // 2026-08-20 is a Thursday.
        const { start } = weekBoundsFor("2026-08-20")
        expect(toLocalDateKey(start)).toBe("2026-08-17")
    })

    it("ends the week on Sunday", () => {
        const { end } = weekBoundsFor("2026-08-20")
        expect(toLocalDateKey(end)).toBe("2026-08-23")
    })

    it("treats Sunday as the end of the week it closes, not the start of a new one", () => {
        // 2026-08-23 is a Sunday; its week began on the 17th.
        const { start, end } = weekBoundsFor("2026-08-23")
        expect(toLocalDateKey(start)).toBe("2026-08-17")
        expect(toLocalDateKey(end)).toBe("2026-08-23")
    })

    it("keeps Monday as the first day of its own week", () => {
        const { start } = weekBoundsFor("2026-08-17")
        expect(toLocalDateKey(start)).toBe("2026-08-17")
    })

    it("opens the week at midnight and closes it at the last millisecond", () => {
        const { start, end } = weekBoundsFor("2026-08-20")
        expect(start.getHours()).toBe(0)
        expect(start.getMinutes()).toBe(0)
        expect(end.getHours()).toBe(23)
        expect(end.getMilliseconds()).toBe(999)
    })

    it("spans a month boundary", () => {
        // 2026-09-01 is a Tuesday, so its week starts in August.
        const { start, end } = weekBoundsFor("2026-09-01")
        expect(toLocalDateKey(start)).toBe("2026-08-31")
        expect(toLocalDateKey(end)).toBe("2026-09-06")
    })

    it("returns null for a key it cannot read", () => {
        expect(weekBoundsFor("")).toBeNull()
        expect(weekBoundsFor("august")).toBeNull()
    })
})

describe("matchesDateFilter", () => {
    const on = (iso) => ({ id: "t", createdAt: iso })

    it("matches everything when no date is selected", () => {
        expect(matchesDateFilter(on("2020-01-01T00:00:00+08:00"), "DAILY", "")).toBe(
            true,
        )
        expect(
            matchesDateFilter(on("2020-01-01T00:00:00+08:00"), "DAILY", null),
        ).toBe(true)
    })

    describe("daily", () => {
        it.each([
            ["the same day", "2026-08-20T09:00:00+08:00", true],
            ["the first minute of the day", "2026-08-20T00:00:00+08:00", true],
            ["the last minute of the day", "2026-08-20T23:59:00+08:00", true],
            ["the day before", "2026-08-19T23:59:00+08:00", false],
            ["the day after", "2026-08-21T00:01:00+08:00", false],
        ])("%s", (_label, iso, expected) => {
            expect(matchesDateFilter(on(iso), "DAILY", "2026-08-20")).toBe(expected)
        })
    })

    describe("monthly", () => {
        it.each([
            ["the first of the month", "2026-08-01T08:00:00+08:00", true],
            ["mid-month", "2026-08-14T08:00:00+08:00", true],
            ["the last of the month", "2026-08-31T22:00:00+08:00", true],
            ["the previous month", "2026-07-31T22:00:00+08:00", false],
            ["the next month", "2026-09-01T08:00:00+08:00", false],
            ["the same month a year later", "2027-08-14T08:00:00+08:00", false],
        ])("%s", (_label, iso, expected) => {
            expect(matchesDateFilter(on(iso), "MONTHLY", "2026-08")).toBe(expected)
        })
    })

    describe("yearly", () => {
        it.each([
            ["January", "2026-01-02T08:00:00+08:00", true],
            ["December", "2026-12-30T08:00:00+08:00", true],
            ["the year before", "2025-12-31T23:00:00+08:00", false],
            ["the year after", "2027-01-01T01:00:00+08:00", false],
        ])("%s", (_label, iso, expected) => {
            expect(matchesDateFilter(on(iso), "YEARLY", "2026")).toBe(expected)
        })
    })

    describe("weekly", () => {
        it.each([
            ["the Monday that opens the week", "2026-08-17T00:30:00+08:00", true],
            ["a Thursday inside the week", "2026-08-20T12:00:00+08:00", true],
            ["the Sunday that closes the week", "2026-08-23T23:00:00+08:00", true],
            ["the Sunday before", "2026-08-16T23:00:00+08:00", false],
            ["the Monday after", "2026-08-24T00:30:00+08:00", false],
        ])("%s", (_label, iso, expected) => {
            expect(matchesDateFilter(on(iso), "WEEKLY", "2026-08-20")).toBe(expected)
        })
    })

    it("excludes a task with no usable creation date once a date is picked", () => {
        expect(matchesDateFilter({ id: "t" }, "DAILY", "2026-08-20")).toBe(false)
        expect(
            matchesDateFilter({ id: "t", createdAt: "whenever" }, "MONTHLY", "2026-08"),
        ).toBe(false)
    })

    it("matches everything for an unrecognised timeframe", () => {
        expect(
            matchesDateFilter(on("2020-01-01T00:00:00+08:00"), "QUARTERLY", "2026-08"),
        ).toBe(true)
    })
})

describe("matchesStatusFilter", () => {
    const withStatus = (status, hoursAgo = 1) => agedTask(hoursAgo, { status })

    it.each([
        ["ALL", "ALL"],
        ["an empty filter", ""],
        ["no filter", undefined],
    ])("matches everything for %s", (_label, filter) => {
        expect(matchesStatusFilter(withStatus(TASK_STATUS.INCOMPLETE), filter, NOW)).toBe(
            true,
        )
    })

    it.each([
        [TASK_STATUS.INCOMPLETE],
        [TASK_STATUS.AWAITING_APPROVAL],
        [TASK_STATUS.COMPLETE],
    ])("matches %s against the stored status", (status) => {
        expect(matchesStatusFilter(withStatus(status), status, NOW)).toBe(true)
        expect(
            matchesStatusFilter(withStatus(TASK_STATUS.DELETED), status, NOW),
        ).toBe(false)
    })

    it("maps the NOT APPROVED option onto the stored status string", () => {
        expect(
            matchesStatusFilter(
                withStatus(TASK_STATUS.NOT_APPROVED),
                "NOT APPROVED",
                NOW,
            ),
        ).toBe(true)
    })

    describe("DELAYED", () => {
        it.each([
            ["an incomplete task past the line", TASK_STATUS.INCOMPLETE, 72, true],
            [
                "an awaiting-approval task past the line",
                TASK_STATUS.AWAITING_APPROVAL,
                72,
                true,
            ],
            ["an incomplete task inside the line", TASK_STATUS.INCOMPLETE, 4, false],
            ["an old but already completed task", TASK_STATUS.COMPLETE, 200, false],
            ["an old but already declined task", TASK_STATUS.NOT_APPROVED, 200, false],
        ])("%s", (_label, status, hoursAgo, expected) => {
            expect(
                matchesStatusFilter(withStatus(status, hoursAgo), "DELAYED", NOW),
            ).toBe(expected)
        })

        it("is not satisfied by a pending task with no creation date", () => {
            expect(
                matchesStatusFilter(
                    { status: TASK_STATUS.INCOMPLETE },
                    "DELAYED",
                    NOW,
                ),
            ).toBe(false)
        })
    })
})

describe("matchesOrgFilter", () => {
    const employees = new Map([
        ["e1", { id: "e1", department: "IT", subDepartment: "Infra" }],
        ["e2", { id: "e2", department: "IT", subDepartment: "Apps" }],
        ["e3", { id: "e3", department: "Finance", subDepartment: "AP" }],
    ])
    const task = (loggedById) => ({ id: "t", loggedById })

    it("matches everything when neither filter is set", () => {
        expect(
            matchesOrgFilter(task("e1"), { deptFilter: "ALL", subDeptFilter: "ALL" }, employees),
        ).toBe(true)
    })

    it("matches everything when the filters are absent entirely", () => {
        expect(matchesOrgFilter(task("e1"), {}, employees)).toBe(true)
    })

    it.each([
        ["e1", "IT", true],
        ["e3", "IT", false],
        ["e3", "Finance", true],
    ])("author %s against department %s → %s", (id, deptFilter, expected) => {
        expect(
            matchesOrgFilter(task(id), { deptFilter, subDeptFilter: "ALL" }, employees),
        ).toBe(expected)
    })

    it.each([
        ["e1", "Infra", true],
        ["e2", "Infra", false],
        ["e2", "Apps", true],
    ])("author %s against sub-department %s → %s", (id, subDeptFilter, expected) => {
        expect(
            matchesOrgFilter(task(id), { deptFilter: "ALL", subDeptFilter }, employees),
        ).toBe(expected)
    })

    it("requires both to match when both are set", () => {
        expect(
            matchesOrgFilter(
                task("e1"),
                { deptFilter: "IT", subDeptFilter: "Infra" },
                employees,
            ),
        ).toBe(true)
        expect(
            matchesOrgFilter(
                task("e1"),
                { deptFilter: "IT", subDeptFilter: "Apps" },
                employees,
            ),
        ).toBe(false)
    })

    it("holds a task back rather than leaking it past a filter when the author is unknown", () => {
        expect(
            matchesOrgFilter(
                task("ghost"),
                { deptFilter: "IT", subDeptFilter: "ALL" },
                employees,
            ),
        ).toBe(false)
    })

    it("holds a task back while the employee directory is still empty", () => {
        expect(
            matchesOrgFilter(
                task("e1"),
                { deptFilter: "IT", subDeptFilter: "ALL" },
                new Map(),
            ),
        ).toBe(false)
    })
})

describe("sortTasks", () => {
    const a = { id: "a", createdAt: "2026-08-01T00:00:00+08:00", loggedByName: "Cara" }
    const b = { id: "b", createdAt: "2026-08-10T00:00:00+08:00", loggedByName: "Abel" }
    const c = { id: "c", createdAt: "2026-08-05T00:00:00+08:00", loggedByName: "Bea" }

    it("puts the newest first for NEWEST", () => {
        expect(sortTasks([a, b, c], "NEWEST").map((t) => t.id)).toEqual([
            "b",
            "c",
            "a",
        ])
    })

    it("puts the oldest first for OLDEST", () => {
        expect(sortTasks([a, b, c], "OLDEST").map((t) => t.id)).toEqual([
            "a",
            "c",
            "b",
        ])
    })

    it("orders by author name for NAME", () => {
        expect(sortTasks([a, b, c], "NAME").map((t) => t.loggedByName)).toEqual([
            "Abel",
            "Bea",
            "Cara",
        ])
    })

    it("leaves an unrecognised sort alone", () => {
        expect(sortTasks([a, b, c], "MAGIC").map((t) => t.id)).toEqual([
            "a",
            "b",
            "c",
        ])
        expect(sortTasks([a, b, c]).map((t) => t.id)).toEqual(["a", "b", "c"])
    })

    it("does not reorder the array it was handed", () => {
        const input = [a, b, c]
        sortTasks(input, "NEWEST")
        expect(input.map((t) => t.id)).toEqual(["a", "b", "c"])
    })

    it("sorts a nameless author to the front rather than throwing", () => {
        const nameless = { id: "n", createdAt: a.createdAt }
        expect(sortTasks([a, nameless], "NAME")[0].id).toBe("n")
    })

    it("returns an empty list for an empty queue", () => {
        expect(sortTasks([], "NEWEST")).toEqual([])
        expect(sortTasks()).toEqual([])
    })
})

describe("filterAndSortTasks", () => {
    const employees = [
        { id: "e1", department: "IT", subDepartment: "Infra" },
        { id: "e2", department: "Finance", subDepartment: "AP" },
    ]

    const queue = [
        {
            id: "t1",
            loggedById: "e1",
            loggedByName: "Ana Cruz",
            categoryId: "Network Refresh",
            taskDescription: "Patched the core switch",
            paymentVoucher: "PV-001",
            priority: "HIGH",
            status: TASK_STATUS.INCOMPLETE,
            createdAt: new Date(NOW - 4 * 3600_000).toISOString(),
        },
        {
            id: "t2",
            loggedById: "e2",
            loggedByName: "Ben Reyes",
            categoryId: "Payables",
            taskDescription: "Filed the August vouchers",
            paymentVoucher: "PV-002",
            priority: "LOW",
            status: TASK_STATUS.AWAITING_APPROVAL,
            createdAt: new Date(NOW - 96 * 3600_000).toISOString(),
        },
        {
            id: "t3",
            loggedById: "e1",
            loggedByName: "Ana Cruz",
            categoryId: "Network Refresh",
            taskDescription: "Rack cable management",
            paymentVoucher: "",
            priority: "MEDIUM",
            status: TASK_STATUS.COMPLETE,
            createdAt: new Date(NOW - 24 * 3600_000).toISOString(),
        },
    ]

    const run = (criteria) =>
        filterAndSortTasks(queue, { employees, ...criteria }, NOW).map((t) => t.id)

    it("returns the whole queue when nothing is filtered", () => {
        expect(run({})).toEqual(["t1", "t2", "t3"])
    })

    it("narrows by free text", () => {
        expect(run({ searchQuery: "cable" })).toEqual(["t3"])
    })

    it("narrows by author name", () => {
        expect(run({ searchQuery: "ben" })).toEqual(["t2"])
    })

    it("narrows by priority", () => {
        expect(run({ priorityFilter: "HIGH" })).toEqual(["t1"])
    })

    it("narrows by status", () => {
        expect(run({ statusFilter: TASK_STATUS.COMPLETE })).toEqual(["t3"])
    })

    it("answers the DELAYED status option from the queue's own ages", () => {
        expect(run({ statusFilter: "DELAYED" })).toEqual(["t2"])
    })

    it("narrows by employee", () => {
        expect(run({ employeeFilter: "e1" })).toEqual(["t1", "t3"])
    })

    it("narrows by department through the employee directory", () => {
        expect(run({ deptFilter: "Finance" })).toEqual(["t2"])
    })

    it("narrows by sub-department", () => {
        expect(run({ subDeptFilter: "Infra" })).toEqual(["t1", "t3"])
    })

    it("narrows by the date the filter bar is showing", () => {
        const dayOfT1 = toLocalDateKey(new Date(NOW - 4 * 3600_000))
        expect(run({ timeframe: "DAILY", selectedDateFilter: dayOfT1 })).toEqual([
            "t1",
        ])
    })

    it("combines filters so each one narrows the last", () => {
        expect(run({ employeeFilter: "e1", priorityFilter: "MEDIUM" })).toEqual([
            "t3",
        ])
    })

    it("returns nothing when the combination excludes everything", () => {
        expect(run({ employeeFilter: "e1", deptFilter: "Finance" })).toEqual([])
    })

    it("sorts what survives the filters", () => {
        expect(run({ sortBy: "NEWEST" })).toEqual(["t1", "t3", "t2"])
        expect(run({ sortBy: "OLDEST" })).toEqual(["t2", "t3", "t1"])
    })

    it("does not reorder the queue it was handed", () => {
        const input = [...queue]
        filterAndSortTasks(input, { sortBy: "NEWEST" }, NOW)
        expect(input.map((t) => t.id)).toEqual(["t1", "t2", "t3"])
    })

    it("works with no employee directory as long as no org filter is set", () => {
        expect(
            filterAndSortTasks(queue, { searchQuery: "cable" }, NOW).map((t) => t.id),
        ).toEqual(["t3"])
    })

    it("returns an empty list for an empty queue", () => {
        expect(filterAndSortTasks([], {}, NOW)).toEqual([])
        expect(filterAndSortTasks()).toEqual([])
    })
})

describe("isChecklistDescription", () => {
    it.each([
        ["a serialised array", '[{"text":"a","checked":false}]'],
        ["an empty array", "[]"],
        ["an object with items", '{"items":[{"text":"a"}]}'],
        ["a serialised array with surrounding space", '  [{"text":"a"}]  '],
    ])("recognises %s", (_label, value) => {
        expect(isChecklistDescription(value)).toBe(true)
    })

    it.each([
        ["plain prose", "Replaced the switch"],
        ["prose that opens with a bracketed tag", "[URGENT] fix the printer"],
        ["prose that opens with a brace", "{not really json"],
        ["an empty string", ""],
        ["null", null],
        ["undefined", undefined],
        ["a number", 42],
        ["an actual array", [{ text: "a" }]],
    ])("does not mistake %s for a checklist", (_label, value) => {
        expect(isChecklistDescription(value)).toBe(false)
    })
})

describe("checklistProgressLabel", () => {
    it("counts the checked items against the total", () => {
        const checklist = JSON.stringify([
            { text: "a", checked: true },
            { text: "b", checked: false },
            { text: "c", checked: true },
        ])
        expect(checklistProgressLabel(checklist)).toBe("2/3")
    })

    it("reports nothing done on a fresh checklist", () => {
        const checklist = JSON.stringify([{ text: "a" }, { text: "b" }])
        expect(checklistProgressLabel(checklist)).toBe("0/2")
    })

    it("reports a finished checklist", () => {
        const checklist = JSON.stringify([{ text: "a", checked: true }])
        expect(checklistProgressLabel(checklist)).toBe("1/1")
    })

    it("reads progress off the same field the checklist renderer writes", () => {
        // The renderer toggles `checked`. A count keyed on any other spelling
        // would report every checklist in the queue as untouched.
        const checklist = JSON.stringify([{ text: "a", completed: true }])
        expect(checklistProgressLabel(checklist)).toBe("0/1")
    })

    it("reads the legacy { items } shape", () => {
        const checklist = JSON.stringify({
            items: [{ text: "a", checked: true }, { text: "b" }],
        })
        expect(checklistProgressLabel(checklist)).toBe("1/2")
    })

    it.each([
        ["prose", "Replaced the switch"],
        ["an empty checklist", "[]"],
        ["nothing", null],
    ])("has no label for %s", (_label, value) => {
        expect(checklistProgressLabel(value)).toBeNull()
    })
})

describe("resolveApprovalShortcut", () => {
    it("returns nothing when handed no event", () => {
        expect(resolveApprovalShortcut(null)).toBeNull()
    })

    describe("manager keys", () => {
        it.each([
            ["1", "grade:1"],
            ["2", "grade:2"],
            ["3", "grade:3"],
            ["4", "grade:4"],
            ["5", "grade:5"],
        ])("%s selects a grade", (key, expected) => {
            expect(resolveApprovalShortcut(keyEvent(key), { isHr: false })).toBe(
                expected,
            )
        })

        it.each([["0"], ["6"], ["9"]])(
            "%s is outside the grade scale and does nothing",
            (key) => {
                expect(resolveApprovalShortcut(keyEvent(key), { isHr: false })).toBeNull()
            },
        )

        it("Enter submits the evaluation", () => {
            expect(resolveApprovalShortcut(keyEvent("Enter"), { isHr: false })).toBe(
                "submit",
            )
        })

        it.each([["x"], ["X"]])("%s returns the task", (key) => {
            expect(resolveApprovalShortcut(keyEvent(key), { isHr: false })).toBe(
                "reject",
            )
        })
    })

    describe("HR keys", () => {
        it.each([
            ["Enter", "submit"],
            ["v", "submit"],
            ["V", "submit"],
            ["x", "reject"],
            ["X", "reject"],
        ])("%s → %s", (key, expected) => {
            expect(resolveApprovalShortcut(keyEvent(key), { isHr: true })).toBe(
                expected,
            )
        })

        it("does not grade — HR verifies, it does not score", () => {
            expect(resolveApprovalShortcut(keyEvent("3"), { isHr: true })).toBeNull()
        })
    })

    describe("read-only tasks", () => {
        it.each([["1"], ["Enter"], ["x"], ["v"]])(
            "%s does nothing while the task is only being read",
            (key) => {
                expect(
                    resolveApprovalShortcut(keyEvent(key), { isReadOnly: true }),
                ).toBeNull()
            },
        )

        it("does not submit from the remarks box either", () => {
            expect(
                resolveApprovalShortcut(
                    keyEvent("Enter", { ctrlKey: true, target: textTarget("TEXTAREA") }),
                    { isReadOnly: true },
                ),
            ).toBeNull()
        })
    })

    describe("while typing", () => {
        it.each([["INPUT"], ["TEXTAREA"]])(
            "a bare key inside a %s is just typing",
            (tagName) => {
                expect(
                    resolveApprovalShortcut(keyEvent("x", { target: textTarget(tagName) })),
                ).toBeNull()
                expect(
                    resolveApprovalShortcut(keyEvent("3", { target: textTarget(tagName) })),
                ).toBeNull()
                expect(
                    resolveApprovalShortcut(
                        keyEvent("Enter", { target: textTarget(tagName) }),
                    ),
                ).toBeNull()
            },
        )

        it("treats a contenteditable region as typing too", () => {
            const target = { tagName: "DIV", isContentEditable: true, closest: () => null }
            expect(resolveApprovalShortcut(keyEvent("x", { target }))).toBeNull()
        })

        it.each([["ctrlKey"], ["metaKey"]])(
            "%s+Enter submits from the remarks box",
            (modifier) => {
                expect(
                    resolveApprovalShortcut(
                        keyEvent("Enter", {
                            [modifier]: true,
                            target: textTarget("TEXTAREA"),
                        }),
                    ),
                ).toBe("submit")
            },
        )
    })

    describe("while the queue list has focus", () => {
        it("lets Enter open the row instead of approving the task", () => {
            // Clicking a queue row leaves it focused. Without this guard the
            // very next Enter would approve whatever the reviewer just opened.
            expect(
                resolveApprovalShortcut(keyEvent("Enter", { target: queueTarget })),
            ).toBeNull()
        })

        it.each([["x"], ["1"], ["v"]])("ignores %s as well", (key) => {
            expect(
                resolveApprovalShortcut(keyEvent(key, { target: queueTarget })),
            ).toBeNull()
        })
    })

    describe("modified keystrokes", () => {
        it.each([["ctrlKey"], ["metaKey"], ["altKey"]])(
            "ignores %s+X so browser and OS shortcuts still work",
            (modifier) => {
                expect(
                    resolveApprovalShortcut(keyEvent("x", { [modifier]: true })),
                ).toBeNull()
            },
        )
    })

    it("ignores keys that are not bound to anything", () => {
        for (const key of ["a", "q", "Escape", "Tab", "ArrowLeft", " "]) {
            expect(resolveApprovalShortcut(keyEvent(key))).toBeNull()
        }
    })

    it("defaults to manager rules when given no options", () => {
        expect(resolveApprovalShortcut(keyEvent("1"))).toBe("grade:1")
    })
})

describe("deriveVisibleCount", () => {
    it.each([
        ["a short queue is shown whole", 25, -1, 8, 8],
        ["a long queue starts at one batch", 25, -1, 400, 25],
        ["scrolling opens the window further", 75, -1, 400, 75],
        ["the window never exceeds the queue", 999, -1, 12, 12],
        ["an empty queue renders nothing", 25, -1, 0, 0],
    ])("%s", (_label, requestedCount, activeIndex, total, expected) => {
        expect(deriveVisibleCount({ requestedCount, activeIndex, total })).toBe(
            expected,
        )
    })

    it("stretches to reach a task selected beyond the current window", () => {
        // Deep-linking to the 300th task must not render an empty list.
        expect(
            deriveVisibleCount({ requestedCount: 25, activeIndex: 299, total: 400 }),
        ).toBe(300)
    })

    it("does not shrink the window when the active row is already inside it", () => {
        expect(
            deriveVisibleCount({ requestedCount: 50, activeIndex: 3, total: 400 }),
        ).toBe(50)
    })

    it("treats no selection as no stretch", () => {
        expect(deriveVisibleCount({ requestedCount: 25, total: 400 })).toBe(25)
    })

    it("still shows nothing when the queue is empty and a row is selected", () => {
        expect(
            deriveVisibleCount({ requestedCount: 25, activeIndex: 4, total: 0 }),
        ).toBe(0)
    })
})

describe("neighbourTaskId", () => {
    const tasks = [{ id: "a" }, { id: "b" }, { id: "c" }]

    it.each([
        ["forward from the head", 0, "next", "b"],
        ["forward through the middle", 1, "next", "c"],
        ["back from the tail", 2, "prev", "b"],
        ["back through the middle", 1, "prev", "a"],
    ])("%s", (_label, activeIndex, direction, expected) => {
        expect(neighbourTaskId(tasks, activeIndex, direction)).toBe(expected)
    })

    it("stops at the end of the queue", () => {
        expect(neighbourTaskId(tasks, 2, "next")).toBeNull()
    })

    it("stops at the start of the queue", () => {
        expect(neighbourTaskId(tasks, 0, "prev")).toBeNull()
    })

    it("goes nowhere when nothing is selected", () => {
        expect(neighbourTaskId(tasks, -1, "next")).toBeNull()
        expect(neighbourTaskId(tasks, -1, "prev")).toBeNull()
    })

    it("goes nowhere in an empty queue", () => {
        expect(neighbourTaskId([], 0, "next")).toBeNull()
        expect(neighbourTaskId(undefined, 0, "next")).toBeNull()
    })

    it("stays put in a queue of one", () => {
        expect(neighbourTaskId([{ id: "only" }], 0, "next")).toBeNull()
        expect(neighbourTaskId([{ id: "only" }], 0, "prev")).toBeNull()
    })
})

describe("resolveNavigationKey", () => {
    it.each([
        ["j", "next"],
        ["ArrowDown", "next"],
        ["k", "prev"],
        ["ArrowUp", "prev"],
    ])("%s moves %s", (key, expected) => {
        expect(resolveNavigationKey(keyEvent(key))).toBe(expected)
    })

    it.each([["a"], ["J"], ["K"], ["ArrowLeft"], ["Enter"], [" "]])(
        "%s is not a navigation key",
        (key) => {
            expect(resolveNavigationKey(keyEvent(key))).toBeNull()
        },
    )

    it.each([["INPUT"], ["TEXTAREA"]])(
        "leaves j and k alone while typing in a %s",
        (tagName) => {
            expect(
                resolveNavigationKey(keyEvent("j", { target: textTarget(tagName) })),
            ).toBeNull()
            expect(
                resolveNavigationKey(keyEvent("k", { target: textTarget(tagName) })),
            ).toBeNull()
        },
    )

    it("leaves j and k alone in a contenteditable region", () => {
        const target = { tagName: "DIV", isContentEditable: true, closest: () => null }
        expect(resolveNavigationKey(keyEvent("j", { target }))).toBeNull()
    })

    it.each([["ctrlKey"], ["metaKey"], ["altKey"]])(
        "ignores %s+ArrowDown so the browser keeps its own shortcut",
        (modifier) => {
            expect(
                resolveNavigationKey(keyEvent("ArrowDown", { [modifier]: true })),
            ).toBeNull()
        },
    )

    it("still navigates from the queue list itself", () => {
        expect(resolveNavigationKey(keyEvent("j", { target: queueTarget }))).toBe(
            "next",
        )
    })

    it("returns nothing when handed no event", () => {
        expect(resolveNavigationKey(null)).toBeNull()
    })
})

describe("reconcileActiveTaskId", () => {
    const tasks = [{ id: "a" }, { id: "b" }, { id: "c" }]

    it("keeps a selection that is still in the queue", () => {
        expect(reconcileActiveTaskId(tasks, "b")).toBe("b")
    })

    it("falls to the head of the queue when the selected task is approved away", () => {
        expect(reconcileActiveTaskId(tasks, "gone")).toBe("a")
    })

    it("selects the head when nothing is selected yet", () => {
        expect(reconcileActiveTaskId(tasks, null)).toBe("a")
        expect(reconcileActiveTaskId(tasks, undefined)).toBe("a")
    })

    it("selects nothing once the queue is empty", () => {
        expect(reconcileActiveTaskId([], "a")).toBeNull()
        expect(reconcileActiveTaskId(undefined, "a")).toBeNull()
    })

    it("is stable — reconciling twice changes nothing", () => {
        const once = reconcileActiveTaskId(tasks, "gone")
        expect(reconcileActiveTaskId(tasks, once)).toBe(once)
    })
})

describe("toggleSelectedId", () => {
    it("adds an id that was not selected", () => {
        expect(toggleSelectedId(["a"], "b")).toEqual(["a", "b"])
    })

    it("removes an id that was selected", () => {
        expect(toggleSelectedId(["a", "b", "c"], "b")).toEqual(["a", "c"])
    })

    it("selects into an empty list", () => {
        expect(toggleSelectedId([], "a")).toEqual(["a"])
        expect(toggleSelectedId(undefined, "a")).toEqual(["a"])
    })

    it("returns to the original list when toggled twice", () => {
        expect(toggleSelectedId(toggleSelectedId(["a"], "b"), "b")).toEqual(["a"])
    })

    it("does not mutate the selection it was handed", () => {
        const selected = ["a"]
        toggleSelectedId(selected, "b")
        expect(selected).toEqual(["a"])
    })
})
