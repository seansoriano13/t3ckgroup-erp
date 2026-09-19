import { screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { TASK_STATUS } from "@/constants/status.js"
import { db } from "@/test/db/store"
import { makeCategory, makeEmployee, makeHead, makeHrEmployee, makeSuperAdmin, makeTask } from "@/test/factories"
import { renderWithProviders, setupUser } from "@/test/support"
import { waitForNetworkIdle } from "@/test/network"

/**
 * End-to-end journeys through the approval queues.
 *
 * Deliberately few, and deliberately whole: each one is a route a real reviewer
 * walks from landing on the page to the row changing in the database — mount
 * the page, let it fetch, read the queue, act, and check what the next person
 * would see. Nothing is stubbed between the page and the database except the
 * session, because "who is signed in" is the one thing a test has to assert
 * rather than perform.
 *
 * The narrow rules these journeys pass through are covered far more cheaply one
 * layer down: pure queue logic in src/utils/approvalQueue.test.js, and the
 * component-to-service wiring in components/ApprovalSplitView.test.jsx. Add a
 * journey here only for a path a user actually takes end to end.
 *
 * Lives under src/test/pages rather than beside the pages: Generouted routes
 * every file under src/pages with a hardcoded glob, so a test left there
 * becomes a route and pulls this harness into the production bundle.
 */

const mockUser = vi.hoisted(() => ({ current: null }))
const auth = () => ({ user: mockUser.current, isAuthLoading: false })

vi.mock("@/context/AuthContext", () => ({ useAuth: auth }))
vi.mock("@/pages/../context/AuthContext", () => ({ useAuth: auth }))

const HOUR = 60 * 60 * 1000
const ago = (hours) => new Date(Date.now() - hours * HOUR).toISOString()

let author
let colleague
let reviewer
let category

beforeEach(() => {
    author = makeEmployee({ name: "Ana Cruz" })
    colleague = makeEmployee({ name: "Ben Reyes" })
    reviewer = makeHead({ name: "Head Ito" })
    category = makeCategory({ category_id: "IT-01", description: "IT Support" })
    mockUser.current = null
})

/** A task sitting in the manager's queue, reported to the reviewer. */
function pendingTask(overrides = {}) {
    return makeTask({
        logged_by: author.id,
        category_id: category.category_id,
        reported_to: reviewer.id,
        status: TASK_STATUS.INCOMPLETE,
        created_at: ago(2),
        ...overrides,
    })
}

async function renderPage(Page, as) {
    mockUser.current = as
    const result = renderWithProviders(
        <MemoryRouter>
            <Page />
        </MemoryRouter>,
    )
    await waitForQueue()
    return result
}

/** Waits for the initial fetch to settle into a rendered queue or empty state. */
async function waitForQueue() {
    await waitFor(
        () => {
            expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
        },
        { timeout: 5000 },
    )
}

const rowOf = (taskId) => db.rows("tasks").find((t) => t.id === taskId)

const loadTasksPage = async () =>
    (await import("@/pages/approvals/tasks/index.jsx")).default

const loadHrPage = async () =>
    (await import("@/pages/approvals/hr-verification/index.jsx")).default

describe("approval journeys", () => {
    it("a manager grades a task from their queue and it leaves the queue", { timeout: 20000 }, async () => {
        const user = setupUser()
        const task = pendingTask({ task_description: "Replace the office switch" })
        const TaskApprovals = await loadTasksPage()

        await renderPage(TaskApprovals, reviewer)

        // The task is waiting, and opening the page opens it in the pane.
        await waitFor(() => {
            expect(
                screen.getAllByText("Replace the office switch").length,
            ).toBeGreaterThan(0)
        })

        await user.click(screen.getByRole("button", { name: /^4$/ }))
        await user.type(
            screen.getByPlaceholderText(/add evaluation remarks/i),
            "Clean install, receipt attached",
        )
        await user.click(screen.getByRole("button", { name: /approve task/i }))

        await waitFor(() => expect(rowOf(task.id).status).toBe(TASK_STATUS.COMPLETE))
        const row = rowOf(task.id)
        expect(row.grade).toBe(4)
        expect(row.remarks).toBe("Clean install, receipt attached")
        expect(row.evaluated_by).toBe(reviewer.id)

        // And the queue no longer offers it for grading.
        await waitFor(() => {
            expect(
                screen.queryByPlaceholderText(/add evaluation remarks/i),
            ).not.toBeInTheDocument()
        })
        expect(screen.getByText(/queue is clear/i)).toBeInTheDocument()
    })

    it("a manager sends a task back and the employee gets the reason", async () => {
        const user = setupUser()
        const task = pendingTask({ task_description: "Quarterly stock count" })
        const TaskApprovals = await loadTasksPage()

        await renderPage(TaskApprovals, reviewer)

        await waitFor(() => {
            expect(screen.getAllByText("Quarterly stock count").length).toBeGreaterThan(0)
        })

        await user.type(
            screen.getByPlaceholderText(/add evaluation remarks/i),
            "Counts do not match the ledger",
        )
        await user.click(screen.getByRole("button", { name: /return task/i }))

        await waitFor(() =>
            expect(rowOf(task.id).status).toBe(TASK_STATUS.NOT_APPROVED),
        )
        expect(rowOf(task.id).remarks).toBe("Counts do not match the ledger")
    })

    it("a manager triages a whole queue from the keyboard without touching the mouse", async () => {
        const user = setupUser()
        const first = pendingTask({
            task_description: "Patch the firewall",
            created_at: ago(5),
        })
        const second = pendingTask({
            task_description: "Rotate the backup tapes",
            created_at: ago(4),
        })
        const TaskApprovals = await loadTasksPage()

        await renderPage(TaskApprovals, reviewer)
        await waitFor(() => {
            expect(screen.getAllByText("Patch the firewall").length).toBeGreaterThan(0)
        })

        // Grade and approve the first, auto-advance lands on the second.
        await user.keyboard("5")
        await user.keyboard("{Enter}")
        await waitFor(() => expect(rowOf(first.id).status).toBe(TASK_STATUS.COMPLETE))

        await waitFor(() => {
            expect(screen.getAllByText("Rotate the backup tapes").length).toBeGreaterThan(0)
        })
        await user.keyboard("3")
        await user.keyboard("{Enter}")

        await waitFor(() => expect(rowOf(second.id).status).toBe(TASK_STATUS.COMPLETE))
        expect(rowOf(first.id).grade).toBe(5)
        expect(rowOf(second.id).grade).toBe(3)
    })

    it("a manager narrows a busy queue to one person before grading", async () => {
        const user = setupUser()
        const hers = pendingTask({ task_description: "Replace the office switch" })
        makeTask({
            logged_by: colleague.id,
            category_id: category.category_id,
            reported_to: reviewer.id,
            status: TASK_STATUS.INCOMPLETE,
            task_description: "Reconcile the petty cash",
            created_at: ago(3),
        })
        const TaskApprovals = await loadTasksPage()

        await renderPage(TaskApprovals, reviewer)
        await waitFor(() => {
            expect(screen.getAllByText("Reconcile the petty cash").length).toBeGreaterThan(0)
        })

        // The quick-filter chips name everyone with work in the queue.
        const chip = await screen.findByRole("button", { name: /Ana Cruz\s*1/ })
        await user.click(chip)

        await waitFor(() => {
            expect(screen.queryAllByText("Reconcile the petty cash")).toHaveLength(0)
        })
        expect(screen.getAllByText("Replace the office switch").length).toBeGreaterThan(0)
        expect(hers.logged_by).toBe(author.id)
    })

    it("a manager splits the backlog out from today's work", async () => {
        const user = setupUser()
        pendingTask({ task_description: "Patch the firewall", created_at: ago(2) })
        pendingTask({ task_description: "Archive the 2025 tickets", created_at: ago(120) })
        const TaskApprovals = await loadTasksPage()

        await renderPage(TaskApprovals, reviewer)
        await waitFor(() => {
            expect(screen.getAllByText("Archive the 2025 tickets").length).toBeGreaterThan(0)
        })

        await user.click(screen.getByRole("tab", { name: /stale backlog/i }))

        await waitFor(() => {
            expect(screen.queryAllByText("Patch the firewall")).toHaveLength(0)
        })
        expect(
            screen.getAllByText("Archive the 2025 tickets").length,
        ).toBeGreaterThan(0)
    })

    it("HR audits a graded task and signs it off for payroll", async () => {
        const user = setupUser()
        const hr = makeHrEmployee({ name: "Hera Dela Cruz" })
        const task = makeTask({
            logged_by: author.id,
            category_id: category.category_id,
            task_description: "Replace the office switch",
            status: TASK_STATUS.COMPLETE,
            grade: 4,
            remarks: "Clean install",
            evaluated_by: reviewer.id,
            hr_verified: false,
            created_at: ago(6),
        })
        const HrVerification = await loadHrPage()

        await renderPage(HrVerification, hr)

        await waitFor(() => {
            expect(screen.getByText(/grade: 4 \/ 5/i)).toBeInTheDocument()
        })
        expect(screen.getByText("Clean install")).toBeInTheDocument()

        await user.type(
            screen.getByPlaceholderText(/add hr audit notes/i),
            "Matches the payroll register",
        )
        await user.click(screen.getByRole("button", { name: /verify & sign/i }))

        await waitFor(() => expect(rowOf(task.id).hr_verified).toBe(true))
        expect(rowOf(task.id).hr_remarks).toBe("Matches the payroll register")
    })

    it("HR sends a task back to the manager and it leaves the verification queue", async () => {
        const user = setupUser()
        const hr = makeHrEmployee({ name: "Hera Dela Cruz" })
        const task = makeTask({
            logged_by: author.id,
            category_id: category.category_id,
            task_description: "Quarterly stock count",
            status: TASK_STATUS.COMPLETE,
            grade: 5,
            evaluated_by: reviewer.id,
            hr_verified: false,
            created_at: ago(6),
        })
        const HrVerification = await loadHrPage()

        await renderPage(HrVerification, hr)
        await waitFor(() => {
            expect(screen.getByPlaceholderText(/add hr audit notes/i)).toBeInTheDocument()
        })

        await user.type(
            screen.getByPlaceholderText(/add hr audit notes/i),
            "Payment voucher is missing",
        )
        await user.click(screen.getByRole("button", { name: /^return \(x\)$/i }))

        await waitFor(() =>
            expect(rowOf(task.id).status).toBe(TASK_STATUS.NOT_APPROVED),
        )
        await waitFor(() => {
            expect(screen.getByText(/hr queue is clear/i)).toBeInTheDocument()
        })
    })

    it("an HR-only user landing on the manager queue is pointed at their own", async () => {
        const hr = makeHrEmployee({ name: "Hera Dela Cruz" })
        const TaskApprovals = await loadTasksPage()

        await renderPage(TaskApprovals, hr)

        await waitFor(() => {
            expect(screen.getByText(/manager queue/i)).toBeInTheDocument()
        })
        expect(
            screen.getByRole("link", { name: "/approvals/hr-verification" }),
        ).toHaveAttribute("href", "/approvals/hr-verification")
        await waitForNetworkIdle()
    })

    it("a reviewer with nothing waiting sees an empty queue rather than an error", async () => {
        const TaskApprovals = await loadTasksPage()

        await renderPage(TaskApprovals, reviewer)

        await waitFor(() => {
            expect(screen.getByText(/queue is clear/i)).toBeInTheDocument()
        })
    })

    it("a manager reopens an approved task and corrects the grade", async () => {
        const user = setupUser()
        const task = makeTask({
            logged_by: author.id,
            category_id: category.category_id,
            task_description: "Replace the office switch",
            reported_to: reviewer.id,
            status: TASK_STATUS.COMPLETE,
            grade: 2,
            remarks: "Late",
            evaluated_by: reviewer.id,
            hr_verified: false,
            created_at: ago(8),
        })
        const TaskApprovals = await loadTasksPage()

        await renderPage(TaskApprovals, reviewer)

        await user.click(screen.getByRole("tab", { name: /recently approved/i }))

        const edit = await screen.findByRole("button", { name: /edit evaluation/i })
        await user.click(edit)

        await user.click(screen.getByRole("button", { name: /^4$/ }))
        await user.click(screen.getByRole("button", { name: /save changes/i }))

        await waitFor(() => expect(rowOf(task.id).grade).toBe(4))
    })

    it("HR verification queue correctly filters super admins and measures staleness from evaluated_at", async () => {
        const user = setupUser()
        const hr = makeHrEmployee({ name: "Hera HR" })
        const superAdmin = makeSuperAdmin({ name: "Bruce Admin" })

        // Task 1: Logged long ago (60h), but graded just now (1h ago) -> Should be ACTIVE
        makeTask({
            logged_by: author.id,
            category_id: category.category_id,
            task_description: "Active Task",
            status: TASK_STATUS.COMPLETE,
            grade: 5,
            evaluated_by: reviewer.id,
            evaluated_at: ago(1),
            hr_verified: false,
            created_at: ago(60),
        })

        // Task 2: Logged by a super admin
        makeTask({
            logged_by: superAdmin.id,
            category_id: category.category_id,
            task_description: "Admin Task",
            status: TASK_STATUS.COMPLETE,
            grade: 5,
            evaluated_by: reviewer.id,
            evaluated_at: ago(1),
            hr_verified: false,
            created_at: ago(2),
        })

        const HrVerification = await loadHrPage()
        
        // Clear the module-level cache from previous tests so it fetches the new superAdmin
        const { employeeService } = await import("@/services/employeeService.js")
        employeeService.allEmployeesCache = null

        await renderPage(HrVerification, hr)
        await waitForNetworkIdle()

        // 1. Check Tabs (measures staleness from evaluated_at)
        expect(screen.getByRole("tab", { name: /Active.*graded.*2/i })).toBeInTheDocument()
        
        // Using .* for >= to avoid encoding issues when editing files via shell/API
        expect(screen.getByRole("tab", { name: /Stale Backlog \(.*48h graded\)/i })).toBeInTheDocument()

        // 2. The Quick Filter Chips (queueEmployees) SHOULD show Bruce Admin, since he has a pending task
        // We use getAllByRole because there is 1 Quick Filter Chip AND 1 Task Card for Bruce Admin!
        expect(screen.getAllByRole("button", { name: /Bruce Admin/ })).toHaveLength(2)

        // 3. Open Advanced Filters
        await user.click(screen.getByRole("button", { name: /Filters/i }))

        // 4. Open Employee filter dropdown
        const employeeFilterBtn = screen.getByText("Logged By: Everyone").closest("div")
        await user.click(employeeFilterBtn)
        
        // 5. The dropdown listbox should render "Ana Cruz" (uniqueEmployees filter).
        // Since she has 1 Task Card, 1 Quick Filter Chip, and 1 Dropdown Option, it should be 3!
        await waitFor(() => {
            expect(screen.getAllByRole("button", { name: /Ana Cruz/ })).toHaveLength(3)
        })
        
        // Bruce Admin should ONLY be in the Quick Filter Chips (1) and Task Card (1), NOT in the dropdown!
        expect(screen.getAllByRole("button", { name: /Bruce Admin/ })).toHaveLength(2)
    })
})

