import { screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OpexPage from "@/pages/finance/opex/index";
import OpexReportPage from "@/pages/finance/opex/[s0]";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";
import { NAV_MODULES } from "@/constants/navigation";
import { getPermissionContext } from "@/utils/permissions";

/**
 * The Finance menu, the OPEX list and the OPEX Report window (#1244, #1245; redesigned
 * 2026-11-26 to work like the Purchasing lists and the IPAS window). Made-up figures only.
 */

const mockUser = vi.hoisted(() => ({ current: null }));
const service = vi.hoisted(() => ({
  list: vi.fn(),
  getReport: vi.fn(),
  create: vi.fn(),
  readFromOdoo: vi.fn(),
  saveSnapshot: vi.fn(),
  setReportField: vi.fn(),
  addP0: vi.fn(),
  p0ExistsInOdoo: vi.fn(),
  removeP0: vi.fn(),
  saveTypedCost: vi.fn(),
  deleteTypedCost: vi.fn(),
  setLinePrice: vi.fn(),
  setLeftOut: vi.fn(),
}));
const settings = vi.hoisted(() => ({ get: vi.fn() }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: toast }));

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

const EDITS = { handP0s: [], typedCosts: [], linePrices: [], leftOut: [] };
const REPORT = { id: "r1", s0_number: "S00001", contract_price: null, retention: null };
const stored = ({ report = {}, edits = {}, snapshot = null } = {}) => ({ report: { ...REPORT, ...report }, snapshot, edits: { ...EDITS, ...edits } });
const LIST_ROW = {
  id: "r1",
  s0_number: "S00001",
  snapshot: { project_name: "Made-up Project", contract_price: 112000, actual_opex: 5000, revenue: 80000, revenue_percent: 71.43, read_at: "2026-11-26T08:00:00.000Z" },
};
const lastSnapshot = () => service.saveSnapshot.mock.calls.at(-1)[1];

beforeEach(() => {
  Object.values(service).forEach((fn) => fn.mockReset());
  service.getReport.mockResolvedValue(stored());
  service.readFromOdoo.mockResolvedValue(READ);
  service.saveSnapshot.mockResolvedValue();
  for (const k of ["setReportField", "addP0", "removeP0", "saveTypedCost", "deleteTypedCost", "setLinePrice", "setLeftOut"]) service[k].mockResolvedValue();
  service.p0ExistsInOdoo.mockResolvedValue(true);
  service.list.mockResolvedValue([]);
  settings.get.mockReset();
  settings.get.mockResolvedValue({ vatDivisor: 1.12, taxRate: 0.06, retentionRate: 0.01, itrRate: 0.08, itrAllowance: 250000, goLinePercent: 20 });
  toast.mockReset();
  toast.error.mockReset();
});

