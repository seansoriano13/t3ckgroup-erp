import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import {
    makeCommissionDepartment,
    makeCommissionRate,
    makeCommissionSplit,
    makeEmployee,
    makeOpportunity,
} from "@/test/factories"
import { renderWithProviders } from "@/test/support"
import { waitForNetworkIdle } from "@/test/network"

/**
 * End-to-end journeys through the Commission Pool dashboard.
 *
 * Whole and few, in the style of approvals.e2e: the page is mounted for real
 * and reads a real (in-memory) database through the real service, so the
 * numbers on screen are the product of the actual rate resolution, department
 * allocation and role-split code rather than a hand-written fixture. Only the
 * session is mocked, because "who is signed in" is the one thing a test has to
 * assert rather than perform — and here it decides what money a viewer is
 * allowed to see, which is the whole point of two of these journeys.
 *
 * The arithmetic itself is pinned far more cheaply one layer down, in
 * src/utils/commission.test.js; the service wiring in
 * src/services/commissionService.test.js; the rendering in
 * components/sor/CommissionDashboardView.test.jsx. What only a journey can
 * catch is the seam between them: a real ₱ figure surviving the trip from
 * commission_rates to a KPI card, and a rep being shown their own money but
 * not a colleague's.
 *
 * Lives under src/test/pages rather than beside the page: Generouted routes
 * every file under src/pages with a hardcoded glob, so a test left there
 * becomes a route and pulls this harness into the production bundle.
 */

const mockUser = vi.hoisted(() => ({ current: null }))
// employeeService.getEmployeeByEmail returns camelCase role flags
// (isSuperAdmin / isHead), so that is the shape AuthContext puts on the
// context and the only shape these screens ever see in production.
const auth = () => ({ user: mockUser.current, isAuthLoading: false })

vi.mock("@/context/AuthContext", () => ({ useAuth: auth }))
vi.mock("@/pages/../context/AuthContext", () => ({ useAuth: auth }))

let alice
let bob
let dave

/** Regulation CCPR-2026-001 rates and allocations, as migrations 0028–0032 seed them. */
function seedCommissionPolicy() {
    // Dated as production has them, so a deal contract-dated earlier is
    // genuinely unpriceable here too rather than quietly resolving.
    makeCommissionRate({ rate_type: "VAT", percent: 12, effective_from: "2026-01-01" })
    makeCommissionRate({ rate_type: "WITHHOLDING", percent: 8, effective_from: "2026-01-01" })
    makeCommissionRate({ rate_type: "POOL", percent: 1, effective_from: "2026-01-01" })

    makeCommissionDepartment({ key: "sales", name: "Sales", allocation_percent: 50 })
    makeCommissionDepartment({ key: "operations", name: "Operations", allocation_percent: 25 })
    makeCommissionDepartment({ key: "administration", name: "Administration", allocation_percent: 15 })
    makeCommissionDepartment({ key: "human_resources", name: "Human Resources", allocation_percent: 5 })
    makeCommissionDepartment({
        key: "finance_accounting",
        name: "Finance & Accounting",
        allocation_percent: 5,
    })

    makeCommissionSplit({ project_type: "SSP", share_role: "deal_owner", percent: 80 })
    makeCommissionSplit({ project_type: "SSP", share_role: "sales_director", percent: 20 })
    makeCommissionSplit({ project_type: "CP", share_role: "deal_owner", percent: 60 })
    makeCommissionSplit({ project_type: "CP", share_role: "supporting_salesperson", percent: 20 })
    makeCommissionSplit({ project_type: "CP", share_role: "sales_director", percent: 20 })
}

/**
 * One awarded Single Salesperson Project worth ₱1.2M and one awarded
 * Collaborative Project worth ₱2M, both fully staffed.
 *
 *   ₱1,200,000 / 1.12 * 0.92 = ₱985,714.29 commissionable -> ₱9,857.14 pool
 *   ₱2,000,000 / 1.12 * 0.92 = ₱1,642,857.14            -> ₱16,428.57 pool
 *   Pool ₱26,285.71, Sales department half of it: ₱13,142.86
 */
function seedAwardedDeals() {
    makeOpportunity({
        client_name: "Alpha Corp",
        project_title: "Alpha Rollout",
        project_type: "SSP",
        status: "AWARDED",
        // Required by the opportunity guard for anything past Lead.
        sales_reference: "S01001",
        expected_value: 1_200_000,
        contract_date: "2026-03-01",
        deal_owner_id: alice.id,
        sales_director_id: dave.id,
    })

    makeOpportunity({
        client_name: "Beta Corp",
        project_title: "Beta Rollout",
        project_type: "CP",
        status: "CLOSED_WON",
        sales_reference: "S01002",
        expected_value: 2_000_000,
        contract_date: "2026-03-15",
        deal_owner_id: bob.id,
        support_sales_1_id: alice.id,
        sales_director_id: dave.id,
    })
}

