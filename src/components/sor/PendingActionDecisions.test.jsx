import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderWithProviders, setupUser } from "../../test/support"
import PendingActionDecisions from "./PendingActionDecisions"
import { opportunityService } from "../../services/opportunityService"

vi.mock("../../services/opportunityService", () => ({
  opportunityService: {
    getPendingActionsForActor: vi.fn(async () => []),
    decideAction: vi.fn(async () => ({ outcome: "created" })),
  },
}))

vi.mock("react-hot-toast", () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
  return { default: toast, toast }
})

const OPPORTUNITY = { id: "opp-1" }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("PendingActionDecisions", () => {
  it("renders nothing when there is nothing pending", async () => {
    opportunityService.getPendingActionsForActor.mockResolvedValue([])
    const { container } = renderWithProviders(
      <PendingActionDecisions opportunity={OPPORTUNITY} actorId="emp-1" />,
    )
    await waitFor(() => expect(opportunityService.getPendingActionsForActor).toHaveBeenCalledWith("opp-1", "emp-1"))
    expect(container).toBeEmptyDOMElement()
  })

  it("names the configured assignee for an individual task, not a placeholder", async () => {
    opportunityService.getPendingActionsForActor.mockResolvedValue([
      {
        runId: "run-1",
        stageName: "Qualified",
        title: "Approve pricing",
        target: { kind: "individual", assignee: { id: "emp-2", name: "Assignee Andy" } },
      },
    ])
    renderWithProviders(<PendingActionDecisions opportunity={OPPORTUNITY} actorId="emp-1" />)

    expect(await screen.findByText(/An individual task assigned to Assignee Andy/)).toBeInTheDocument()
  })

  it("says a Costing Matrix for this SOR when the waiting action opens one", async () => {
    opportunityService.getPendingActionsForActor.mockResolvedValue([
      { runId: "run-1", stageName: "SO Evaluation", title: "S00462 · Rope rescue", target: { kind: "costing_matrix" } },
    ])
    renderWithProviders(<PendingActionDecisions opportunity={OPPORTUNITY} actorId="emp-1" />)

    expect(await screen.findByText(/A Costing Matrix for this SOR/)).toBeInTheDocument()
  })

  it("falls back to 'assigned to you' when no assignee is configured", async () => {
    opportunityService.getPendingActionsForActor.mockResolvedValue([
      {
        runId: "run-1",
        stageName: "Qualified",
        title: "Approve pricing",
        target: { kind: "individual", assignee: null },
      },
    ])
    renderWithProviders(<PendingActionDecisions opportunity={OPPORTUNITY} actorId="emp-1" />)

    expect(await screen.findByText(/An individual task assigned to you/)).toBeInTheDocument()
  })

  it("names every member of a group task, not just a count", async () => {
    opportunityService.getPendingActionsForActor.mockResolvedValue([
      {
        runId: "run-1",
        stageName: "Qualified",
        title: "Kickoff",
        target: {
          kind: "group",
          members: [
            { id: "emp-2", name: "Assignee A" },
            { id: "emp-3", name: "Assignee B" },
          ],
        },
      },
    ])
    renderWithProviders(<PendingActionDecisions opportunity={OPPORTUNITY} actorId="emp-1" />)

    expect(await screen.findByText(/A group task for Assignee A, Assignee B/)).toBeInTheDocument()
  })

  it("calls decideAction with the run id, decision and actor id on Create", async () => {
    const user = setupUser()
    opportunityService.getPendingActionsForActor.mockResolvedValue([
      {
        runId: "run-1",
        stageName: "Qualified",
        title: "Approve pricing",
        target: { kind: "individual", assignee: null },
      },
    ])
    renderWithProviders(<PendingActionDecisions opportunity={OPPORTUNITY} actorId="emp-1" />)

    await user.click(await screen.findByRole("button", { name: "Create" }))

    await waitFor(() =>
      expect(opportunityService.decideAction).toHaveBeenCalledWith("run-1", "create", "emp-1"),
    )
  })
})
