import { screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApprovalTable } from "@/pages/approvals/_components/ApprovalTable"
import { TaskReview } from "@/pages/approvals/_components/TaskReview"
import { taskService } from "@/services/taskService.js"
import { TASK_STATUS } from "@/constants/status.js"
import { taskToItem } from "@/utils/approvalItems.js"
import { db } from "@/test/db/store"
import { makeCategory, makeEmployee, makeHead, makeHrEmployee, makeTask } from "@/test/factories"
import { renderWithProviders, setupUser } from "@/test/support"
import { waitForNetworkIdle } from "@/test/network"

/**
 * The Approval Center below the page: the table lists the queue and opens a
 * row, and the review collects a grade and remarks and sends the decision
 * through the real `taskService` into the fake database. What is checked is the
 * wiring — what the reviewer sees is what lands on the row, and the pipeline
 * guards in the service still bite when the UI asks for something it forbids.
 *
 * The pure rules (staleness, selectors, shortcut resolution, item shape) are in
 * src/utils/approvalQueue.test.js and src/utils/approvalItems.test.js.
 *
 * Lives under src/test/pages: Generouted routes every file under src/pages, so
 * a test left there becomes a route and ships this harness.
 */

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }))
vi.mock("@/pages/../context/AuthContext", () => ({ useAuth: () => ({ user: null }) }))

const HOUR = 60 * 60 * 1000

/** The camelCase shape taskQueryService hands the page. */
function asQueueTask(row, { name, ageHours = 1, ...rest } = {}) {
    return {
        id: row.id,
        taskDescription: row.task_description,
        checklist: row.checklist ?? null,
        categoryId: row.category_id,
        loggedById: row.logged_by,
        loggedByName: name ?? "Ana Cruz",
        status: row.status,
        priority: row.priority,
        grade: row.grade,
        remarks: row.remarks ?? "",
        hrVerified: row.hr_verified,
        hrVerifiedAt: row.hr_verified_at ?? null,
        hrRemarks: row.hr_remarks ?? "",
        evaluatedById: row.evaluated_by ?? null,
        attachments: [],
        endAt: row.end_at ?? null,
        createdAt: new Date(Date.now() - ageHours * HOUR).toISOString(),
        ...rest,
    }
}

let author
let reviewer
let category

beforeEach(() => {
    author = makeEmployee({ name: "Ana Cruz" })
    reviewer = makeHead({ name: "Head Ito" })
    category = makeCategory({ category_id: "IT-01" })
})

function seedPending(overrides = {}, queueTask = {}) {
    const row = makeTask({
        logged_by: author.id,
        category_id: category.category_id,
        task_description: "Replace the office switch",
        status: TASK_STATUS.INCOMPLETE,
        ...overrides,
    })
    return asQueueTask(row, { name: author.name, ...queueTask })
}

function renderReview(task, { queue = "tasks", currentUserId = reviewer.id } = {}) {
    const onProcess = vi.fn((payload) => taskService.updateTask(payload.id, { ...payload, editedBy: currentUserId }))
    const onDecided = vi.fn()
    const result = renderWithProviders(
        <TaskReview item={taskToItem(task, queue)} currentUserId={currentUserId} onProcess={onProcess} onDecided={onDecided} />,
    )
    return { ...result, onProcess, onDecided }
}

function renderTable(tasks, props = {}) {
    const onOpen = vi.fn()
    const items = tasks.map((t) => taskToItem(t, "tasks"))
    const result = renderWithProviders(
        <ApprovalTable items={items} queueIcon={() => null} onOpen={onOpen} empty={{ title: "Queue is Clear!", description: "" }} {...props} />,
    )
    return { ...result, onOpen, items }
}

const rowOf = (taskId) => db.rows("tasks").find((t) => t.id === taskId)