// Imported here rather than at the top of the file: a static import is
// hoisted above the `auth` binding the vi.mock factory closes over, and the
// factory then runs against a variable still in its temporal dead zone.
const loadCommissionPage = async () =>
    (await import("@/pages/opportunities/commission/index.jsx")).default

async function openDashboard() {
    const CommissionPage = await loadCommissionPage()
    const result = renderWithProviders(
        <MemoryRouter>
            <CommissionPage />
        </MemoryRouter>,
    )
    await waitForNetworkIdle()
    return result
}

// Pulling in the page drags Recharts and the whole dashboard tree with it,
// which costs seconds. Paid once here rather than inside the first test's
// timeout, where it left that one test alone flaky at the 5s default.
beforeAll(async () => {
    await loadCommissionPage()
})

beforeEach(() => {
    alice = makeEmployee({ name: "Alice Rep", has_sales_flow: true })
    bob = makeEmployee({ name: "Bob Rep", has_sales_flow: true })
    dave = makeEmployee({ name: "Dave Director", has_sales_flow: true })
    mockUser.current = null
    seedCommissionPolicy()
})

describe("Commission Pool dashboard", () => {
    it("prices awarded deals from the stored rates and credits each participant", async () => {
        seedAwardedDeals()
        mockUser.current = { id: "admin-1", name: "Boss", isSuperAdmin: true }

        await openDashboard()

        // Every one of these is computed, not seeded: VAT divided out,
        // withholding applied, 1% pool taken, 50% to Sales.
        expect(await screen.findByText("₱2,628,571.43")).toBeInTheDocument()
        expect(screen.getByText("₱26,285.71")).toBeInTheDocument()
        // Shown on the Sales Share card and again as the roster's footing.
        expect(screen.getAllByText("₱13,142.86").length).toBeGreaterThanOrEqual(1)
        expect(screen.getByText("2 / 2")).toBeInTheDocument()

        // Roster: Alice owns the SSP (80% of ₱4,928.57) and supports the CP
        // (20% of ₱8,214.29) = ₱5,585.71. Bob owns the CP (60%) = ₱4,928.57.
        // Dave directs both (20% each) = ₱2,628.57. Together: ₱13,142.86.
        // The last cell of a roster row is that person's Total Commission.
        // Read it positionally: Bob's total equals his deal-owner share, so
        // matching on the text alone would find two cells in his row.
        const totalFor = (name) =>
            screen.getByText(name).closest("tr").querySelector("td:last-child").textContent

        expect(totalFor("Alice Rep")).toContain("₱5,585.71")
        expect(totalFor("Bob Rep")).toContain("₱4,928.57")
        expect(totalFor("Dave Director")).toContain("₱2,628.57")
    })

    it("shows a rep their own share and withholds a colleague's", async () => {
        seedAwardedDeals()
        mockUser.current = {
            id: alice.id,
            name: "Alice Rep",
            isSuperAdmin: false,
            isHead: false,
            department: "Sales",
        }

        await openDashboard()

        // Alice's own money, in full.
        expect(await screen.findByText("₱5,585.71")).toBeInTheDocument()

        // Her colleagues' totals are replaced by a share of the Sales pool.
        expect(screen.queryByText("₱4,928.57")).not.toBeInTheDocument()
        expect(screen.queryByText("₱2,628.57")).not.toBeInTheDocument()
        expect(screen.getByText("37.5% Share")).toBeInTheDocument()
        expect(screen.getByText("20.0% Share")).toBeInTheDocument()

        // The company-wide pool, and the means to export it, stay closed.
        expect(screen.queryByText("₱26,285.71")).not.toBeInTheDocument()
        expect(screen.queryByText(/Export CSV/i)).not.toBeInTheDocument()
    })

    it("keeps every panel on the same deals when the ledger is filtered", async () => {
        seedAwardedDeals()
        mockUser.current = { id: "admin-1", name: "Boss", isSuperAdmin: true }

        await openDashboard()
        expect(await screen.findByText("₱26,285.71")).toBeInTheDocument()

        await userEvent.type(
            screen.getByPlaceholderText(/Search deals, clients, reps…/i),
            "Alpha",
        )

        // Alpha alone: ₱9,857.14 pool, one deal, and only the two people on it.
        expect(await screen.findByText("₱9,857.14")).toBeInTheDocument()
        expect(screen.queryByText("₱26,285.71")).not.toBeInTheDocument()
        expect(screen.getByText("1 / 1")).toBeInTheDocument()
        expect(screen.getByText("Alice Rep")).toBeInTheDocument()
        expect(screen.getByText("Dave Director")).toBeInTheDocument()
        expect(screen.queryByText("Bob Rep")).not.toBeInTheDocument()
    })

    it("leaves pipeline deals out of the realized pool until the scope is switched", async () => {
        // Not yet awarded, so it has no contract date and no realized pool.
        makeOpportunity({
            client_name: "Gamma Corp",
            project_title: "Gamma Pursuit",
            project_type: "SSP",
            status: "LEAD",
            expected_value: 1_200_000,
            deal_owner_id: alice.id,
            sales_director_id: dave.id,
        })
        mockUser.current = { id: "admin-1", name: "Boss", isSuperAdmin: true }

        await openDashboard()

        expect(await screen.findByText("0 / 0")).toBeInTheDocument()
        expect(screen.queryByText("Gamma Pursuit")).not.toBeInTheDocument()

        await userEvent.click(screen.getByRole("button", { name: /Pipeline Forecast/i }))
        await waitForNetworkIdle()

        // Priced off today's rates as a moving forecast: same ₱9,857.14 pool,
        // but counted as an open deal rather than a won one.
        expect(await screen.findByText("₱9,857.14")).toBeInTheDocument()
        expect(screen.getByText("0 / 1")).toBeInTheDocument()
    })

    it("identifies a ledger row by the Sales Reference the register shows", async () => {
        seedAwardedDeals()
        mockUser.current = { id: "admin-1", name: "Boss", isSuperAdmin: true }

        await openDashboard()
        await userEvent.click(screen.getByRole("button", { name: /Transaction Ledger/i }))

        // opportunity_no has not been minted since migration 0025, so a
        // dashboard keyed on it showed a blank cell for every live deal.
        const row = (await screen.findByText("Alpha Rollout")).closest("tr")
        expect(within(row).getByText("S01001")).toBeInTheDocument()
    })

    // Rates in this project begin 2026-01-01. A deal contract-dated before
    // that cannot be priced, and resolving rates happens per opportunity
    // inside the aggregation loop — so one such row used to take the whole
    // page down with "Failed to load commission analytics".
    it("keeps working when one deal predates the rate table, and names it", async () => {
        seedAwardedDeals()
        makeOpportunity({
            client_name: "Legacy Client",
            project_title: "Legacy Rollout",
            project_type: "SSP",
            status: "AWARDED",
            sales_reference: "S01099",
            expected_value: 500_000,
            contract_date: "2025-11-30",
            deal_owner_id: alice.id,
            sales_director_id: dave.id,
        })
        mockUser.current = { id: "admin-1", name: "Boss", isSuperAdmin: true }

        await openDashboard()

        // The two priceable deals are still reported in full.
        expect(await screen.findByText("₱26,285.71")).toBeInTheDocument()
        expect(screen.getByText("2 / 2")).toBeInTheDocument()
        expect(screen.queryByText(/Failed to load commission analytics/i)).not.toBeInTheDocument()

        // And the one that could not be priced is named rather than dropped.
        expect(screen.getByText(/1 opportunity is not included below/i)).toBeInTheDocument()
        expect(screen.getByText(/S01099/)).toBeInTheDocument()
        expect(screen.getByText(/Contract Date 2025-11-30/)).toBeInTheDocument()
    })

    // The SOR modal's "View in Commission Dashboard" button deep-links here
    // with the opportunity id. The dashboard opens in Realized scope, but
    // most opportunities are still in the pipeline — 84 of 89 live ones in
    // production — so the deal the user clicked through from was not in the
    // ledger they landed on.
    it("shows a pipeline deal that was deep-linked from the SOR modal", async () => {
        const lead = makeOpportunity({
            client_name: "Gamma Corp",
            project_title: "Gamma Pursuit",
            project_type: "SSP",
            status: "PROPOSAL_SUBMITTED",
            sales_reference: "S01300",
            expected_value: 1_200_000,
            deal_owner_id: alice.id,
            sales_director_id: dave.id,
        })
        mockUser.current = { id: "admin-1", name: "Boss", isSuperAdmin: true }

        const CommissionPage = await loadCommissionPage()
        renderWithProviders(
            <MemoryRouter
                initialEntries={[
                    {
                        pathname: "/opportunities/commission",
                        state: { openOpportunityId: lead.id },
                    },
                ]}
            >
                <CommissionPage />
            </MemoryRouter>,
        )
        await waitForNetworkIdle()

        expect(await screen.findByText("Gamma Pursuit")).toBeInTheDocument()
        expect(screen.getByText("S01300")).toBeInTheDocument()
    })

    it("states the split rules that are actually stored", async () => {
        seedAwardedDeals()
        mockUser.current = { id: "admin-1", name: "Boss", isSuperAdmin: true }

        await openDashboard()
        expect(await screen.findByText("₱26,285.71")).toBeInTheDocument()

        await userEvent.click(screen.getByRole("button", { name: /Split Rules/i }))

        const ssp = screen
            .getByText("SSP — Single Salesperson Project")
            .closest("div").parentElement
        expect(ssp).toHaveTextContent("80%")
        expect(ssp).toHaveTextContent("20%")
        // A Single Salesperson Project has no supporting-salesperson row at all.
        expect(ssp).toHaveTextContent("N/A")
    })
})
