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

import PackingListDetailPage from "@/pages/purchasing/packing-lists/[id]"
import PurchaseRequestsPage from "@/pages/purchasing/index.jsx"
import IpasDetailPage from "@/pages/purchasing/ipas/[id]"
import TransmittalDetailPage from "@/pages/purchasing/transmittals/[id]"
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc"
import { renderWithProviders } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubProcurementQueueRpcs } from "@/test/stubs/procurementQueueRpc"
import { stubPurchaseRequestItemRpcs } from "@/test/stubs/purchaseRequestItemRpc"
import { shapeTransmittal } from "@/utils/transmittals"
import CanvassesPage from "@/pages/purchasing/canvasses/index"
import { stubCanvassListRpcs, stubCanvassMoneyRpc, stubCanvassWinnerRpcs } from "@/test/stubs/canvassRpc"

const auth = vi.hoisted(() => ({ user: null }))
const transmittalService = vi.hoisted(() => ({
  get: vi.fn(),
  myStaffLists: vi.fn(),
  stageListMembers: vi.fn(),
  list: vi.fn(),
  forIpas: vi.fn().mockResolvedValue([]),
}))

const packingListService = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  pack: vi.fn(),
  sorProducts: vi.fn(),
}))

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: auth.user, isAuthLoading: false }) }))
vi.mock("@/services/transmittalService", () => ({ transmittalService }))
vi.mock("../../services/transmittalService", () => ({ transmittalService }))
vi.mock("@/services/packingListService", async (importOriginal) => ({
  ...(await importOriginal()),
  packingListService,
}))
vi.mock("../../services/packingListService", async (importOriginal) => ({
  ...(await importOriginal()),
  packingListService,
}))

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

function seedPackingList(over = {}) {
  auth.user = { id: "u-me", name: "Pat Packer", has_purchasing_flow: true }
  packingListService.get.mockResolvedValue({
    id: "pl1",
    number: "TG04_0003",
    state: "draft",
    sorId: "sor1",
    sorReference: "SOR-100",
    projectTitle: "Plant upgrade",
    odooDeliveryRef: "WH/OUT/0042",
    createdById: "u-me",
    creatorName: "Pat Packer",
    packerName: null,
    packedAt: null,
    boxes: [
      { id: "b1", boxNo: 1, marks: "M1", sealNo: null, grossWeightKg: 12.5, contents: [{ id: "c1", description: "Cutter", quantity: 2, unit: "pc" }] },
    ],
    ...over,
  })
  packingListService.list.mockResolvedValue([])
  packingListService.sorProducts.mockResolvedValue([])
}

// The Purchase Request opens from the list's own link (`?request=`), so its entry seeds a request and builds the link from it.
let purchaseRequestId = null
function seedPurchaseRequest() {
  const buyer = makeEmployee({ name: "Pia Buyer", department: "OPERATIONS", has_purchasing_flow: true })
  const salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
  const sor = makeOpportunity({
    registered_by: salesperson.id,
    deal_owner_id: salesperson.id,
    sales_reference: "S01001",
    project_title: "Harbour lights",
  })
  const request = db.seed("purchase_requests", { opportunity_id: sor.id, created_by: salesperson.id, buyer_id: null })
  db.seed("purchase_request_members", { request_id: request.id, employee_id: salesperson.id, side: "sales" })
  db.seed("purchase_request_items", {
    request_id: request.id,
    source: "new",
    name: "Floodlight",
    quantity: 1,
    status: "not_checked",
    requested_by: salesperson.id,
  })
  purchaseRequestId = request.id
  stubProcurementQueueRpcs({ actorId: buyer.id })
  stubPurchaseRequestItemRpcs({ actorId: buyer.id })
  auth.user = buyer
}

// A Canvass is a window over the Canvasses list, opened by ?canvass=<id>. It reads the fake database, which numbers it CNV_0001.
function seedCanvass() {
  const buyer = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true })
  const canvasser = makeEmployee({ name: "Ana Reyes", has_purchasing_flow: true })
  auth.user = buyer
  stubCanvassMoneyRpc({ money: true })
  stubCanvassWinnerRpcs({ bands: ["purchasing"] })
  stubCanvassListRpcs({ actorId: buyer.id })
  const canvass = db.seed("sor_canvasses", {
    product_name: "Laser toner",
    canvasser_id: canvasser.id,
    created_by: canvasser.id,
  })
  db.seed("sor_canvass_offers", { canvass_id: canvass.id, supplier_name: "Ink Depot", brand: "HP", is_winner: true })
  db.seed("sor_canvass_offers", { canvass_id: canvass.id, supplier_name: "Toner World", brand: "Canon", is_winner: false })
  return canvass
}

