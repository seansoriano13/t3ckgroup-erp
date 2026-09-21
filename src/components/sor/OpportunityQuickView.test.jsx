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
  const result = renderWithProviders(
    <OpportunityQuickView
      isOpen
      onClose={onClose}
      opportunity={OPPORTUNITY}
      opportunityId={OPPORTUNITY.id}
      userId="emp-1"
      onViewFullDetails={onViewFullDetails}
      onOpenTask={onOpenTask}
      {...props}
    />,
  )
  return { ...result, onClose, onViewFullDetails, onOpenTask }
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
