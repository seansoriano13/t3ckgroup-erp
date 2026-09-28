import { describe, it, expect, vi, afterEach } from "vitest"
import { screen, fireEvent } from "@testing-library/react"

import { renderWithProviders } from "../../../test/support"
import { opportunityService } from "../../../services/opportunityService"
import { CONDITION_STATUS } from "../../../constants/stageGate"
import JourneyTab from "./JourneyTab"

function baseVisit(overrides = {}) {
  return {
    id: "visit-1",
    sequence: 1,
    stage: { id: "stage-1", name: "Qualified", bracket: "Lead" },
    enteredAt: "2026-01-01T00:00:00Z",
    enteredBy: { id: "emp-1", name: "Alice" },
    leftAt: "2026-01-10T00:00:00Z",
    leftBy: { id: "emp-1", name: "Alice" },
    isRestricted: false,
    conditions: [],
    tasks: [],
    groupTasks: [],
    requestedItems: [],
    stageFields: { filled: [], notFilled: [] },
    followUps: [],
    followUpReminderCount: 0,
    ...overrides,
  }
}

// A second, currently-open visit so `journeyRows` always has at least one
// past visit to expand — the open visit renders as the "Now" summary line,
// never as an expandable PastVisit.
function currentVisit(overrides = {}) {
  return baseVisit({
    id: "visit-current",
    sequence: 2,
    leftAt: null,
    leftBy: null,
    ...overrides,
  })
}

async function renderJourney(visits) {
  vi.spyOn(opportunityService, "getJourney").mockResolvedValue(visits)
  renderWithProviders(<JourneyTab opportunityId="opp-1" hasOpened={() => true} onGoToNow={() => {}} />)
  // Expand the one past visit — its toggle button is the only element with
  // aria-expanded; the current visit renders as a plain "Now" summary link.
  const toggle = await screen.findByRole("button", { expanded: false })
  fireEvent.click(toggle)
}

describe("JourneyTab — past visit detail (#397)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("shows an attachment condition's file, who gave it, and when it met", async () => {
    await renderJourney([
      currentVisit(),
      baseVisit({
        conditions: [
          {
            condition: { id: "cond-1", label: "Notice of Award", kind: "attachment" },
            status: CONDITION_STATUS.SATISFIED,
            satisfiedBy: { id: "emp-2", name: "Buyer Bea", avatar_path: null },
            satisfiedAt: "2026-01-05T00:00:00Z",
            files: [{ name: "noa.pdf", url: "https://cdn.test/noa.pdf" }],
          },
        ],
      }),
    ])

    // History lists a condition's files under it, each with an Open button.
    const open = vi.spyOn(window, "open").mockImplementation(() => null)
    expect((await screen.findAllByText("noa.pdf")).length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0])
    expect(open).toHaveBeenCalledWith("https://cdn.test/noa.pdf", "_blank", "noopener,noreferrer")
    expect(screen.getAllByText("Buyer Bea").length).toBeGreaterThan(0)
  })

  it("shows a tickbox condition's certifier and when, with no file row", async () => {
    await renderJourney([
      currentVisit(),
      baseVisit({
        conditions: [
          {
            condition: { id: "cond-2", label: "Signed NDA", kind: "tickbox" },
            status: CONDITION_STATUS.SATISFIED,
            satisfiedBy: { id: "emp-3", name: "Cass Cruz", avatar_path: null },
            satisfiedAt: "2026-01-02T00:00:00Z",
            file: null,
          },
        ],
      }),
    ])

    expect(await screen.findByText("Signed NDA")).toBeInTheDocument()
    expect(screen.getByText("Cass Cruz")).toBeInTheDocument()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("keeps 'Not met' for an unmet condition, unchanged from today", async () => {
    await renderJourney([
      currentVisit(),
      baseVisit({
        conditions: [
          {
            condition: { id: "cond-3", label: "Estimator assigned", kind: "assignment" },
            status: CONDITION_STATUS.UNSATISFIED,
            satisfiedBy: null,
            satisfiedAt: null,
            file: null,
          },
        ],
      }),
    ])

    expect(await screen.findByText("Not met")).toBeInTheDocument()
  })

  it("lists filled Stage Field values and names any unfilled ones on one muted line", async () => {
    await renderJourney([
      currentVisit(),
      baseVisit({
        stageFields: {
          filled: [{ id: "f1", label: "Site survey date", value: "2026-02-01" }],
          notFilled: ["Access notes", "Contact on site"],
        },
      }),
    ])

    expect(await screen.findByText("Site survey date")).toBeInTheDocument()
    expect(screen.getByText("2026-02-01")).toBeInTheDocument()
    expect(screen.getByText("Not filled: Access notes, Contact on site")).toBeInTheDocument()
  })

  it("shows each Logged Follow-up with who/when/note/proof, and a reminder count", async () => {
    await renderJourney([
      currentVisit(),
      baseVisit({
        followUps: [
          {
            loggedBy: { id: "emp-4", name: "Dee Reyes", avatar_path: null },
            loggedAt: "2026-01-06T00:00:00Z",
            note: "Called the client, awaiting reply",
            files: [{ name: "call-log.pdf", url: "https://cdn.test/call-log.pdf" }],
          },
        ],
        followUpReminderCount: 3,
      }),
    ])

    expect(await screen.findByText("Dee Reyes")).toBeInTheDocument()
    expect(screen.getByText("Called the client, awaiting reply")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "call-log.pdf" })).toHaveAttribute(
      "href",
      "https://cdn.test/call-log.pdf",
    )
    expect(screen.getByText("3 reminders sent")).toBeInTheDocument()
  })

  it("says '1 reminder sent' for exactly one reminder", async () => {
    await renderJourney([currentVisit(), baseVisit({ followUpReminderCount: 1 })])

    expect(await screen.findByText("1 reminder sent")).toBeInTheDocument()
  })

  it("omits a section entirely when it has nothing to show", async () => {
    await renderJourney([
      currentVisit(),
      baseVisit({
        conditions: [
          {
            condition: { id: "cond-1", label: "Signed NDA", kind: "tickbox" },
            status: CONDITION_STATUS.SATISFIED,
            satisfiedBy: null,
            satisfiedAt: null,
            file: null,
          },
        ],
        // No Stage Fields, no Follow-ups, no tasks, no requested items.
      }),
    ])

    expect(await screen.findByText("Signed NDA")).toBeInTheDocument()
    expect(screen.queryByText(/reminders? sent/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Not filled:/)).not.toBeInTheDocument()
  })

  it("shows 'Nothing was recorded on this visit' only when every section is empty", async () => {
    await renderJourney([currentVisit(), baseVisit()])

    expect(await screen.findByText("Nothing was recorded on this visit.")).toBeInTheDocument()
  })

  it("renders a restricted visit as one line, fetching and expanding nothing (#296 unaffected)", async () => {
    vi.spyOn(opportunityService, "getJourney").mockResolvedValue([
      currentVisit(),
      baseVisit({ isRestricted: true }),
    ])
    renderWithProviders(<JourneyTab opportunityId="opp-1" hasOpened={() => true} onGoToNow={() => {}} />)

    expect(await screen.findByText("Restricted")).toBeInTheDocument()
    expect(screen.queryByText("Nothing was recorded on this visit.")).not.toBeInTheDocument()
    // A restricted row is not a toggle button at all — nothing behind it to open.
    expect(document.querySelectorAll("button[aria-expanded]")).toHaveLength(0)
  })
})
