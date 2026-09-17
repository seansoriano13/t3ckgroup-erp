import { screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApprovalSplitView } from "@/pages/approvals/_components/ApprovalSplitView"
import { taskService } from "@/services/taskService.js"
import { TASK_STATUS } from "@/constants/status.js"
import { db } from "@/test/db/store"
import { makeCategory, makeEmployee, makeHead, makeHrEmployee, makeTask } from "@/test/factories"
import { renderWithProviders, setupUser } from "@/test/support"
import { waitForNetworkIdle } from "@/test/network"

/**
 * The approval queue end to end below the page: the split view renders the
 * queue, the detail pane collects a grade and remarks, and the decision goes
 * through the real `taskService` into the fake database. What is being checked
 * here is the wiring — that what the reviewer sees on screen is what lands on
 * the row, and that the pipeline guards in the service still bite when the UI
 * asks for something the pipeline does not allow.
 *
 * The pure queue rules (staleness, filtering, shortcut resolution) are covered
 * in src/utils/approvalQueue.test.js and are not re-asserted here.
 *
 * Lives under src/test/pages rather than beside the component: Generouted
 * routes every file under src/pages with a hardcoded glob, so a test left
 * there becomes a route and pulls this harness into the production bundle.
 */

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }))
vi.mock("@/pages/../context/AuthContext", () => ({ useAuth: () => ({ user: null }) }))

const HOUR = 60 * 60 * 1000