/** Waits for Odoo's answer to show in the window, then opens every block. */
async function openReport(user) {
  await screen.findByText(/Read from Odoo/);
  await user.click(screen.getByRole("button", { name: "Open all" }));
}

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

  it("lists each report from its snapshot without calling Odoo, with its state and the totals", async () => {
    mockUser.current = makeEmployee({ name: "Finance", has_finance_flow: true });
    service.list.mockResolvedValue([LIST_ROW]);
    renderAt("/finance/opex");
    expect(await screen.findByText("Made-up Project")).toBeInTheDocument();
    expect(screen.getByText("S00001")).toBeInTheDocument();
    expect(screen.getByText("71.43%")).toBeInTheDocument();
    expect(within(screen.getByTestId("opex-row")).getByText("On target")).toBeInTheDocument();
    expect(screen.getByTestId("opex-totals")).toHaveTextContent("Totals for 1 shown");
    expect(service.readFromOdoo).not.toHaveBeenCalled();
  });

  it("narrows by the state pills and the search", async () => {
    const user = setupUser();
    mockUser.current = makeEmployee({ name: "Finance", has_finance_flow: true });
    service.list.mockResolvedValue([
      LIST_ROW,
      { id: "r2", s0_number: "S00002", snapshot: { project_name: "Thin Bridge", contract_price: 1000, revenue: 50, revenue_percent: 5, read_at: "2026-11-26T08:00:00.000Z" } },
    ]);
    renderAt("/finance/opex");
    await screen.findByText("Thin Bridge");
    await user.click(screen.getByRole("tab", { name: /Below go line/ }));
    expect(screen.queryByText("Made-up Project")).not.toBeInTheDocument();
    expect(screen.getByText("Thin Bridge")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /All/ }));
    await user.type(screen.getByPlaceholderText("Search S0 or project"), "made-up");
    const shown = screen.getAllByTestId("opex-row");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toHaveTextContent("Made-up Project");
  });

  it("starts a report from an S0 number and opens it in its window", async () => {
    const user = setupUser();
    mockUser.current = makeEmployee({ name: "Finance", has_finance_flow: true });
    service.create.mockResolvedValue({ report: { id: "r1", s0_number: "S00001" }, existed: false });
    renderAt("/finance/opex");
    await user.click(await screen.findByRole("button", { name: /New OPEX Report/ }));
    await user.type(await screen.findByPlaceholderText("e.g. S06637"), "s00001");
    await user.click(screen.getByRole("button", { name: "Start OPEX Report" }));
    expect(service.create).toHaveBeenCalledWith("S00001");
    expect(await screen.findByText(/Read from Odoo/)).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/finance/opex/S00001");
  });

  it("opens the existing report when the S0 already has one, and says so", async () => {
    const user = setupUser();
    mockUser.current = makeEmployee({ name: "Finance", has_finance_flow: true });
    service.create.mockResolvedValue({ report: { id: "r1", s0_number: "S00001" }, existed: true });
    renderAt("/finance/opex");
    await user.click(await screen.findByRole("button", { name: /New OPEX Report/ }));
    await user.type(await screen.findByPlaceholderText("e.g. S06637"), "S00001");
    await user.click(screen.getByRole("button", { name: "Start OPEX Report" }));
    expect(await screen.findByText(/Read from Odoo/)).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("already has an OPEX Report"));
  });
});

describe("OPEX Report window", () => {
  beforeEach(() => {
    mockUser.current = makeEmployee({ name: "Finance", has_finance_flow: true });
  });

  it("reads Odoo on open, saves the snapshot and shows lines, expenses and summary", async () => {
    const user = setupUser();
    renderAt("/finance/opex/S00001");
    await openReport(user);
    expect(service.getReport).toHaveBeenCalledWith("S00001");
    expect(service.readFromOdoo).toHaveBeenCalledWith("S00001", []);
    expect(service.saveSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/Made-up Project/).length).toBeGreaterThan(0);

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

  it("shows the saved figures at once while Odoo is still being read", async () => {
    service.readFromOdoo.mockReturnValue(new Promise(() => {}));
    service.getReport.mockResolvedValue(stored({ snapshot: { ...LIST_ROW.snapshot, read_at: "2026-11-20T08:00:00.000Z" } }));
    renderAt("/finance/opex/S00001");
    expect(await screen.findByText(/Reading Odoo… the figures are the ones saved/)).toBeInTheDocument();
    expect(screen.getAllByText("₱112,000.00").length).toBeGreaterThan(0);
    expect(service.saveSnapshot).not.toHaveBeenCalled();
  });

  it("does not read Odoo again when the same report is reopened", async () => {
    const user = setupUser();
    service.list.mockResolvedValue([LIST_ROW]);
    renderAt("/finance/opex/S00001");
    await screen.findByText(/Read from Odoo/);
    await user.click(screen.getByRole("button", { name: "Close window" }));
    await vi.waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/finance\/opex$/));
    await user.click(await screen.findByTestId("opex-row"));
    expect(await screen.findByText(/Read from Odoo/)).toBeInTheDocument();
    expect(service.readFromOdoo).toHaveBeenCalledTimes(1);
    expect(service.saveSnapshot).toHaveBeenCalledTimes(1);
  });

  it("greys out draft and other-project lines and shows the mark that matters", async () => {
    const user = setupUser();
    renderAt("/finance/opex/S00001");
    await openReport(user);
    const p0 = screen.getByRole("group", { name: "P0 lines" });
    expect(within(p0).getAllByTestId("opex-line-greyed")).toHaveLength(2);
    expect(within(p0).getAllByTestId("opex-line")).toHaveLength(2);
    const draft = within(p0).getByRole("region", { name: /P00002/ });
    expect(within(draft).getByText("Not counted")).toBeInTheDocument();
    expect(within(within(p0).getByRole("region", { name: /P00004/ })).getByText("No tag")).toBeInTheDocument();
  });

  it("warns when Odoo has no Project tag for the S0", async () => {
    service.readFromOdoo.mockResolvedValue({ ...READ, noProjectTag: true, projectName: null, tags: [], lines: [], expenses: [] });
    renderAt("/finance/opex/S00001");
    expect(await screen.findByText(/Odoo has no Project tag for S00001/)).toBeInTheDocument();
  });

  it("reads again on the button and saves a new snapshot", async () => {
    const user = setupUser();
    renderAt("/finance/opex/S00001");
    await screen.findByText(/Read from Odoo/);
    service.readFromOdoo.mockResolvedValue({ ...READ, readAt: "2026-11-26T09:00:00.000Z" });
    await user.click(screen.getByRole("button", { name: /Read again/ }));
    await vi.waitFor(() => expect(service.readFromOdoo).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(service.saveSnapshot).toHaveBeenCalledTimes(2));
  });

  it("says Odoo could not be read instead of showing zeros", async () => {
    service.readFromOdoo.mockRejectedValue(new Error("Odoo could not be read: down"));
    renderAt("/finance/opex/S00001");
    expect(await screen.findByText(/Odoo could not be read, so the lines are not shown/)).toBeInTheDocument();
    expect(screen.queryByText("Actual OPEX")).not.toBeInTheDocument();
    expect(service.saveSnapshot).not.toHaveBeenCalled();
  });

  it("says so when the S0 has no report", async () => {
    service.getReport.mockResolvedValue(null);
    renderAt("/finance/opex/S00009");
    expect(await screen.findByText("Not found, or not yours to see")).toBeInTheDocument();
    expect(service.readFromOdoo).not.toHaveBeenCalled();
  });
});