describe("ApprovalTable", () => {
    it("lists every task waiting on the reviewer", () => {
        renderTable([seedPending({ task_description: "Replace the office switch" }), seedPending({ task_description: "Patch the firewall" })])

        expect(screen.getByText("Replace the office switch")).toBeInTheDocument()
        expect(screen.getByText("Patch the firewall")).toBeInTheDocument()
        expect(screen.getByText("2 requests")).toBeInTheDocument()
    })

    it("tells the reviewer the queue is clear when there is nothing to do", () => {
        renderTable([])

        expect(screen.getByText(/queue is clear/i)).toBeInTheDocument()
    })

    it("opens the task the reviewer clicks", async () => {
        const user = setupUser()
        const tasks = [seedPending({ task_description: "Replace the office switch" }), seedPending({ task_description: "Patch the firewall" })]
        const { onOpen } = renderTable(tasks)

        await user.click(screen.getByText("Patch the firewall"))

        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: tasks[1].id }))
    })

    it("flags a task nobody has looked at for two days", () => {
        renderTable([seedPending({}, { ageHours: 96 })])

        expect(screen.getByText(/overdue/i)).toBeInTheDocument()
    })

    it("does not flag a task logged this morning", () => {
        renderTable([seedPending()])

        expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument()
        expect(screen.getByText(/pending/i)).toBeInTheDocument()
    })

    it("walks the cursor with J and opens it on Enter", async () => {
        const user = setupUser()
        const tasks = [seedPending(), seedPending()]
        const { onOpen } = renderTable(tasks)

        await user.keyboard("j")
        await user.keyboard("{Enter}")

        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: tasks[1].id }))
    })

    it("walks back on K and stays put at the top", async () => {
        const user = setupUser()
        const tasks = [seedPending(), seedPending()]
        const { onOpen } = renderTable(tasks)

        await user.keyboard("jkk")
        await user.keyboard("{Enter}")

        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: tasks[0].id }))
    })

    it("leaves the keys alone while the review sheet has them", async () => {
        const user = setupUser()
        const { onOpen } = renderTable([seedPending()], { keyboard: false })

        await user.keyboard("{Enter}")

        expect(onOpen).not.toHaveBeenCalled()
    })

    it("hands the selection back to the page", async () => {
        const user = setupUser()
        const tasks = [seedPending()]
        const onToggle = vi.fn()
        renderTable(tasks, { selectable: true, onToggle })

        await user.click(screen.getByRole("checkbox", { name: /select replace the office switch/i }))

        expect(onToggle).toHaveBeenCalledWith(tasks[0].id)
    })

    it("hides the checkboxes when bulk approval is switched off", () => {
        renderTable([seedPending()])

        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    })
})

