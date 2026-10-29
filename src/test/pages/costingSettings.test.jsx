import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";
import SettingsPage from "@/pages/settings/index";
import { renderWithProviders, setupUser } from "@/test/support";
import { db } from "@/test/db/store";
import { makeEmployee, makeSuperAdmin } from "@/test/factories";

const mockUser = vi.hoisted(() => ({ current: null }));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("react-hot-toast", async (importOriginal) => {
  const actual = await importOriginal();
  const toast = Object.assign((...args) => actual.default(...args), actual.default, { error: toastError });
  return { ...actual, default: toast };
});

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, logout: vi.fn() }),
}));

const renderCosting = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/settings?tab=costing"]}>
      <SettingsPage />
    </MemoryRouter>,
  );

const tabNames = () => screen.getAllByRole("tab", { hidden: true }).map((t) => t.textContent);

/**
 * The Costing Matrix tab of Settings (#270): the rates Finance access and Super Admins change, and
 * the Final Acquire list Super Admins keep. The database holds who may write either; the policy
 * tier (81-costing-summary-final-acquire) proves that. This is what the screen offers each person.
 */
describe("S0 Evaluation settings", () => {
  beforeEach(() => {
    mockUser.current = null;
    toastError.mockClear();
    db.seed("costing_settings", { id: 1 });
  });

  it("shows Finance access the Rates and nothing else", async () => {
    mockUser.current = makeEmployee({ name: "Finance Person", has_finance_flow: true });
    renderCosting();

    const rates = await screen.findByTestId("costing-rates");
    expect(tabNames()).toEqual(["General", "S0 Evaluation"]);
    expect(within(rates).getByLabelText("VAT divisor")).toHaveValue("1.12");
    expect(within(rates).getByLabelText("Tax rate (%)")).toHaveValue("6");
    expect(within(rates).getByLabelText("Retention rate (%)")).toHaveValue("1");
    expect(within(rates).getByLabelText("ITR rate (%)")).toHaveValue("8");
    expect(within(rates).getByLabelText("ITR allowance (₱)")).toHaveValue("250000");
    expect(screen.queryByTestId("costing-signer-list-final_acquire")).not.toBeInTheDocument();
    // The markup presets are not Finance access's: for them the tab holds the Rates and nothing else.
    expect(screen.queryByTestId("markup-presets")).not.toBeInTheDocument();
    expect(screen.queryByTestId("markup-presets-closed")).not.toBeInTheDocument();
  });

  it("saves a changed rate for Finance access", async () => {
    mockUser.current = makeEmployee({ name: "Finance Person", has_finance_flow: true });
    renderCosting();
    const user = setupUser();

    const rates = await screen.findByTestId("costing-rates");
    const tax = within(rates).getByLabelText("Tax rate (%)");
    await user.clear(tax);
    await user.type(tax, "5");
    await user.click(within(rates).getByRole("button", { name: "Save rates" }));

    await waitFor(() => expect(Number(db.rows("costing_settings")[0].tax_rate)).toBe(0.05));
    expect(Number(db.rows("costing_settings")[0].vat_divisor)).toBe(1.12);
  });

  it("does not save a rate that is not a percentage", async () => {
    mockUser.current = makeEmployee({ name: "Finance Person", has_finance_flow: true });
    renderCosting();
    const user = setupUser();

    const rates = await screen.findByTestId("costing-rates");
    const tax = within(rates).getByLabelText("Tax rate (%)");
    await user.clear(tax);
    await user.type(tax, "150");
    await user.click(within(rates).getByRole("button", { name: "Save rates" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("The tax rate is a percentage from 0 to 100."));
    expect(Number(db.rows("costing_settings")[0].tax_rate)).toBe(0.06);
  });

  it("shows a Super Admin the Rates and the Final Acquire list, with who is on it", async () => {
    const manager = makeEmployee({ name: "Manager One" });
    db.seed("costing_signer_lists", { list_key: "final_acquire", employee_id: manager.id });
    mockUser.current = makeSuperAdmin({ name: "Root Access" });
    renderCosting();

    expect(await screen.findByTestId("costing-rates")).toBeInTheDocument();
    const list = await screen.findByTestId("costing-signer-list-final_acquire");
    expect(within(list).getByText("Decider list")).toBeInTheDocument();
    expect(await within(list).findByText("Manager One")).toBeInTheDocument();
    expect(within(list).queryByText("Nobody yet.")).not.toBeInTheDocument();
  });

  it("offers a plain employee no S0 Evaluation tab", async () => {
    mockUser.current = makeEmployee({ name: "Rank And File" });
    renderCosting();

    await screen.findByText("App preferences");
    expect(tabNames()).toEqual(["General"]);
    expect(screen.queryByTestId("costing-rates")).not.toBeInTheDocument();
  });
});