/** The camelCase shape taskQueryService hands the page. */
function asQueueTask(row, { name, categoryId, ageHours = 1, ...rest } = {}) {
    return {
        id: row.id,
        taskDescription: row.task_description,
        checklist: row.checklist ?? null,
        categoryId: categoryId ?? row.category_id,
        loggedById: row.logged_by,
        loggedByName: name ?? "Ana Cruz",
        status: row.status,
        priority: row.priority,
        grade: row.grade,
        remarks: row.remarks ?? "",
        hrVerified: row.hr_verified,
        hrVerifiedAt: row.hr_verified_at ?? null,
        hrRemarks: row.hr_remarks ?? "",
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

function seedPending(overrides = {}) {
    const row = makeTask({
        logged_by: author.id,
        category_id: category.category_id,
        task_description: "Replace the office switch",
        status: TASK_STATUS.INCOMPLETE,
        ...overrides,
    })
    return asQueueTask(row, { name: author.name })
}

function renderQueue(tasks, { isHr = false, isVerifiedTab = false, currentUserId } = {}) {
    const onSelectTaskId = vi.fn()
    const onProcessTask = vi.fn((payload) =>
        taskService.updateTask(payload.id, { ...payload, editedBy: currentUserId ?? reviewer.id }),
    )

    const result = renderWithProviders(
        <ApprovalSplitView
            tasks={tasks}
            isHr={isHr}
            isVerifiedTab={isVerifiedTab}
            currentUserId={currentUserId ?? reviewer.id}
            activeTaskId={tasks[0]?.id}
            onSelectTaskId={onSelectTaskId}
            onProcessTask={onProcessTask}
        />,
    )
    return { ...result, onProcessTask, onSelectTaskId }
}

const rowOf = (taskId) => db.rows("tasks").find((t) => t.id === taskId)

describe("ApprovalSplitView", () => {
    describe("the queue", () => {
        it("lists every task waiting on the reviewer", () => {
            const tasks = [
                seedPending({ task_description: "Replace the office switch" }),
                seedPending({ task_description: "Patch the firewall" }),
            ]

            renderQueue(tasks)

            // The open task shows in both the queue row and the detail pane.
            expect(screen.getAllByText("Replace the office switch").length).toBeGreaterThan(0)
            expect(screen.getByText("Patch the firewall")).toBeInTheDocument()
        })

        it("says how much of the queue is on screen", () => {
            const tasks = [seedPending(), seedPending(), seedPending()]

            renderQueue(tasks)

            expect(screen.getByText("Queue (3 of 3)")).toBeInTheDocument()
        })

        it("tells the reviewer the queue is clear when there is nothing to do", () => {
            renderQueue([])

            expect(screen.getByText(/inbox zero/i)).toBeInTheDocument()
        })

        it("opens the task the reviewer clicks", async () => {
            const user = setupUser()
            const tasks = [
                seedPending({ task_description: "Replace the office switch" }),
                seedPending({ task_description: "Patch the firewall" }),
            ]
            const { onSelectTaskId } = renderQueue(tasks)

            await user.click(screen.getByText("Patch the firewall"))

            expect(onSelectTaskId).toHaveBeenCalledWith(tasks[1].id)
        })

        it("flags a task nobody has looked at for two days", () => {
            const tasks = [seedPending()]
            tasks[0].createdAt = new Date(Date.now() - 96 * HOUR).toISOString()

            renderQueue(tasks)

            expect(screen.getAllByText(/stale/i).length).toBeGreaterThan(0)
        })

        it("does not flag a task logged this morning", () => {
            renderQueue([seedPending()])

            expect(screen.queryByText(/stale/i)).not.toBeInTheDocument()
        })
    })

    describe("a manager approving a task", () => {
        it("writes the grade and remarks onto the task", async () => {
            const user = setupUser()
            const task = seedPending()
            renderQueue([task])

            await user.click(screen.getByRole("button", { name: /^4$/ }))
            await user.type(
                screen.getByPlaceholderText(/add evaluation remarks/i),
                "Neatly done",
            )
            await user.click(screen.getByRole("button", { name: /approve task/i }))

            await waitFor(() => {
                expect(rowOf(task.id).status).toBe(TASK_STATUS.COMPLETE)
            })
            const row = rowOf(task.id)
            expect(row.grade).toBe(4)
            expect(row.remarks).toBe("Neatly done")
            expect(row.evaluated_by).toBe(reviewer.id)
        })

        it("refuses to approve without a grade", async () => {
            const user = setupUser()
            const task = seedPending()
            const { onProcessTask } = renderQueue([task])

            const approve = screen.getByRole("button", { name: /approve task/i })
            expect(approve).toBeDisabled()

            await user.click(approve)

            expect(onProcessTask).not.toHaveBeenCalled()
            expect(rowOf(task.id).status).toBe(TASK_STATUS.INCOMPLETE)
        })

        it("leaves the task untouched when the reviewer only picks a grade", async () => {
            const user = setupUser()
            const task = seedPending()
            renderQueue([task])

            await user.click(screen.getByRole("button", { name: /^3$/ }))

            expect(rowOf(task.id).grade).toBe(0)
            expect(rowOf(task.id).status).toBe(TASK_STATUS.INCOMPLETE)
        })

        it("returns a task to the employee with the reviewer's reason", async () => {
            const user = setupUser()
            const task = seedPending()
            renderQueue([task])

            await user.type(
                screen.getByPlaceholderText(/add evaluation remarks/i),
                "Attach the delivery receipt",
            )
            await user.click(screen.getByRole("button", { name: /return task/i }))

            await waitFor(() => {
                expect(rowOf(task.id).status).toBe(TASK_STATUS.NOT_APPROVED)
            })
            expect(rowOf(task.id).remarks).toBe("Attach the delivery receipt")
        })

        it("refuses to return a task with no reason given", async () => {
            const user = setupUser()
            const task = seedPending()
            const { onProcessTask } = renderQueue([task])

            await user.click(screen.getByRole("button", { name: /return task/i }))

            expect(onProcessTask).not.toHaveBeenCalled()
            expect(rowOf(task.id).status).toBe(TASK_STATUS.INCOMPLETE)
        })

        it("surfaces a pipeline rejection instead of silently swallowing it", async () => {
            const user = setupUser()
            // Already approved and verified: the service will not let a manager
            // grade it again from here.
            const task = seedPending({
                status: TASK_STATUS.COMPLETE,
                hr_verified: true,
                evaluated_by: reviewer.id,
            })
            const { onProcessTask } = renderQueue([task])

            await user.click(screen.getByRole("button", { name: /^5$/ }))
            await user.click(screen.getByRole("button", { name: /approve task/i }))

            await waitFor(() => expect(onProcessTask).toHaveBeenCalled())
            await expect(onProcessTask.mock.results[0].value).rejects.toThrow(
                /Invalid pipeline transition/i,
            )
            expect(rowOf(task.id).grade).toBe(0)
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
            renderQueue([seedGraded()], { isHr: true, currentUserId: hr.id })

            expect(screen.getByText(/grade: 4 \/ 5/i)).toBeInTheDocument()
            expect(screen.getByText("Neatly done")).toBeInTheDocument()
        })

        it("signs the task off with the auditor's notes", async () => {
            const user = setupUser()
            const hr = makeHrEmployee()
            const task = seedGraded()
            renderQueue([task], { isHr: true, currentUserId: hr.id })

            await user.type(
                screen.getByPlaceholderText(/add hr audit notes/i),
                "Matches the payroll register",
            )
            await user.click(screen.getByRole("button", { name: /verify & sign/i }))

            await waitFor(() => expect(rowOf(task.id).hr_verified).toBe(true))
            const row = rowOf(task.id)
            expect(row.hr_remarks).toBe("Matches the payroll register")
            expect(row.hr_verified_at).toBeTruthy()
        })

        it("does not ask HR for a grade — that is the manager's call", () => {
            const hr = makeHrEmployee()
            renderQueue([seedGraded()], { isHr: true, currentUserId: hr.id })

            expect(screen.queryByText(/assign grade/i)).not.toBeInTheDocument()
        })

        it("refuses to return a task without audit notes", async () => {
            const user = setupUser()
            const hr = makeHrEmployee()
            const task = seedGraded()
            const { onProcessTask } = renderQueue([task], { isHr: true, currentUserId: hr.id })

            await user.click(screen.getByRole("button", { name: /^return \(x\)$/i }))

            expect(onProcessTask).not.toHaveBeenCalled()
            expect(rowOf(task.id).status).toBe(TASK_STATUS.COMPLETE)
        })

        it("returns a verified-queue task to the manager with a reason", async () => {
            const user = setupUser()
            const hr = makeHrEmployee()
            const task = seedGraded()
            renderQueue([task], { isHr: true, currentUserId: hr.id })

            await user.type(
                screen.getByPlaceholderText(/add hr audit notes/i),
                "Voucher number is missing",
            )
            await user.click(screen.getByRole("button", { name: /^return \(x\)$/i }))

            await waitFor(() => {
                expect(rowOf(task.id).status).toBe(TASK_STATUS.NOT_APPROVED)
            })
            expect(rowOf(task.id).hr_verified).toBe(false)
            expect(rowOf(task.id).hr_remarks).toBe("Voucher number is missing")
        })
    })

    describe("the already-decided tab", () => {
        function seedVerified() {
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
            renderQueue([seedVerified()], { isVerifiedTab: true })

            expect(
                screen.queryByRole("button", { name: /approve task/i }),
            ).not.toBeInTheDocument()
            expect(
                screen.queryByRole("button", { name: /return task/i }),
            ).not.toBeInTheDocument()
        })

        it("opens the decision for editing when the reviewer asks", async () => {
            const user = setupUser()
            renderQueue([seedVerified()], { isVerifiedTab: true })

            await user.click(screen.getByRole("button", { name: /edit evaluation/i }))

            expect(
                screen.getByRole("button", { name: /save changes/i }),
            ).toBeInTheDocument()
        })

        it("abandons an edit on cancel without touching the task", async () => {
            const user = setupUser()
            const task = seedVerified()
            renderQueue([task], { isVerifiedTab: true })

            await user.click(screen.getByRole("button", { name: /edit evaluation/i }))
            await user.type(
                screen.getByPlaceholderText(/add evaluation remarks/i),
                " and then some",
            )
            await user.click(screen.getByRole("button", { name: /cancel/i }))

            await waitForNetworkIdle()
            expect(rowOf(task.id).remarks).toBe("Excellent")
        })
    })

    describe("keyboard triage", () => {
        it("grades with the number keys and submits on Enter", async () => {
            const user = setupUser()
            const task = seedPending()
            renderQueue([task])

            await user.keyboard("3")
            await user.keyboard("{Enter}")

            await waitFor(() => {
                expect(rowOf(task.id).status).toBe(TASK_STATUS.COMPLETE)
            })
            expect(rowOf(task.id).grade).toBe(3)
        })

        it("does not act on a keystroke aimed at the remarks box", async () => {
            const user = setupUser()
            const task = seedPending()
            renderQueue([task])

            const remarks = screen.getByPlaceholderText(/add evaluation remarks/i)
            await user.click(remarks)
            await user.keyboard("3x")

            expect(remarks).toHaveValue("3x")
            expect(rowOf(task.id).status).toBe(TASK_STATUS.INCOMPLETE)
        })

        it("leaves a task alone when Enter is pressed on the queue row", async () => {
            const user = setupUser()
            const task = seedPending()
            renderQueue([task])

            // Clicking a row leaves it focused. Enter there means "open this
            // task", and must not double as "approve it".
            const row = document.querySelector("[data-approval-queue] [role='button']")
            row.focus()
            await user.keyboard("{Enter}")

            await waitForNetworkIdle()
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
            renderQueue([task], { isVerifiedTab: true })

            await user.keyboard("2")
            await user.keyboard("{Enter}")

            await waitForNetworkIdle()
            expect(rowOf(task.id).grade).toBe(5)
        })
    })

    describe("moving through the queue", () => {
        it("walks to the next task on J", async () => {
            const user = setupUser()
            const tasks = [seedPending(), seedPending()]
            const { onSelectTaskId } = renderQueue(tasks)

            await user.keyboard("j")

            expect(onSelectTaskId).toHaveBeenCalledWith(tasks[1].id)
        })

        it("walks back on K", async () => {
            const user = setupUser()
            const tasks = [seedPending(), seedPending()]
            const onSelectTaskId = vi.fn()
            renderWithProviders(
                <ApprovalSplitView
                    tasks={tasks}
                    currentUserId={reviewer.id}
                    activeTaskId={tasks[1].id}
                    onSelectTaskId={onSelectTaskId}
                    onProcessTask={vi.fn()}
                />,
            )

            await user.keyboard("k")

            expect(onSelectTaskId).toHaveBeenCalledWith(tasks[0].id)
        })

        it("stays put at the end of the queue", async () => {
            const user = setupUser()
            const tasks = [seedPending()]
            const { onSelectTaskId } = renderQueue(tasks)
            onSelectTaskId.mockClear()

            await user.keyboard("j")

            expect(onSelectTaskId).not.toHaveBeenCalled()
        })
    })

    describe("bulk selection", () => {
        it("hands the selection back to the page", async () => {
            const user = setupUser()
            const tasks = [seedPending()]
            const onToggleTaskSelection = vi.fn()

            renderWithProviders(
                <ApprovalSplitView
                    tasks={tasks}
                    currentUserId={reviewer.id}
                    activeTaskId={tasks[0].id}
                    onSelectTaskId={vi.fn()}
                    onProcessTask={vi.fn()}
                    onToggleTaskSelection={onToggleTaskSelection}
                />,
            )

            await user.click(screen.getByTitle(/select for bulk action/i))

            expect(onToggleTaskSelection).toHaveBeenCalledWith(tasks[0].id)
        })

        it("hides the checkboxes when bulk approval is switched off", () => {
            const tasks = [seedPending()]

            renderWithProviders(
                <ApprovalSplitView
                    tasks={tasks}
                    currentUserId={reviewer.id}
                    activeTaskId={tasks[0].id}
                    onSelectTaskId={vi.fn()}
                    onProcessTask={vi.fn()}
                    enableBulkApproval={false}
                />,
            )

            expect(
                screen.queryByTitle(/select for bulk action/i),
            ).not.toBeInTheDocument()
        })
    })
})
