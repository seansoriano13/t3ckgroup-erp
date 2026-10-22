/**
 * The Purchasing anatomy test (spec #631, "Testing Decisions"): one page test
 * that renders each Purchasing list through the page harness against the fake
 * database and runs the SAME checks on every one. It is the one place a new
 * Purchasing screen gets checked.
 *
 * To add a screen, add ONE entry to LISTS below:
 *
 *   {
 *     name: "Canvasses",              // the describe title
 *     Page: CanvassesPage,            // the page component
 *     route: "/purchasing/canvasses", // where it is mounted
 *     pills: ["Open", "Signed off", "All"],
 *     counts: { Open: 1, All: 1 },    // the pills the seeded record fills (an empty pill shows no count)
 *     noun: "canvasses",              // the pager's noun
 *     seed() {                        // put one record in the fake database, stub its RPCs
 *       ...
 *       return { employee, reference: "CNV-0001", name: "Subject", state: "Open" };
 *     },
 *   }
 *
 * `seed` returns the signed-in employee and what the record's row must show:
 * the identity cell's reference (or `word`, which must not be mono) over its
 * name, and the State badge's text. Records (the window, title, pills, Your
 * move) get their own `RECORDS` table when a record ticket needs it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, within } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"

import PurchaseRequestsPage from "@/pages/purchasing/index.jsx"
import IpasListPage from "@/pages/purchasing/ipas/index.jsx"
import { stubIpasRpcs } from "@/test/stubs/ipasRpc"
import { renderWithProviders } from "@/test/support"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubProcurementQueueRpcs } from "@/test/stubs/procurementQueueRpc"

const auth = vi.hoisted(() => ({ user: null }))
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: auth.user, isAuthLoading: false }) }))

const LISTS = [
  {
    name: "Purchase Requests",
    Page: PurchaseRequestsPage,
    route: "/purchasing",
    pills: ["Open", "Closed", "All"],
    counts: { Open: 1, All: 1 },
    noun: "requests",
    seed() {
      const buyer = makeEmployee({ name: "Pia Buyer", department: "OPERATIONS", has_purchasing_flow: true })
      const salesperson = makeEmployee({ name: "Ana Reyes", department: "SALES" })
      const sor = makeOpportunity({
        registered_by: salesperson.id,
        deal_owner_id: salesperson.id,
        sales_reference: "S01001",
        project_title: "Harbour lights",
      })
      const request = db.seed("purchase_requests", { opportunity_id: sor.id, created_by: salesperson.id, buyer_id: null })
      db.seed("purchase_request_items", {
        request_id: request.id,
        source: "new",
        name: "Floodlight",
        quantity: 1,
        status: "requested",
        requested_by: salesperson.id,
      })
      stubProcurementQueueRpcs({ actorId: buyer.id })
      return { employee: buyer, reference: "S01001", name: "Harbour lights", state: "Open" }
    },
  },
  {
    name: "IPAS",
    Page: IpasListPage,
    route: "/purchasing/ipas",
    pills: ["Open", "Filed", "Cancelled", "All"],
    counts: { Open: 1, All: 1 },
    noun: "IPAS",
    seed() {
      const buyer = makeEmployee({ name: "Pia Buyer", department: "OPERATIONS", has_purchasing_flow: true })
      db.seed("ipas", {
        number: "TGIPAS_049",
        po_number: "P02552",
        priority: "high",
        source: "local",
        purpose: "inventory",
        state: "open",
        created_by: buyer.id,
        odoo_fetched_at: "2026-10-13T02:00:00.000Z",
        odoo_copy: {
          po: { id: 1, name: "P02552", state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
          supplier: { id: 5, name: "Scorpe Technologies", contact: null },
          lines: [],
          receipts: { status: "pending", done: 0, total: 1 },
          bills: { count: 0, draft: 0 },
        },
      })
      stubIpasRpcs({ actorId: buyer.id })
      return { employee: buyer, reference: "TGIPAS_049", name: "Scorpe Technologies", state: "Open" }
    },
  },
]

function renderList({ Page, route }) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path={route} element={<Page />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe.each(LISTS)("Purchasing list anatomy: $name", (list) => {
  let shown
  let toolbar

  beforeEach(async () => {
    localStorage.clear()
    shown = list.seed()
    auth.user = { ...shown.employee, id: shown.employee.id }
    renderList(list)
    toolbar = await screen.findByTestId("page-toolbar")
    await screen.findByText(shown.reference)
  })

  const firstRow = () => screen.getByText(shown.reference).closest("tr")

  it("opens with state pills, each with a count", () => {
    const tabs = within(toolbar).getAllByRole("tab")
    expect(tabs.map((tab) => tab.textContent.replace(/\d+$/, "").trim())).toEqual(list.pills)
    // A pill with nothing in it shows no count, so the entry names the ones the seeded record fills.
    for (const [label, count] of Object.entries(list.counts)) {
      expect(within(toolbar).getByRole("tab", { name: new RegExp(`^${label}\\s*${count}$`) })).toBeInTheDocument()
    }
  })

  it("has one filter bar: a search box, at most three dropdowns before Filters, and Export at the end", () => {
    expect(within(toolbar).getByRole("textbox", { name: /search/i })).toBeInTheDocument()

    const dropdowns = within(toolbar)
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-haspopup") === "listbox")
    expect(dropdowns.length).toBeLessThanOrEqual(3)

    const exportButton = within(toolbar).getByRole("button", { name: "Export to Excel" })
    const buttons = within(toolbar).getAllByRole("button")
    for (const dropdown of dropdowns) {
      expect(buttons.indexOf(dropdown)).toBeLessThan(buttons.indexOf(exportButton))
    }
  })

  it("has a table with sortable headings and a State heading", () => {
    const headings = within(screen.getByRole("table")).getAllByRole("columnheader")
    const sortable = headings.filter((heading) => heading.hasAttribute("aria-sort"))
    expect(sortable.length).toBeGreaterThanOrEqual(3)
    expect(headings.at(-1)).toHaveTextContent(/^state$/i)
    expect(headings.at(-1)).toHaveAttribute("aria-sort")
  })

  it("names each record in the first column: its reference or word over its name", () => {
    const firstCell = within(firstRow()).getAllByRole("cell")[0]
    expect(firstCell).toHaveTextContent(shown.reference)
    expect(firstCell).toHaveTextContent(shown.name)
    if (shown.word) expect(within(firstCell).getByText(shown.word)).not.toHaveClass("font-mono")
  })

  it("ends each row with its State as a badge", () => {
    const cells = within(firstRow()).getAllByRole("cell")
    expect(cells.at(-1)).toHaveTextContent(new RegExp(`^${shown.state}$`, "i"))
  })

  it("ends with the shared pager", () => {
    expect(screen.getByText(/^Showing/)).toHaveTextContent(`Showing 1 to 1 of 1 ${list.noun}`)
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toBeInTheDocument()
  })
})
