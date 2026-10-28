/**
 * Deal Owner visibility (ticket 6, .scratch/stage-gate-engine/issues/06-deal-
 * owner-visibility.md) — what a Stage owes, shown before a move is tried,
 * not discovered one refusal at a time.
 *
 * `opportunityService` is mocked wholesale
 * — per-kind evaluation already has its own coverage in stageGate.test.js and
 * opportunityService.test.js; what this file protects is what the Deal Owner
 * actually sees and can do: which items still block, who satisfied what, and
 * that ticking a tickbox is the one action this read-only list still takes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderWithProviders, setupUser } from "../../test/support"
import StageChecklist from "./StageChecklist"
import { opportunityService } from "../../services/opportunityService"
import { employeeGroupService } from "../../services/employeeGroupService"
import { CONDITION_STATUS } from "../../constants/stageGate"

const OPPORTUNITY = { id: "opp-1", status: "PROPOSAL_SUBMITTED" }
const EMPLOYEES = [{ id: "emp-1", name: "Ana Reyes" }]

vi.mock("../../services/opportunityService", () => ({
  opportunityService: {
    getStageChecklist: vi.fn(async () => []),
    satisfyCondition: vi.fn(async () => ({})),
    getCurrentStageVisitId: vi.fn(async () => null),
    getPreviousStageVisitId: vi.fn(async () => null),
    getNotes: vi.fn(async () => []),
    addMember: vi.fn(async () => ({})),
    addNote: vi.fn(async () => ({})),
    isChecklistWritableField: vi.fn(() => true),
  },
}))

vi.mock("../../services/employeeGroupService", () => ({
  employeeGroupService: {
    list: vi.fn(async () => []),
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
  it("says nothing blocks the stage when the current Stage has no conditions", async () => {
    opportunityService.getStageChecklist.mockResolvedValue([])
    renderWithProviders(<StageChecklist opportunity={OPPORTUNITY} employees={EMPLOYEES} actorId="emp-1" />)

    expect(await screen.findByText("Nothing blocks this stage.")).toBeInTheDocument()
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

describe("Costing settled (#272)", () => {
  const costing = (overrides = {}) =>
    item({
      condition: { id: "cs-1", kind: "costing_settled", label: "Costing settled", is_required: true, sort_order: 0 },
      ...overrides,
    })

  it("lists which checks fail, in plain words", async () => {
    opportunityService.getStageChecklist.mockResolvedValue([
      costing({
        detail: {
          failing: ["missing_final_offer", "evaluation_not_approved", "bid_not_go"],
          messages: [
            "2 Tender Lines have no Final Offer.",
            "The Evaluation of Specification is not approved.",
            "There is no Bid Decision yet.",
          ],
        },
      }),
    ])
    renderWithProviders(<StageChecklist opportunity={OPPORTUNITY} employees={EMPLOYEES} actorId="emp-1" />)

    const list = await screen.findByRole("list", { name: "Costing settled: what is missing" })
    expect(list).toHaveTextContent("2 Tender Lines have no Final Offer.")
    expect(list).toHaveTextContent("The Evaluation of Specification is not approved.")
    expect(list).toHaveTextContent("There is no Bid Decision yet.")
  })

  it("lists nothing once it is met", async () => {
    opportunityService.getStageChecklist.mockResolvedValue([costing({ status: CONDITION_STATUS.SATISFIED })])
    renderWithProviders(<StageChecklist opportunity={OPPORTUNITY} employees={EMPLOYEES} actorId="emp-1" />)

    expect((await screen.findAllByText("Costing settled")).length).toBeGreaterThan(0)
    expect(screen.queryByRole("list", { name: /what is missing/ })).not.toBeInTheDocument()
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
    const user = setupUser()
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

// Optional Action decisions (issue #204 Part 2) and Stage Fields (issue
// #203) used to render at the bottom of this list; issue #299 moved both
// out to the Now tab, which now orders every Stage-Visit panel itself. The
// Decider card is covered in PendingActionDecisions.test.jsx, and the Stage
// Fields form (rendering, and saving to the current visit) in
// modal/NowTab.test.jsx.

describe("attachment — pick an existing SOR file (issue #203, story 13)", () => {
  it("offers picking a file already on the SOR, stamped the same as an upload", async () => {
    const user = setupUser()
    opportunityService.getStageChecklist.mockResolvedValue([
      item({ condition: { ...item().condition, kind: "attachment", label: "Notice of Award", config: {} } }),
    ])
    opportunityService.getNotes.mockResolvedValue([
      { metadata: { attachments: [{ url: "https://files/x.pdf", name: "Award.pdf", type: "pdf" }] } },
    ])
    opportunityService.getCurrentStageVisitId.mockResolvedValue("visit-1")

    renderWithProviders(<StageChecklist opportunity={OPPORTUNITY} employees={EMPLOYEES} actorId="emp-1" />)

    await screen.findByText("Notice of Award")
    await user.click(screen.getByRole("button", { name: /Pick existing file/i }))
    await user.click(await screen.findByRole("button", { name: "Award.pdf" }))

    await waitFor(() =>
      expect(opportunityService.addNote).toHaveBeenCalledWith(
        "opp-1",
        "emp-1",
        "Attached document: Notice of Award",
        [
          expect.objectContaining({
            url: "https://files/x.pdf",
            conditionId: "req-1",
            stageVisitId: "visit-1",
          }),
        ],
      ),
    )
  })
})

describe("attachment — a picked file is not listed twice", () => {
  it("lists a file once even when a pick already linked it into a second note", async () => {
    const user = setupUser()
    opportunityService.getStageChecklist.mockResolvedValue([
      item({ condition: { ...item().condition, kind: "attachment", label: "Notice of Award", config: {} } }),
    ])
    const file = { url: "https://files/x.pdf", name: "Award.pdf", type: "pdf" }
    opportunityService.getNotes.mockResolvedValue([
      { metadata: { attachments: [file] } },
      // what a previous pick leaves behind: same file, stamped for a condition
      { metadata: { attachments: [{ ...file, linked: true, conditionId: "req-1", stageVisitId: "visit-1" }] } },
    ])

    renderWithProviders(<StageChecklist opportunity={OPPORTUNITY} employees={EMPLOYEES} actorId="emp-1" />)

    await screen.findByText("Notice of Award")
    await user.click(screen.getByRole("button", { name: /Pick existing file/i }))

    expect(await screen.findAllByRole("button", { name: "Award.pdf" })).toHaveLength(1)
  })
})

describe("assignment — who narrows the dropdown (issue #203, story 17)", () => {
  const TEAM_EMPLOYEES = [
    { id: "emp-1", name: "Ana Reyes" },
    { id: "emp-2", name: "Rey Santos" },
  ]

  it("offers only people who resolve into the condition's who", async () => {
    const user = setupUser()
    opportunityService.getStageChecklist.mockResolvedValue([
      item({
        condition: {
          ...item().condition,
          kind: "assignment",
          label: "Purchasing officer assigned",
          config: { who: [{ type: "group", id: "grp-1" }] },
        },
      }),
    ])
    employeeGroupService.list.mockResolvedValue([{ id: "grp-1", memberIds: ["emp-2"] }])

    renderWithProviders(
      <StageChecklist opportunity={OPPORTUNITY} employees={TEAM_EMPLOYEES} actorId="emp-1" />,
    )

    await user.click(await screen.findByText("Assign..."))

    expect(await screen.findByRole("button", { name: "Rey Santos" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Ana Reyes" })).toBeNull()
  })

  it("keeps the full list for a legacy department-only condition (no who configured)", async () => {
    const user = setupUser()
    opportunityService.getStageChecklist.mockResolvedValue([
      item({
        condition: {
          ...item().condition,
          kind: "assignment",
          label: "Someone from Purchasing",
          config: { department: "Purchasing" },
        },
      }),
    ])

    renderWithProviders(
      <StageChecklist opportunity={OPPORTUNITY} employees={TEAM_EMPLOYEES} actorId="emp-1" />,
    )

    await user.click(await screen.findByText(/Assign Purchasing\.\.\./i))

    expect(await screen.findByRole("button", { name: "Ana Reyes" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Rey Santos" })).toBeInTheDocument()
  })
})
