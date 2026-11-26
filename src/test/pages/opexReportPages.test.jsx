import { screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OpexPage from "@/pages/finance/opex/index";
import OpexReportPage from "@/pages/finance/opex/[s0]";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { NAV_MODULES } from "@/constants/navigation";
import { getPermissionContext } from "@/utils/permissions";

/** The Finance menu, the OPEX list and the OPEX Report page (#1244). Made-up figures only. */

const mockUser = vi.hoisted(() => ({ current: null }));
const service = vi.hoisted(() => ({
  list: vi.fn(),
  getByS0: vi.fn(),
  create: vi.fn(),
  readFromOdoo: vi.fn(),
  saveSnapshot: vi.fn(),
}));
const settings = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false, logout: vi.fn() }),
}));
vi.mock("@/services/opexReportService", () => ({ opexReportService: service }));
vi.mock("@/services/costingMatrixService", () => ({
  costingMatrixService: {
    getSettings: () => settings.get(),
  },
}));

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname}</output>;
}

const renderAt = (entry) =>
  renderWithProviders(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/finance/opex" element={<OpexPage />} />
        <Route path="/finance/opex/:s0" element={<OpexReportPage />} />
        <Route path="/" element={<p>Home page</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );

const line = (over) => ({
  lineId: 1,
  p0: "P00001",
  supplier: "Made-up Supplier",
  p0State: "purchase",
  product: "Made-up Widget",
  quantity: 2,
  sharePercent: 100,
  pesos: 1000,
  countedPesos: 1000,
  marks: [],
  ...over,
});

const READ = {
  success: true,
  readAt: "2026-11-26T08:00:00.000Z",
  s0: "S00001",
  tags: [{ id: 1, name: "S00001 Made-up Project" }],
  noProjectTag: false,
  projectName: "Made-up Project",
  odooContractPrice: 112000,
  lines: [
    line({ lineId: 1, p0: "P00001" }),
    line({ lineId: 2, p0: "P00002", p0State: "draft", countedPesos: 0, marks: ["draft/cancelled"] }),
    line({ lineId: 3, p0: "P00003", sharePercent: 0, countedPesos: 0, marks: ["other project"] }),
    line({ lineId: 4, p0: "P00004", sharePercent: 50, pesos: 400, countedPesos: 200, marks: ["no tag", "not billed"] }),
  ],
  expenses: [
    { analyticLineId: 1, date: "2026-10-01", description: "Fare", account: "627000 Transportation", accountCode: "627000", amount: 300, group: "operation_admin" },
    { analyticLineId: 2, date: "2026-10-02", description: "Poster", account: "620001 Marketing Expense", accountCode: "620001", amount: 150, group: "marketing" },
  ],
};

beforeEach(() => {
  Object.values(service).forEach((fn) => fn.mockReset());
  service.getByS0.mockResolvedValue({ id: "r1", s0_number: "S00001", contract_price: null, retention: null });
  service.readFromOdoo.mockResolvedValue(READ);
  service.saveSnapshot.mockResolvedValue();
  service.list.mockResolvedValue([]);
  settings.get.mockReset();
  settings.get.mockResolvedValue({ vatDivisor: 1.12, taxRate: 0.06, retentionRate: 0.01, itrRate: 0.08, itrAllowance: 250000 });
});

describe("Finance menu", () => {
  it("shows OPEX to Finance access and Super Admins only", () => {
    const entry = NAV_MODULES.finance.links.find((l) => l.key === "finance.opex");
    const visible = (user) => entry.isPermitted(getPermissionContext(user));
    expect(visible(makeEmployee({ name: "Plain" }))).toBe(false);
    expect(visible(makeEmployee({ name: "Buyer", has_purchasing_flow: true }))).toBe(false);
    expect(visible(makeEmployee({ name: "Finance", has_finance_flow: true }))).toBe(true);
    expect(visible(makeEmployee({ name: "Boss", is_super_admin: true }))).toBe(true);
  });
});

describe("OPEX list", () => {
  it("sends someone without Finance access home", async () => {
    mockUser.current = makeEmployee({ name: "Plain" });
    renderAt("/finance/opex");
    expect(await screen.findByText("Home page")).toBeInTheDocument();
    expect(service.list).not.toHaveBeenCalled();
  });

  it("sends someone without Finance access home from a report too", async () => {
    mockUser.current = makeEmployee({ name: "Plain" });
    renderAt("/finance/opex/S00001");
    expect(await screen.findByText("Home page")).toBeInTheDocument();
    expect(service.readFromOdoo).not.toHaveBeenCalled();
  });

  it("lists each report from its snapshot without calling Odoo", async () => {
    mockUser.current = makeEmployee({ name: "Finance", has_finance_flow: true });
    service.list.mockResolvedValue([
      {
        id: "r1",
        s0_number: "S00001",
        snapshot: { project_name: "Made-up Project", contract_price: 112000, actual_opex: 5000, revenue: 80000, revenue_percent: 71.43, read_at: "2026-11-26T08:00:00.000Z" },
      },
    ]);
    renderAt("/finance/opex");
    expect(await screen.findByText("Made-up Project")).toBeInTheDocument();
    expect(screen.getByText("S00001")).toBeInTheDocument();
    expect(screen.getByText("71.43%")).toBeInTheDocument();
    expect(service.readFromOdoo).not.toHaveBeenCalled();
  });

  it("starts a report from an S0 number and opens it", async () => {
    const user = setupUser();
    mockUser.current = makeEmployee({ name: "Finance", has_finance_flow: true });
    service.create.mockResolvedValue({ report: { id: "r1", s0_number: "S00001" }, existed: false });
    renderAt("/finance/opex");
    await user.click(await screen.findByRole("button", { name: /New OPEX Report/ }));
    await user.type(await screen.findByPlaceholderText("e.g. S06637"), "s00001");
    await user.click(screen.getByRole("button", { name: "Start OPEX Report" }));
    expect(service.create).toHaveBeenCalledWith("S00001");
    expect(await screen.findByText("P00001")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/finance/opex/S00001");
  });

  it("opens the existing report when the S0 already has one", async () => {
    const user = setupUser();
    mockUser.current = makeEmployee({ name: "Finance", has_finance_flow: true });
    service.create.mockResolvedValue({ report: { id: "r1", s0_number: "S00001" }, existed: true });
    renderAt("/finance/opex");
    await user.click(await screen.findByRole("button", { name: /New OPEX Report/ }));
    await user.type(await screen.findByPlaceholderText("e.g. S06637"), "S00001");
    await user.click(screen.getByRole("button", { name: "Start OPEX Report" }));
    expect(await screen.findByText("P00001")).toBeInTheDocument();
  });
});

describe("OPEX Report page", () => {
  beforeEach(() => {
    mockUser.current = makeEmployee({ name: "Finance", has_finance_flow: true });
  });

  it("reads Odoo on open, saves the snapshot and shows lines, expenses and summary", async () => {
    renderAt("/finance/opex/S00001");
    expect(await screen.findByText("P00001")).toBeInTheDocument();
    expect(service.readFromOdoo).toHaveBeenCalledWith("S00001");
    expect(service.saveSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Made-up Project")).toBeInTheDocument();
    expect(screen.getByText(/Odoo read at/)).toBeInTheDocument();

    const ops = screen.getByRole("region", { name: "Operation & Admin" });
    expect(within(ops).getByText("Fare")).toBeInTheDocument();
    const marketing = screen.getByRole("region", { name: "Marketing" });
    expect(within(marketing).getByText("Poster")).toBeInTheDocument();

    const summary = screen.getByRole("region", { name: "Summary" });
    expect(within(summary).getByText("Actual OPEX")).toBeInTheDocument();
    // Product cost 1,200 (counted), Operation & Admin 300, Marketing 150, retention 1% of 112,000.
    const saved = service.saveSnapshot.mock.calls[0][1];
    expect(saved.product_cost).toBe(1200);
    expect(saved.operation_admin).toBe(300);
    expect(saved.marketing).toBe(150);
    expect(saved.actual_opex).toBe(1120 + 1200 + 300 + 150);
  });

  it("greys out draft and other-project lines and shows their marks", async () => {
    renderAt("/finance/opex/S00001");
    const draft = (await screen.findByText("P00002")).closest("tr");
    const other = screen.getByText("P00003").closest("tr");
    const counted = screen.getByText("P00001").closest("tr");
    expect(draft).toHaveAttribute("data-greyed", "true");
    expect(other).toHaveAttribute("data-greyed", "true");
    expect(counted).not.toHaveAttribute("data-greyed");
    expect(within(draft).getByText("draft/cancelled")).toBeInTheDocument();
    expect(screen.getByText("no tag, not billed")).toBeInTheDocument();
  });

  it("warns when Odoo has no Project tag for the S0", async () => {
    service.readFromOdoo.mockResolvedValue({ ...READ, noProjectTag: true, projectName: null, tags: [], lines: [], expenses: [] });
    renderAt("/finance/opex/S00001");
    expect(await screen.findByText(/Odoo has no Project tag for S00001/)).toBeInTheDocument();
  });

  it("reads again on the button and saves a new snapshot", async () => {
    const user = setupUser();
    renderAt("/finance/opex/S00001");
    await screen.findByText("P00001");
    await user.click(screen.getByRole("button", { name: /Read again/ }));
    await vi.waitFor(() => expect(service.readFromOdoo).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(service.saveSnapshot).toHaveBeenCalledTimes(2));
  });

  it("says Odoo could not be read instead of showing zeros", async () => {
    service.readFromOdoo.mockRejectedValue(new Error("Odoo could not be read: down"));
    renderAt("/finance/opex/S00001");
    expect(await screen.findByText(/Odoo could not be read, so no figures are shown/)).toBeInTheDocument();
    expect(screen.queryByText("Actual OPEX")).not.toBeInTheDocument();
    expect(service.saveSnapshot).not.toHaveBeenCalled();
  });
});