// The IPAS reads the test database (not a mocked service). One buyer, one open IPAS from Odoo.
const IPAS_ID = "00000000-0000-4000-8000-0000000000a1"

function seedIpas(over = {}) {
  const buyer = makeEmployee({ name: "Buyer", has_purchasing_flow: true })
  auth.user = buyer
  transmittalService.forIpas.mockResolvedValue([])
  stubIpasRpcs({ actorId: buyer.id, purchasing: true })
  seedIpasOptions((table, row) => db.seed(table, row))
  db.seed("ipas", {
    id: IPAS_ID,
    number: "TGIPAS_198",
    po_number: "P02552",
    priority: "high",
    source: "local",
    purpose: "inventory",
    state: "open",
    created_by: buyer.id,
    created_at: "2026-10-20T01:00:00.000Z",
    odoo_fetched_at: "2026-10-20T02:00:00.000Z",
    odoo_copy: {
      po: { id: 1, name: "P02552", state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
      supplier: { id: 5, name: "Scorpe Technologies", contact: null },
      lines: [],
      receipts: { status: "pending", done: 0, total: 1 },
      bills: { count: 0, draft: 0 },
    },
    ...over,
  })
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
    name: "Packing List",
    Page: PackingListDetailPage,
    route: "/purchasing/packing-lists/:id",
    path: "/purchasing/packing-lists/pl1",
    seed: () => seedPackingList(),
    title: /^TG04_0003\s*·\s*Plant upgrade$/,
    badge: "Draft",
    pills: ["SOR", "Odoo delivery", "Made by", "Boxes", "Weight"],
    hasMore: true,
    yourMove: { status: "Waiting for you: Packed by", steps: ["Packed by"] },
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
  {
    // A Purchase Request has no sign-off steps and nothing for More, so it has neither.
    name: "Purchase Request",
    Page: PurchaseRequestsPage,
    route: "/purchasing",
    get path() {
      return `/purchasing?request=${purchaseRequestId}`
    },
    seed: seedPurchaseRequest,
    title: /^S01001\s*·\s*Harbour lights$/,
    badge: "Open",
    pills: ["Buyer", "SOR", "Stage", "Items"],
    hasMore: false,
    yourMove: null,
  },
  {
    name: "Canvass",
    Page: CanvassesPage,
    route: "/purchasing/canvasses",
    // The Canvass opens from the address, so the link is known once the seed has run.
    get path() {
      return `/purchasing/canvasses?canvass=${this.seeded.id}`
    },
    seed() {
      this.seeded = seedCanvass()
    },
    title: /^CNV_0001\s*·\s*Laser toner$/,
    badge: "Open",
    pills: ["Canvasser", "Subject", "Winner"],
    hasMore: true,
    yourMove: {
      status: "Next: say why this supplier",
      steps: ["Offers in", "Winner picked", "Purchase Request"],
    },
  },
  {
    name: "IPAS",
    Page: IpasDetailPage,
    route: "/purchasing/ipas/:id",
    path: `/purchasing/ipas/${IPAS_ID}`,
    seed: () => seedIpas(),
    title: /^TGIPAS_198\s*·\s*Scorpe Technologies$/,
    badge: "Open",
    pills: ["Entity", "Priority", "Source", "Purpose", "Status"],
    hasMore: true,
    yourMove: {
      status: "Waiting for you: 1 · Purchasing",
      steps: ["Section 1 · Purchasing", "Section 2 · Purchasing & Finance"],
    },
  },
  {
    name: "IPAS (cancelled)",
    Page: IpasDetailPage,
    route: "/purchasing/ipas/:id",
    path: `/purchasing/ipas/${IPAS_ID}`,
    seed: () => seedIpas({ state: "cancelled", cancel_reason: "Wrong PO", cancelled_at: "2026-10-21T01:00:00.000Z" }),
    title: /^TGIPAS_198\s*·\s*Scorpe Technologies$/,
    badge: "Cancelled",
    pills: ["Entity", "Priority", "Source", "Purpose"],
    hasMore: true,
    yourMove: { status: "Cancelled. Nothing to do.", steps: ["Section 1 · Purchasing", "Section 2 · Purchasing & Finance"] },
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

    // Inside the record window only: the list behind it can use the same words (a column header).
    const recordWindow = screen.getAllByRole("dialog").find((dialog) => dialog.dataset.modalShell === "record")
    for (const label of record.pills) expect(within(recordWindow).getByText(label)).toBeInTheDocument()
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