describe("OPEX Report hand edits (#1245)", () => {
  beforeEach(() => {
    mockUser.current = makeEmployee({ name: "Finance", has_finance_flow: true });
  });

  it("adds a P0 by hand: stores it and reads Odoo with it", async () => {
    const user = setupUser();
    renderAt("/finance/opex/S00001");
    await openReport(user);
    await user.click(screen.getAllByRole("button", { name: /Add P0/ })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add a P0" });
    await user.type(within(dialog).getByPlaceholderText("e.g. P02367"), "p02367");
    service.getReport.mockResolvedValue(stored({ edits: { handP0s: [{ id: "h1", p0_number: "P02367" }] } }));
    await user.click(within(dialog).getByRole("button", { name: "Add P0" }));
    await vi.waitFor(() => expect(service.addP0).toHaveBeenCalledWith("r1", "P02367"));
    await vi.waitFor(() => expect(service.readFromOdoo).toHaveBeenCalledWith("S00001", ["P02367"]));
  });

  it("does not store a hand-added P0 that Odoo does not have, and says so", async () => {
    const user = setupUser();
    service.p0ExistsInOdoo.mockResolvedValue(false);
    renderAt("/finance/opex/S00001");
    await openReport(user);
    await user.click(screen.getAllByRole("button", { name: /Add P0/ })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add a P0" });
    await user.type(within(dialog).getByPlaceholderText("e.g. P02367"), "p09999");
    await user.click(within(dialog).getByRole("button", { name: "Add P0" }));
    await vi.waitFor(() => expect(service.p0ExistsInOdoo).toHaveBeenCalledWith("P09999"));
    expect(service.addP0).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Odoo has no P0 P09999")));
  });

  it("shows a hand-added P0 that Odoo no longer has, and lets Finance remove it", async () => {
    const user = setupUser();
    service.getReport.mockResolvedValue(stored({ edits: { handP0s: [{ id: "h1", p0_number: "P09999" }] } }));
    renderAt("/finance/opex/S00001");
    const gone = await screen.findByRole("group", { name: "No longer in Odoo" });
    expect(within(gone).getByText(/Odoo no longer has this P0/)).toBeInTheDocument();
    await user.click(within(gone).getByRole("button", { name: "Remove P09999" }));
    await user.click(await screen.findByRole("button", { name: "Remove P0" }));
    expect(service.removeP0).toHaveBeenCalledWith("h1");
  });

  it("counts a Typed cost in the group it is filed under and marks it typed", async () => {
    const user = setupUser();
    service.getReport.mockResolvedValue(
      stored({ edits: { typedCosts: [{ id: "c1", cost_date: "2026-10-05", description: "Forwarder by card", amount: 500, note: "card", cost_group: "marketing" }] } }),
    );
    renderAt("/finance/opex/S00001");
    await openReport(user);
    const typed = screen.getByRole("group", { name: "Typed costs" });
    expect(within(typed).getByText(/Forwarder by card/)).toBeInTheDocument();
    expect(within(typed).getByText("typed")).toBeInTheDocument();
    expect(within(typed).getByText(/counts as Marketing/)).toBeInTheDocument();
    await vi.waitFor(() => expect(lastSnapshot().marketing).toBe(650));
    expect(lastSnapshot().product_cost).toBe(1200);
  });

  it("saves a new Typed cost with its group", async () => {
    const user = setupUser();
    renderAt("/finance/opex/S00001");
    await openReport(user);
    await user.click(screen.getByRole("button", { name: /Add Typed cost/ }));
    const dialog = await screen.findByRole("dialog", { name: "Add Typed cost" });
    await user.type(within(dialog).getByLabelText("Description"), "Notary");
    await user.type(within(dialog).getByLabelText("Amount (pesos)"), "250");
    await user.click(within(dialog).getByRole("button", { name: "Save Typed cost" }));
    expect(service.saveTypedCost).toHaveBeenCalledWith("r1", expect.objectContaining({ description: "Notary", amount: 250, cost_group: "product" }));
  });

  it("deletes a Typed cost after asking", async () => {
    const user = setupUser();
    service.getReport.mockResolvedValue(stored({ edits: { typedCosts: [{ id: "c1", cost_date: null, description: "Notary", amount: 200, note: null, cost_group: "operation_admin" }] } }));
    renderAt("/finance/opex/S00001");
    await openReport(user);
    await user.click(screen.getByRole("button", { name: "Edit Notary" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Typed cost" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("dialog", { name: /Delete Typed cost/ });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(service.deleteTypedCost).toHaveBeenCalledWith("c1"));
  });

  it("counts a typed price on a zero-price line, and clearing it goes back to Odoo's zero", async () => {
    const user = setupUser();
    const zero = line({ lineId: 9, p0: "P00009", product: "Headlamp", quantity: 3, pesos: 0, countedPesos: 0, marks: ["zero price"] });
    service.readFromOdoo.mockResolvedValue({ ...READ, lines: [zero], expenses: [] });
    service.getReport.mockResolvedValue(stored({ edits: { linePrices: [{ id: "p1", odoo_line_id: 9, unit_price: 100 }] } }));
    renderAt("/finance/opex/S00001");
    await openReport(user);
    const p0 = screen.getByRole("group", { name: "P0 lines" });
    expect(within(p0).getByText("Typed price")).toBeInTheDocument();
    expect(within(p0).queryByText("Zero price")).not.toBeInTheDocument();
    await vi.waitFor(() => expect(lastSnapshot().product_cost).toBe(300));
    await user.click(within(p0).getByRole("button", { name: /Headlamp/ }));
    await user.click(await screen.findByRole("button", { name: /Back to Odoo/ }));
    expect(service.setLinePrice).toHaveBeenCalledWith("r1", 9, null);
  });

  it("types a unit price for a zero-price line, under the line", async () => {
    const user = setupUser();
    const zero = line({ lineId: 9, p0: "P00009", product: "Headlamp", pesos: 0, countedPesos: 0, marks: ["zero price"] });
    service.readFromOdoo.mockResolvedValue({ ...READ, lines: [zero], expenses: [] });
    renderAt("/finance/opex/S00001");
    await openReport(user);
    const p0 = screen.getByRole("group", { name: "P0 lines" });
    expect(within(p0).getByText("Zero price")).toBeInTheDocument();
    await user.click(within(p0).getByRole("button", { name: /Headlamp/ }));
    await user.type(await screen.findByLabelText("Unit price (pesos)"), "100");
    await user.click(screen.getByRole("button", { name: "Save price" }));
    expect(service.setLinePrice).toHaveBeenCalledWith("r1", 9, 100);
  });

  it("crosses out a left-out expense and does not count it; putting it back is one click", async () => {
    const user = setupUser();
    service.getReport.mockResolvedValue(stored({ edits: { leftOut: [{ id: "l1", analytic_line_id: 1, note: "wrong project" }] } }));
    renderAt("/finance/opex/S00001");
    await openReport(user);
    const ops = screen.getByRole("region", { name: "Operation & Admin" });
    expect(within(ops).getByTestId("opex-expense-left-out")).toHaveTextContent("Fare");
    expect(within(ops).getByText(/Left out: wrong project/)).toBeInTheDocument();
    await vi.waitFor(() => expect(lastSnapshot().operation_admin).toBe(0));
    await user.click(within(ops).getByRole("button", { name: "Put back Fare" }));
    expect(service.setLeftOut).toHaveBeenCalledWith("r1", 1, false, undefined);
  });

  it("leaves an expense out with a note", async () => {
    const user = setupUser();
    renderAt("/finance/opex/S00001");
    await openReport(user);
    await user.click(screen.getByRole("button", { name: "Leave out Fare" }));
    await user.type(await screen.findByLabelText("Note (optional)"), "wrong project");
    await user.click(screen.getByRole("button", { name: "Leave out" }));
    expect(service.setLeftOut).toHaveBeenCalledWith("r1", 1, true, "wrong project");
  });

  it("uses a typed Contract price and a typed retention of zero, both marked typed", async () => {
    service.getReport.mockResolvedValue(stored({ report: { contract_price: 224000, retention: 0 } }));
    renderAt("/finance/opex/S00001");
    await screen.findByText(/Read from Odoo/);
    await vi.waitFor(() => expect(lastSnapshot().contract_price).toBe(224000));
    // Retention is a typed zero, so Actual OPEX is only the costs: 1,200 + 300 + 150.
    expect(lastSnapshot().actual_opex).toBe(1650);
    const summary = screen.getByRole("region", { name: "Summary" });
    expect(within(summary).getAllByText("typed")).toHaveLength(2);
  });

  it("types the Contract price in its box", async () => {
    const user = setupUser();
    renderAt("/finance/opex/S00001");
    await screen.findByText(/Read from Odoo/);
    const box = screen.getByLabelText("Contract price");
    await user.clear(box);
    await user.type(box, "200000");
    await user.tab();
    expect(service.setReportField).toHaveBeenCalledWith("r1", "contract_price", 200000);
  });

  it("clears a typed retention by saving blank, not zero", async () => {
    const user = setupUser();
    service.getReport.mockResolvedValue(stored({ report: { retention: 0 } }));
    renderAt("/finance/opex/S00001");
    await screen.findByText(/Read from Odoo/);
    const box = screen.getByLabelText("Retention");
    await user.clear(box);
    await user.tab();
    expect(service.setReportField).toHaveBeenCalledWith("r1", "retention", null);
  });

  it("shows an edit that points at a line Odoo no longer has, and does not count it", async () => {
    service.getReport.mockResolvedValue(
      stored({ edits: { linePrices: [{ id: "p1", odoo_line_id: 777, unit_price: 100 }], leftOut: [{ id: "l1", analytic_line_id: 888, note: null }] } }),
    );
    renderAt("/finance/opex/S00001");
    const gone = await screen.findByRole("group", { name: "No longer in Odoo" });
    expect(within(gone).getAllByText(/no longer has this/)).toHaveLength(2);
    await vi.waitFor(() => expect(service.saveSnapshot).toHaveBeenCalled());
    expect(lastSnapshot().product_cost).toBe(1200);
    expect(lastSnapshot().operation_admin).toBe(300);
  });
});