describe("TaskReview", () => {
    describe("a manager approving a task", () => {
        it("writes the grade and remarks onto the task", async () => {
            const user = setupUser()
            const task = seedPending()
            const { onDecided } = renderReview(task)

            await user.click(screen.getByRole("button", { name: /^4$/ }))
            await user.type(screen.getByPlaceholderText(/add evaluation remarks/i), "Neatly done")
            await user.click(screen.getByRole("button", { name: /^approve$/i }))

            await waitFor(() => expect(rowOf(task.id).status).toBe(TASK_STATUS.COMPLETE))
            const row = rowOf(task.id)
            expect(row.grade).toBe(4)
            expect(row.remarks).toBe("Neatly done")
            expect(row.evaluated_by).toBe(reviewer.id)
            await waitFor(() => expect(onDecided).toHaveBeenCalled())
        })

        it("refuses to approve without a grade", async () => {
            const user = setupUser()
            const task = seedPending()
            const { onProcess } = renderReview(task)

            const approve = screen.getByRole("button", { name: /^approve$/i })
            expect(approve).toBeDisabled()
            await user.click(approve)

            expect(onProcess).not.toHaveBeenCalled()
            expect(rowOf(task.id).status).toBe(TASK_STATUS.INCOMPLETE)
        })

        it("leaves the task untouched when the reviewer only picks a grade", async () => {
            const user = setupUser()
            const task = seedPending()
            renderReview(task)

            await user.click(screen.getByRole("button", { name: /^3$/ }))

            expect(rowOf(task.id).grade).toBe(0)
            expect(rowOf(task.id).status).toBe(TASK_STATUS.INCOMPLETE)
        })

        it("returns a task to the employee with the reviewer's reason", async () => {
            const user = setupUser()
            const task = seedPending()
            renderReview(task)

            await user.type(screen.getByPlaceholderText(/add evaluation remarks/i), "Attach the delivery receipt")
            await user.click(screen.getByRole("button", { name: /^return$/i }))

            await waitFor(() => expect(rowOf(task.id).status).toBe(TASK_STATUS.NOT_APPROVED))
            expect(rowOf(task.id).remarks).toBe("Attach the delivery receipt")
        })

        it("refuses to return a task with no reason given", async () => {
            const user = setupUser()
            const task = seedPending()
            const { onProcess } = renderReview(task)

            await user.click(screen.getByRole("button", { name: /^return$/i }))

            expect(onProcess).not.toHaveBeenCalled()
            expect(rowOf(task.id).status).toBe(TASK_STATUS.INCOMPLETE)
        })

        it("adds a remark preset to what is already written", async () => {
            const user = setupUser()
            renderReview(seedPending())

            const box = screen.getByPlaceholderText(/add evaluation remarks/i)
            await user.type(box, "Good.")
            await user.click(screen.getByRole("button", { name: "Great quality work!" }))

            expect(box).toHaveValue("Good. Great quality work!")
        })

        it("surfaces a pipeline rejection instead of silently swallowing it", async () => {
            const user = setupUser()
            // Already approved and verified: the service will not let a manager
            // grade it again from here. Shown as pending so the controls render.
            const task = seedPending({ status: TASK_STATUS.COMPLETE, hr_verified: true, evaluated_by: reviewer.id }, { status: TASK_STATUS.INCOMPLETE })
            const { onProcess, onDecided } = renderReview(task)

            await user.click(screen.getByRole("button", { name: /^5$/ }))
            await user.click(screen.getByRole("button", { name: /^approve$/i }))

            await waitFor(() => expect(onProcess).toHaveBeenCalled())
            await expect(onProcess.mock.results[0].value).rejects.toThrow(/Invalid pipeline transition/i)
            expect(rowOf(task.id).grade).toBe(0)
            expect(onDecided).not.toHaveBeenCalled()
        })
    })

    describe("HR verifying a graded task", () => {
        function seedGraded() {
            const row = makeTask({
                logged_by: author.id,
                category_id: category.category_id,
                task_description: "Replace the office switch",
                status: TASK_STATUS.COMPLETE,
                grade: 4,
                remarks: "Neatly done",
                evaluated_by: reviewer.id,
                hr_verified: false,
            })
            return asQueueTask(row, { name: author.name })
        }

        it("shows HR what the manager already decided", () => {
            const hr = makeHrEmployee()
            renderReview(seedGraded(), { queue: "hr", currentUserId: hr.id })

            expect(screen.getByText("Grade 4 of 5")).toBeInTheDocument()
            expect(screen.getByText("Neatly done")).toBeInTheDocument()
        })

        it("signs the task off with the auditor's notes", async () => {
            const user = setupUser()
            const hr = makeHrEmployee()
            const task = seedGraded()
            renderReview(task, { queue: "hr", currentUserId: hr.id })

            await user.type(screen.getByPlaceholderText(/add hr audit notes/i), "Matches the payroll register")
            await user.click(screen.getByRole("button", { name: /verify & sign/i }))

            await waitFor(() => expect(rowOf(task.id).hr_verified).toBe(true))
            expect(rowOf(task.id).hr_remarks).toBe("Matches the payroll register")
            expect(rowOf(task.id).hr_verified_at).toBeTruthy()
        })

        it("does not ask HR for a grade — that is the manager's call", () => {
            const hr = makeHrEmployee()
            renderReview(seedGraded(), { queue: "hr", currentUserId: hr.id })

            expect(screen.queryByRole("button", { name: /^[1-5]$/ })).not.toBeInTheDocument()
        })

        it("refuses to return a task without audit notes", async () => {
            const user = setupUser()
            const hr = makeHrEmployee()
            const task = seedGraded()
            const { onProcess } = renderReview(task, { queue: "hr", currentUserId: hr.id })

            await user.click(screen.getByRole("button", { name: /^return$/i }))

            expect(onProcess).not.toHaveBeenCalled()
            expect(rowOf(task.id).status).toBe(TASK_STATUS.COMPLETE)
        })

        it("returns a task to the manager with a reason", async () => {
            const user = setupUser()
            const hr = makeHrEmployee()
            const task = seedGraded()
            renderReview(task, { queue: "hr", currentUserId: hr.id })

            await user.type(screen.getByPlaceholderText(/add hr audit notes/i), "Voucher number is missing")
            await user.click(screen.getByRole("button", { name: /^return$/i }))

            await waitFor(() => expect(rowOf(task.id).status).toBe(TASK_STATUS.NOT_APPROVED))
            expect(rowOf(task.id).hr_verified).toBe(false)
            expect(rowOf(task.id).hr_remarks).toBe("Voucher number is missing")
        })
    })

    describe("an already-decided task", () => {
        function seedApproved() {
            const row = makeTask({
                logged_by: author.id,
                category_id: category.category_id,
                status: TASK_STATUS.COMPLETE,
                grade: 5,
                remarks: "Excellent",
                evaluated_by: reviewer.id,
                hr_verified: true,
            })
            return asQueueTask(row, { name: author.name })
        }

        it("shows the decision without offering the action buttons", () => {
            renderReview(seedApproved())

            expect(screen.getByText(/approved · grade 5\/5/i)).toBeInTheDocument()
            expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument()
            expect(screen.queryByRole("button", { name: /^return$/i })).not.toBeInTheDocument()
        })

        it("opens the decision for editing when the reviewer asks", async () => {
            const user = setupUser()
            renderReview(seedApproved())

            await user.click(screen.getByRole("button", { name: /edit evaluation/i }))

            expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument()
        })

        it("abandons an edit on cancel without touching the task", async () => {
            const user = setupUser()
            const task = seedApproved()
            renderReview(task)

            await user.click(screen.getByRole("button", { name: /edit evaluation/i }))
            await user.type(screen.getByPlaceholderText(/add evaluation remarks/i), " and then some")
            await user.click(screen.getByRole("button", { name: /cancel/i }))

            await waitForNetworkIdle()
            expect(rowOf(task.id).remarks).toBe("Excellent")
        })
    })

    describe("keyboard triage", () => {
        it("grades with the number keys and submits on Enter", async () => {
            const user = setupUser()
            const task = seedPending()
            renderReview(task)

            await user.keyboard("3")
            await user.keyboard("{Enter}")

            await waitFor(() => expect(rowOf(task.id).status).toBe(TASK_STATUS.COMPLETE))
            expect(rowOf(task.id).grade).toBe(3)
        })

        it("does not act on a keystroke aimed at the remarks box", async () => {
            const user = setupUser()
            const task = seedPending()
            renderReview(task)

            const remarks = screen.getByPlaceholderText(/add evaluation remarks/i)
            await user.click(remarks)
            await user.keyboard("3x")

            expect(remarks).toHaveValue("3x")
            expect(rowOf(task.id).status).toBe(TASK_STATUS.INCOMPLETE)
        })

        it("does not grade a task the reviewer is only reading", async () => {
            const user = setupUser()
            const row = makeTask({
                logged_by: author.id,
                category_id: category.category_id,
                status: TASK_STATUS.COMPLETE,
                grade: 5,
                evaluated_by: reviewer.id,
                hr_verified: true,
            })
            const task = asQueueTask(row, { name: author.name })
            renderReview(task)

            await user.keyboard("2")
            await user.keyboard("{Enter}")

            await waitForNetworkIdle()
            expect(rowOf(task.id).grade).toBe(5)
        })
    })
})
