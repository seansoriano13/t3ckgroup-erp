/**
 * Deal Owner visibility (ticket 6, .scratch/stage-gate-engine/issues/06-deal-
 * owner-visibility.md) — what a Stage owes, shown before a move is tried,
 * not discovered one refusal at a time.
 *
 * `opportunityService` is mocked wholesale (prior art: PurchasingPanel.test.jsx)
 * — per-kind evaluation already has its own coverage in stageGate.test.js and
 * opportunityService.test.js; what this file protects is what the Deal Owner
 * actually sees and can do: which items still block, who satisfied what, and
 * that ticking a tickbox is the one action this read-only list still takes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithProviders } from "../../test/support"
import StageChecklist from "./StageChecklist"
import { opportunityService } from "../../services/opportunityService"
import { CONDITION_STATUS } from "../../constants/stageGate"

const OPPORTUNITY = { id: "opp-1", status: "PROPOSAL_SUBMITTED" }
const EMPLOYEES = [{ id: "emp-1", name: "Ana Reyes" }]

vi.mock("../../services/opportunityService", () => ({
  opportunityService: {
    getStageChecklist: vi.fn(async () => []),
    satisfyCondition: vi.fn(async () => ({})),
  },
}))

vi.mock("react-hot-toast", () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), custom: vi.fn() })
  return { default: toast, toast }
})

vi.mock("../ui/CustomToast", () => ({
  // The real confirmActionToast renders its confirm button inside a
  // toast.custom(...) callback that needs a live <Toaster/> portal — nothing
  // here mounts one. Skipping straight to onConfirm tests what this
  // component is responsible for (wiring the tick to satisfyCondition),
  // not the generic confirm-toast widget.
  confirmActionToast: (_title, _description, _confirmText, _tone, onConfirm) => onConfirm(),
}))

const item = (overrides = {}) => ({
  condition: {
    id: "req-1",
    kind: "field",
    label: "Contact person on file",
    is_required: true,
    sort_order: 0,
  },
  status: CONDITION_STATUS.UNSATISFIED,
  satisfiedBy: null,
  satisfiedAt: null,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("nothing configured", () => {
  it("renders nothing when the current Stage has no conditions", async () => {
    opportunityService.getStageChecklist.mockResolvedValue([])
    const { container } = renderWithProviders(
      <StageChecklist opportunity={OPPORTUNITY} employees={EMPLOYEES} actorId="emp-1" />,
    )

    await waitFor(() => expect(opportunityService.getStageChecklist).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})

describe("what's outstanding", () => {
  it("names an unsatisfied required item", async () => {
    opportunityService.getStageChecklist.mockResolvedValue([item()])
    renderWithProviders(<StageChecklist opportunity={OPPORTUNITY} employees={EMPLOYEES} actorId="emp-1" />)

    expect(await screen.findByText("Contact person on file")).toBeInTheDocument()
    expect(screen.getByText(/not yet satisfied/i)).toBeInTheDocument()
  })

  it("marks an optional item as optional rather than implying it blocks", async () => {
    opportunityService.getStageChecklist.mockResolvedValue([
      item({ condition: { ...item().condition, is_required: false } }),
    ])
    renderWithProviders(<StageChecklist opportunity={OPPORTUNITY} employees={EMPLOYEES} actorId="emp-1" />)

    expect(await screen.findByText("Optional")).toBeInTheDocument()
  })
})

describe("who satisfied what and when", () => {
  it("shows the satisfier's name and date on a satisfied item", async () => {
    opportunityService.getStageChecklist.mockResolvedValue([
      item({
        condition: { ...item().condition, kind: "attachment", label: "Notice of Award" },
        status: CONDITION_STATUS.SATISFIED,
        satisfiedBy: "emp-1",
        satisfiedAt: "2026-03-01T00:00:00.000Z",
      }),
    ])
    renderWithProviders(<StageChecklist opportunity={OPPORTUNITY} employees={EMPLOYEES} actorId="emp-1" />)

    await screen.findByText("Notice of Award")
    expect(screen.getByText(/satisfied by ana reyes/i)).toBeInTheDocument()
  })

  it("still shows a satisfied field with no attributed satisfier, rather than a blank", async () => {
    opportunityService.getStageChecklist.mockResolvedValue([
      item({ status: CONDITION_STATUS.SATISFIED, satisfiedBy: null, satisfiedAt: null }),
    ])
    renderWithProviders(<StageChecklist opportunity={OPPORTUNITY} employees={EMPLOYEES} actorId="emp-1" />)

    expect(await screen.findByText("Satisfied.")).toBeInTheDocument()
  })
})

describe("tickbox — the one item this list can also act on", () => {
  it("lets an unsatisfied tickbox be certified from here", async () => {
    const user = userEvent.setup()
    opportunityService.getStageChecklist.mockResolvedValue([
      item({ condition: { ...item().condition, kind: "tickbox", label: "Bid documents checked" } }),
    ])
    renderWithProviders(<StageChecklist opportunity={OPPORTUNITY} employees={EMPLOYEES} actorId="emp-1" />)

    await user.click(await screen.findByRole("button", { name: /certify bid documents checked/i }))

    await waitFor(() =>
      expect(opportunityService.satisfyCondition).toHaveBeenCalledWith("opp-1", "req-1", "emp-1"),
    )
  })

  it("does not offer a tick control for a kind that satisfies itself", async () => {
    opportunityService.getStageChecklist.mockResolvedValue([item()]) // kind: "field"
    renderWithProviders(<StageChecklist opportunity={OPPORTUNITY} employees={EMPLOYEES} actorId="emp-1" />)

    await screen.findByText("Contact person on file")
    expect(screen.queryByRole("button", { name: /certify/i })).toBeNull()
  })

  it("does not offer a tick control once already satisfied", async () => {
    opportunityService.getStageChecklist.mockResolvedValue([
      item({
        condition: { ...item().condition, kind: "tickbox", label: "Bid documents checked" },
        status: CONDITION_STATUS.SATISFIED,
        satisfiedBy: "emp-1",
      }),
    ])
    renderWithProviders(<StageChecklist opportunity={OPPORTUNITY} employees={EMPLOYEES} actorId="emp-1" />)

    await screen.findByText("Bid documents checked")
    expect(screen.queryByRole("button", { name: /certify/i })).toBeNull()
  })
})
