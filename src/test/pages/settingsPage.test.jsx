import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigationType } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";
import SettingsPage from "@/pages/settings/index";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee, makeHrEmployee, makeSuperAdmin } from "@/test/factories";
import { appSettingsService } from "@/services/appSettingsService";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: mockUser.current,
    logout: vi.fn(),
  }),
}));

function LocationProbe() {
  const location = useLocation();
  const type = useNavigationType();
  return (
    <>
      <div data-testid="loc">{`${location.search}|${type}`}</div>
      <div data-testid="path">{location.pathname}</div>
    </>
  );
}

const renderAt = (url) =>
  renderWithProviders(
    <MemoryRouter initialEntries={[url]}>
      <SettingsPage />
      <LocationProbe />
    </MemoryRouter>,
  );

const tabNames = () => screen.getAllByRole("tab", { hidden: true }).map((t) => t.textContent);

// Issue #372: Settings is a tabbed workspace; tabs a person cannot use are
// absent, and an inactive tab mounts nothing (so issues no queries).
describe("SettingsPage", () => {
  beforeEach(() => {
    mockUser.current = null;
    vi.restoreAllMocks();
  });

  it("exposes the theme toggle as a switch", async () => {
    mockUser.current = makeSuperAdmin({ name: "Boss" });
    renderAt("/settings?tab=general");

    const sw = await screen.findByRole("switch", { name: "Theme mode", hidden: true });
    expect(sw).toHaveAttribute("aria-checked");
  });

  it("shows an employee only General, and bounces a forbidden tab without a history entry", async () => {
    mockUser.current = makeEmployee({ name: "Rank And File" });
    renderAt("/settings?tab=approvals");

    expect(await screen.findByText("App preferences")).toBeInTheDocument();
    expect(tabNames()).toEqual(["General"]);
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("?tab=general|REPLACE"));
    expect(screen.queryByText("Approval rules", { selector: "h2" })).not.toBeInTheDocument();
  });

  it("shows an HR Officer General, HR & Schedule and Venues, with no Working Week", async () => {
    mockUser.current = makeHrEmployee({ name: "Hr Officer" });
    renderAt("/settings?tab=hr");

    await screen.findByRole("tab", { name: "HR & Schedule", hidden: true });
    expect(tabNames()).toEqual(["General", "HR & Schedule", "Venues"]);
    expect(screen.queryByText(/working week/i)).not.toBeInTheDocument();
    expect(await screen.findByText("Leave categories")).toBeInTheDocument();
  });

  it("shows a Super Admin Leave Categories and Working Week together", async () => {
    mockUser.current = makeSuperAdmin({ name: "Root Access" });
    renderAt("/settings?tab=hr");

    expect(await screen.findByText("Leave categories")).toBeInTheDocument();
    expect(screen.getByText(/working week/i)).toBeInTheDocument();
  });

  it("shows Purchasing access General and Purchasing, with the option lists but no sign-off lists", async () => {
    mockUser.current = makeEmployee({ name: "Buyer", has_purchasing_flow: true });
    renderAt("/settings?tab=purchasing");

    expect(await screen.findByRole("tab", { name: "Payment methods", hidden: true })).toBeInTheDocument();
    expect(tabNames()).toEqual(expect.arrayContaining(["General", "Purchasing"]));
    expect(screen.queryByRole("tab", { name: "Approval Rules", hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Sign-off lists", hidden: true })).not.toBeInTheDocument();
  });

  it("shows a Super Admin all nine tabs, each on its own key", async () => {
    mockUser.current = makeSuperAdmin({ name: "Root Access" });
    renderAt("/settings");

    await screen.findByText("App preferences");
    expect(tabNames()).toEqual([
      "General",
      "Approval Rules",
      "HR & Schedule",
      "Venues",
      "Sales Configuration",
      "Purchasing",
      "S0 Evaluation",
      "Employee Groups",
      "System Announcements",
    ]);

    // Tab switches replace history (ui-audit F08) so Back leaves Settings.
    await setupUser().click(screen.getByRole("tab", { name: "Approval Rules", hidden: true }));
    expect(screen.getByTestId("loc")).toHaveTextContent("?tab=approvals|REPLACE");
    await waitFor(() => expect(screen.getByText("Ops Manager Marketing Approvals")).toBeInTheDocument());
    expect(screen.queryByText("App preferences")).not.toBeInTheDocument();

    await setupUser().click(screen.getByRole("tab", { name: "Sales Configuration", hidden: true }));
    expect(await screen.findByText("Lead sources")).toBeInTheDocument();
    expect(screen.getByText("Commission Pool")).toBeInTheDocument();

    await setupUser().click(screen.getByRole("tab", { name: "Purchasing", hidden: true }));
    expect(screen.getByTestId("loc")).toHaveTextContent("?tab=purchasing|REPLACE");
    expect(await screen.findByRole("tab", { name: "Sign-off lists", hidden: true })).toBeInTheDocument();
  });

  it("issues no settings request until the Approval Rules tab opens", async () => {
    mockUser.current = makeSuperAdmin({ name: "Root Access" });
    const spy = vi.spyOn(appSettingsService, "getAppSettings");
    renderAt("/settings");

    await screen.findByText("App preferences");
    expect(spy).not.toHaveBeenCalled();

    await setupUser().click(screen.getByRole("tab", { name: "Approval Rules", hidden: true }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });

  it("shows the FAQ Editor entry only to a person the FAQ capability names", async () => {
    mockUser.current = makeEmployee({ id: "101", name: "Named Editor" });
    renderAt("/settings");

    expect(await screen.findByText("FAQ Editor")).toBeInTheDocument();
  });

  it("keeps Help & FAQ in the header on every tab, and the build fingerprint on General only", async () => {
    mockUser.current = makeSuperAdmin({ name: "Root Access" });
    const user = setupUser();
    renderAt("/settings");
    await screen.findByText("App preferences");

    for (const name of tabNames()) {
      await user.click(screen.getByRole("tab", { name, hidden: true }));
      expect(screen.getByRole("button", { name: "Help & FAQ", hidden: true })).toBeInTheDocument();
      // The test build is not a git SHA, so the fingerprint reads "dev".
      expect(screen.queryAllByText("dev", { exact: true })).toHaveLength(name === "General" ? 1 : 0);
    }
  });

  it("opens Commission Pool from the keyboard", async () => {
    mockUser.current = makeSuperAdmin({ name: "Root Access" });
    const user = setupUser();
    renderAt("/settings?tab=sales");

    const card = await screen.findByRole("link", { name: /Commission Pool/, hidden: true });
    card.focus();
    expect(card).toHaveFocus();
    // The Commission Formula is the Commission Dashboard's Formula tab now.
    expect(card).toHaveAttribute("href", "/sors/commission?tab=formula");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/sors/commission"));
  });
});
