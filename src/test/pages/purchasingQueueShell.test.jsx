import { screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, useLocation } from "react-router"

import PurchasingQueuePage from "@/pages/purchasing/index.jsx"
import { renderWithProviders, setupUser } from "@/test/support"

/**
 * The Procurement Queue as a Queue page (#439): PageShell, one-line FilterBar,
 * a row opens the shared slide-over with `?record=`, Buyer assignment works
 * from the row and from the slide-over.
 */

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-1", has_purchasing_flow: true } }),
}))

const NOW = Date.now()
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString()

const request = (over) => ({
  id: "r-1",
  requested_name: "Cat6 cable",
  requested_quantity: 4,
  requested_unit: "roll",
  requested_description: "Shielded, 305m",
  created_at: daysAgo(3),
  outcome: null,
  requester: { id: "e-1", name: "Sam Sales", avatar_path: null },
  assignee: null,
  opportunity: { id: "o-1", sales_reference: "SOR-001", client_name: "Acme Corp" },
  ...over,
})

const queue = [
  request(),
  request({
    id: "r-2",
    requested_name: "Rack cabinet",
    created_at: daysAgo(9),
    assignee: { id: "b-1", name: "Bea Buyer", avatar_path: null },
    opportunity: { id: "o-2", sales_reference: "SOR-002", client_name: "Globex" },
  }),
]

const assignRequests = vi.fn(async () => {})
vi.mock("@/services/purchasingService", () => ({
  purchasingService: {
    listOpenQueue: vi.fn(async () => queue),
    assignRequests: (...args) => assignRequests(...args),
  },
}))
vi.mock("@/services/employeeService", () => ({
  employeeService: {
    getAllEmployees: vi.fn(async () => [
      { id: "b-1", name: "Bea Buyer", department: "Purchasing" },
      { id: "b-2", name: "Carl Buyer", department: "Purchasing" },
    ]),
  },
}))

const Where = () => <output data-testid="where">{useLocation().search}</output>

function renderAt(entry = "/purchasing") {
  return renderWithProviders(
    <MemoryRouter initialEntries={[entry]}>
      <PurchasingQueuePage />
      <Where />
    </MemoryRouter>,
  )
}

describe("Procurement Queue on PageShell", () => {
  beforeEach(() => assignRequests.mockClear())

  it("renders a Queue page: header, one-line filter bar, table with status and waiting days", async () => {
    renderAt()

    expect(await screen.findByRole("heading", { name: /purchasing\s*queue/i })).toBeInTheDocument()
    expect(screen.getByTestId("page-toolbar")).toContainElement(
      screen.getByRole("textbox", { name: /search/i }),
    )
    expect(await screen.findByRole("button", { name: "Any buyer" })).toBeInTheDocument()

    const row = (await screen.findByText("Cat6 cable")).closest("tr")
    expect(within(row).getByText("Pending")).toBeInTheDocument()
    expect(within(row).getByText("3 days")).toBeInTheDocument()
  })

  it("narrows the rows from the search box", async () => {
    const user = setupUser()
    renderAt()

    await screen.findByText("Cat6 cable")
    await user.type(screen.getByRole("textbox", { name: /search/i }), "globex")

    expect(screen.queryByText("Cat6 cable")).not.toBeInTheDocument()
    expect(screen.getByText("Rack cabinet")).toBeInTheDocument()
  })

  it("opens a row in the slide-over, writing ?record=, and closing clears it", async () => {
    const user = setupUser()
    renderAt()

    await user.click(await screen.findByText("Cat6 cable"))

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("record=r-1"))
    const panel = await screen.findByRole("dialog")
    expect(within(panel).getByText("Shielded, 305m")).toBeInTheDocument()
    expect(within(panel).getByText("1 / 2")).toBeInTheDocument()

    await user.click(within(panel).getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^$/))
  })

  it("mounting with ?record= reopens that request", async () => {
    renderAt("/purchasing?record=r-2")

    const panel = await screen.findByRole("dialog")
    expect(within(panel).getByRole("heading", { name: "Rack cabinet" })).toBeInTheDocument()
    expect(within(panel).getByText("2 / 2")).toBeInTheDocument()
  })

  it("assigns a buyer from the slide-over", async () => {
    const user = setupUser()
    renderAt("/purchasing?record=r-1")

    const panel = await screen.findByRole("dialog")
    await user.click(within(panel).getByRole("combobox", { name: /buyer/i }))
    await user.click(await screen.findByRole("option", { name: /carl buyer/i }))

    await waitFor(() => expect(assignRequests).toHaveBeenCalledWith(["r-1"], "b-2", "u-1"))
  })

  it("assigning from the row does not open the slide-over", async () => {
    const user = setupUser()
    renderAt()

    const row = (await screen.findByText("Cat6 cable")).closest("tr")
    await user.click(within(row).getByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: /carl buyer/i }))

    await waitFor(() => expect(assignRequests).toHaveBeenCalledWith(["r-1"], "b-2", "u-1"))
    expect(screen.getByTestId("where")).toHaveTextContent(/^$/)
  })
})
