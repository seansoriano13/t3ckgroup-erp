/**
 * Quick View — the landing spot for every task-originated entry into
 * an SOR: this viewer's own open Tasks on the deal, and what's still open on
 * its current Stage (not personal — conditions carry no assignee in the data
 * model), with "View Full Details" as the deliberate escalation to the full
 * SorModal.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders, setupUser } from "../../test/support"
import OpportunityQuickView from "./OpportunityQuickView"
import { opportunityService } from "../../services/opportunityService"
import { taskService } from "../../services/taskService"
import { CONDITION_STATUS } from "../../constants/stageGate"

const OPPORTUNITY = { id: "opp-1", sales_reference: "S99001", client_name: "Acme Corp", project_title: "Fit-out" }

vi.mock("../../services/opportunityService", () => ({
  opportunityService: {
    getStageChecklist: vi.fn(async () => []),
  },
}))

vi.mock("../../services/taskService", () => ({
  taskService: {
    getMyOpenTasksForOpportunity: vi.fn(async () => []),
  },
}))

const condition = (overrides = {}) => ({
  condition: { id: "cond-1", label: "Signed contract on file", sort_order: 0, ...overrides.condition },
  status: CONDITION_STATUS.UNSATISFIED,
  satisfiedBy: null,
  satisfiedAt: null,
  ...overrides,
})

function renderQuickView(props = {}) {
  const onClose = vi.fn()
  const onViewFullDetails = vi.fn()
  const onOpenTask = vi.fn()
  const onOpenGroupTask = vi.fn()
  const result = renderWithProviders(
    <OpportunityQuickView
      isOpen
      onClose={onClose}
      opportunity={OPPORTUNITY}
      opportunityId={OPPORTUNITY.id}
      userId="emp-1"
      onViewFullDetails={onViewFullDetails}
      onOpenTask={onOpenTask}
      onOpenGroupTask={onOpenGroupTask}
      {...props}
    />,
  )
  return { ...result, onClose, onViewFullDetails, onOpenTask, onOpenGroupTask }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("the header", () => {
  it("shows the deal's Sales Reference and project title", async () => {
    renderQuickView()

    expect(await screen.findByText("S99001")).toBeInTheDocument()
    expect(screen.getByText("Fit-out")).toBeInTheDocument()
  })
})

describe("the container", () => {
  it("is a right slide-over with View Full Details in its header, and no position arrows", async () => {
    renderQuickView()

    const button = await screen.findByRole("button", { name: "View Full Details" })
    const panel = button.closest('[data-slot="drawer-content"]')
    expect(panel).not.toBeNull()
    expect(panel).toContainElement(screen.getByText("Fit-out"))
    expect(screen.queryByLabelText(/next record/i)).not.toBeInTheDocument()
  })

  it("renders nothing when closed", () => {
    renderQuickView({ isOpen: false })

    expect(screen.queryByText("Fit-out")).not.toBeInTheDocument()
  })
})

describe("your open tasks", () => {
  it("says nothing is open when there are no tasks", async () => {
    taskService.getMyOpenTasksForOpportunity.mockResolvedValue([])
    renderQuickView()

    expect(await screen.findByText("Nothing open for you here.")).toBeInTheDocument()
  })

  it("lists an open task and opens it stacked, not in place of Quick View", async () => {
    taskService.getMyOpenTasksForOpportunity.mockResolvedValue([
      { id: "task-1", taskDescription: "Submit the technical proposal", status: "INCOMPLETE" },
    ])
    const { onOpenTask, onClose } = renderQuickView()

    const row = await screen.findByText("Submit the technical proposal")
    await setupUser().click(row)

    expect(onOpenTask).toHaveBeenCalledWith("task-1")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("lists a colleague's task too, under the viewer's own, and opens it", async () => {
    taskService.getMyOpenTasksForOpportunity.mockResolvedValue([
      { id: "task-1", kind: "task", mine: true, taskDescription: "My own task", status: "INCOMPLETE" },
      { id: "task-2", kind: "task", mine: false, taskDescription: "Colleague's task", status: "INCOMPLETE" },
    ])
    const { onOpenTask } = renderQuickView()

    const own = await screen.findByText("My own task")
    const theirs = screen.getByText("Colleague's task")
    expect(own.compareDocumentPosition(theirs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await setupUser().click(theirs)
    expect(onOpenTask).toHaveBeenCalledWith("task-2")
  })

  it("reads as an obligation: title, what to do, kind, when it is due, checklist progress", async () => {
    taskService.getMyOpenTasksForOpportunity.mockResolvedValue([
      {
        id: "task-1",
        kind: "task",
        title: "Technical review — S99002",
        taskDescription: "Check the specifications on this deal",
        dueAt: "2999-09-24T12:00:00.000Z",
        checklistProgress: { total: 5, checked: 2 },
        status: "INCOMPLETE",
        priority: "HIGH",
      },
    ])
    renderQuickView()

    expect(await screen.findByText("Technical review — S99002")).toBeInTheDocument()
    expect(screen.getByText("Check the specifications on this deal")).toBeInTheDocument()
    expect(screen.getByText("Task")).toBeInTheDocument()
    expect(screen.getByText("Due Sep 24")).toBeInTheDocument()
    expect(screen.getByText("2/5 done")).toBeInTheDocument()
    expect(screen.getByText("High")).toBeInTheDocument()
  })

  it("calls out an overdue task, and stays quiet about status for a plain incomplete one", async () => {
    taskService.getMyOpenTasksForOpportunity.mockResolvedValue([
      { id: "task-1", kind: "task", title: "Late one", dueAt: "2020-01-02T12:00:00.000Z", status: "INCOMPLETE", priority: "MEDIUM" },
    ])
    renderQuickView()

    expect(await screen.findByText("Overdue · Jan 2")).toBeInTheDocument()
    expect(screen.queryByText(/awaiting approval/i)).not.toBeInTheDocument()
    expect(screen.queryByText("High")).not.toBeInTheDocument()
  })

  it("marks a task waiting on approval, and does not call it overdue", async () => {
    taskService.getMyOpenTasksForOpportunity.mockResolvedValue([
      { id: "task-1", kind: "task", title: "Filed one", dueAt: "2020-01-02T12:00:00.000Z", status: "AWAITING APPROVAL" },
    ])
    renderQuickView()

    expect(await screen.findByText("Awaiting approval")).toBeInTheDocument()
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument()
  })

  it("shows a Group Task's title with this member's own assignment beneath it", async () => {
    taskService.getMyOpenTasksForOpportunity.mockResolvedValue([
      { id: "group-1", kind: "group", title: "Bid pack", taskDescription: "Assemble the bid", status: "ACTIVE" },
    ])
    renderQuickView()

    expect(await screen.findByText("Bid pack")).toBeInTheDocument()
    expect(screen.getByText("Assemble the bid")).toBeInTheDocument()
    expect(screen.getByText("Group task")).toBeInTheDocument()
  })

  it("lists a Group Task beside an individual one and opens it as a group, not a task", async () => {
    taskService.getMyOpenTasksForOpportunity.mockResolvedValue([
      { id: "task-1", kind: "task", taskDescription: "Check the specifications", status: "INCOMPLETE" },
      { id: "group-1", kind: "group", taskDescription: "Bid pack", status: "ACTIVE" },
    ])
    const { onOpenTask, onOpenGroupTask } = renderQuickView()

    await setupUser().click(await screen.findByText("Bid pack"))

    expect(screen.getByText("Check the specifications")).toBeInTheDocument()
    expect(onOpenGroupTask).toHaveBeenCalledWith("group-1")
    expect(onOpenTask).not.toHaveBeenCalled()
  })
})

describe("open on this stage", () => {
  it("says nothing blocks the stage when every condition is satisfied or not applicable", async () => {
    opportunityService.getStageChecklist.mockResolvedValue([
      condition({ status: CONDITION_STATUS.SATISFIED }),
      condition({ status: CONDITION_STATUS.NOT_APPLICABLE }),
    ])
    renderQuickView()

    expect(await screen.findByText("Nothing blocks this stage.")).toBeInTheDocument()
  })

  it("names an unsatisfied condition, without claiming it belongs to this viewer", async () => {
    opportunityService.getStageChecklist.mockResolvedValue([condition()])
    renderQuickView()

    expect(await screen.findByText("Signed contract on file")).toBeInTheDocument()
    expect(screen.getByText("Open on this stage")).toBeInTheDocument()
    expect(screen.queryByText(/yours/i)).not.toBeInTheDocument()
  })

  it("fetches the checklist off the opportunity it was already given, not a fresh id-only lookup", async () => {
    opportunityService.getStageChecklist.mockResolvedValue([])
    renderQuickView()

    await screen.findByText("Nothing blocks this stage.")
    expect(opportunityService.getStageChecklist).toHaveBeenCalledWith(OPPORTUNITY.id, OPPORTUNITY)
  })
})

describe("escalating to the full record", () => {
  it("calls onViewFullDetails, not a navigation of its own", async () => {
    const { onViewFullDetails } = renderQuickView()

    await setupUser().click(await screen.findByRole("button", { name: "View Full Details" }))

    expect(onViewFullDetails).toHaveBeenCalled()
  })
})
