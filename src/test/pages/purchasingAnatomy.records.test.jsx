/**
 * The Purchasing anatomy test, records half (spec #631, "Testing Decisions"):
 * every Purchasing record opens in the record window and gets the SAME checks.
 * The lists half is `purchasingAnatomy.test.jsx`; both stay separate files so
 * the two tickets that build them do not collide, and together they are the
 * one place a new Purchasing screen is checked.
 *
 * To add a record, add ONE entry to RECORDS below:
 *
 *   {
 *     name: "Packing List",                        // the describe title
 *     Page: PackingListDetailPage,                 // the record's route page (list + window)
 *     route: "/purchasing/packing-lists/:id",      // the route pattern
 *     path: "/purchasing/packing-lists/p1",        // the link that opens it
 *     seed() { ... },                              // stub the data (and mock the service at the top of this file)
 *     title: /^PL-0001\s*·\s*Harbour lights$/,     // reference · name
 *     badge: "Open",                               // the one state badge's text
 *     pills: ["Delivery", "SOR"],                  // the pill labels shown
 *     hasMore: true,                               // whether More has items for this viewer
 *     yourMove: {                                  // or null when the record has no sign-off steps
 *       status: "Waiting for you: Check by",       // "what's next"
 *       steps: ["Warehouse checking", "Check by"], // the step titles, in order
 *     },
 *   }
 *
 * A record whose viewer can reach more than one More state (with items, and
 * empty) is added as two entries, one per viewer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, within } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"

import TransmittalDetailPage from "@/pages/purchasing/transmittals/[id]"
import { renderWithProviders } from "@/test/support"
import { shapeTransmittal } from "@/utils/transmittals"

const auth = vi.hoisted(() => ({ user: null }))
const transmittalService = vi.hoisted(() => ({
  get: vi.fn(),
  myStaffLists: vi.fn(),
  stageListMembers: vi.fn(),
  list: vi.fn(),
}))

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: auth.user, isAuthLoading: false }) }))
vi.mock("@/services/transmittalService", () => ({ transmittalService }))
vi.mock("../../services/transmittalService", () => ({ transmittalService }))

const PREPARER = "u-prep"
const CHECKER = { id: "u-check", name: "Maria Check", employee_type: "staff" }

function rawTransmittal(over = {}) {
  return {
    id: "t1",
    number: "TG03_0007",
    prepared_on: "2026-10-01",
    prepared_by: PREPARER,
    preparer: { name: "Pat Prep" },
    origin: "purchasing",
    check_warehouse: true,
    check_technical: false,
    priority: "high",
    entity: "Store CDO",
    state: "awaiting_check",
    created_at: "2026-10-01T00:00:00Z",
    products: [],
    references: [],
    lines: [{ id: "l1", position: 1, kind: "typed", description: "Cutter", quantity: 2, wh_rating: "gc" }],
    stages: [
      {
        id: "s1",
        stage: "warehouse_checking",
        completed_at: "2026-10-02T01:00:00Z",
        first_signer: { name: "Ann" },
        first_signer_id: PREPARER,
        second_signer_name: "Bob",
      },
    ],
    ...over,
  }
}

function seedTransmittal({ raw, lists }) {
  auth.user = CHECKER
  transmittalService.get.mockResolvedValue(shapeTransmittal(raw))
  transmittalService.myStaffLists.mockResolvedValue(lists)
  transmittalService.stageListMembers.mockResolvedValue([])
  transmittalService.list.mockResolvedValue([])
  return { employee: CHECKER }
}

const RECORDS = [
  {
    name: "Transmittal",
    Page: TransmittalDetailPage,
    route: "/purchasing/transmittals/:id",
    path: "/purchasing/transmittals/t1",
    seed: () => seedTransmittal({ raw: rawTransmittal(), lists: ["transmittal_check_by"] }),
    title: /^TG03_0007\s*·\s*Store CDO$/,
    badge: "Awaiting Check by",
    pills: ["Origin", "Priority", "Company"],
    hasMore: true,
    yourMove: {
      status: "Waiting for you: Check by",
      steps: ["Warehouse checking", "Check by"],
    },
  },
  {
    // A cancelled slip has nothing to print and nothing to cancel, so More has nothing to hold.
    name: "Transmittal (cancelled)",
    Page: TransmittalDetailPage,
    route: "/purchasing/transmittals/:id",
    path: "/purchasing/transmittals/t1",
    seed: () =>
      seedTransmittal({
        raw: rawTransmittal({ state: "cancelled", cancel_reason: "Wrong slip", stages: [] }),
        lists: [],
      }),
    title: /^TG03_0007\s*·\s*Store CDO$/,
    badge: "Cancelled",
    pills: ["Origin", "Priority", "Company"],
    hasMore: false,
    yourMove: { status: "Cancelled. Nothing to do.", steps: ["Warehouse checking", "Check by"] },
  },
]

function stubWide() {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function renderRecord({ Page, route, path }) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={<Page />} />
      </Routes>
    </MemoryRouter>,
  )
}

const follows = (before, after) => Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING)

describe.each(RECORDS)("Purchasing record anatomy: $name", (record) => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    vi.clearAllMocks()
    stubWide()
    record.seed()
  })

  afterEach(() => {
    if (originalMatchMedia) window.matchMedia = originalMatchMedia
  })

  it("opens in the record window, with no footer bar and no Expand", async () => {
    renderRecord(record)
    await screen.findByRole("heading", { name: record.title })

    const windows = screen.getAllByRole("dialog").filter((dialog) => dialog.dataset.modalShell === "record")
    expect(windows).toHaveLength(1)
    expect(screen.queryByRole("button", { name: /^(Expand|Collapse)$/ })).not.toBeInTheDocument()
    expect(screen.queryByText("to cancel")).not.toBeInTheDocument()
    // The X closes it; there is no Close or Cancel button in a footer.
    expect(screen.getByRole("button", { name: "Close window" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^(Close|Cancel)$/ })).not.toBeInTheDocument()
  })

  it("starts with its title and exactly one state badge", async () => {
    renderRecord(record)
    const title = await screen.findByRole("heading", { name: record.title })

    const header = title.closest("header")
    expect(header).not.toBeNull()
    expect(within(header).getByText(record.badge)).toBeInTheDocument()
    // One badge: the only uppercase pill in the header.
    expect(header.querySelectorAll("span.uppercase")).toHaveLength(1)
  })

  it("shows its headline facts as pills", async () => {
    renderRecord(record)
    await screen.findByRole("heading", { name: record.title })

    for (const label of record.pills) expect(screen.getByText(label)).toBeInTheDocument()
  })

  it(record.hasMore ? "shows More, because it has items" : "shows no More, because it has nothing to hold", async () => {
    renderRecord(record)
    await screen.findByRole("heading", { name: record.title })

    const more = screen.queryByRole("button", { name: "More" })
    if (record.hasMore) expect(more).toBeInTheDocument()
    else expect(more).not.toBeInTheDocument()
  })

  if (record.yourMove) {
    it("shows Your move with its parts in order", async () => {
      renderRecord(record)
      await screen.findByRole("heading", { name: record.title })

      const heading = screen.getByRole("heading", { name: "Your move" })
      const status = screen.getByText(record.yourMove.status)
      const signed = screen.getByText(/^\d+ of \d+ signed$/)
      const steps = record.yourMove.steps.map((title) => screen.getByRole("button", { name: new RegExp(`^${title}`) }))

      const parts = [heading, status, signed, ...steps]
      parts.slice(1).forEach((part, index) => expect(follows(parts[index], part)).toBe(true))
      // Every step opens in place.
      for (const step of steps) expect(step).toHaveAttribute("aria-expanded")
    })
  }
})
