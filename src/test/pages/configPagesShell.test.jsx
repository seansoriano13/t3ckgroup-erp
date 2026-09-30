import { screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/pages/settings/index";
import ProfilePage from "@/pages/profile/index";
import EmployeeManagement from "@/pages/hr/management/index";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee, makeHrEmployee, makeSuperAdmin } from "@/test/factories";

/**
 * Issue #442 — Settings, Profile and HR Management's configuration tabs are
 * Config-type Pages on PageShell: a narrow centred column, underlined level-1
 * tabs, Sentence-case section headings (uppercase tracked labels are for field
 * names only) and the Page's one main action in the header.
 */

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: mockUser.current,
    isAuthLoading: false,
    logout: vi.fn(),
    updateUserPreferences: vi.fn(),
  }),
}));

const headerOf = (heading) => heading.closest("div.border-b");
const shoutingHeadings = (root) => [...root.querySelectorAll("h2.uppercase, h3.uppercase")].map((h) => h.textContent);
const narrowColumn = () => screen.getByTestId("page-body").parentElement;

const renderSettings = (url) =>
  renderWithProviders(
    <MemoryRouter initialEntries={[url]}>
      <SettingsPage />
    </MemoryRouter>,
  );

describe("Settings on PageShell", () => {
  beforeEach(() => {
    mockUser.current = makeSuperAdmin({ name: "Root Access" });
  });

  it("renders as a narrow centred column with Help & FAQ in the header", async () => {
    renderSettings("/settings");

    const heading = await screen.findByRole("heading", { level: 1, hidden: true, name: /Settings/ });
    expect(within(headerOf(heading)).getByRole("button", { name: "Help & FAQ", hidden: true })).toBeInTheDocument();
    expect(narrowColumn()).toHaveClass("max-w-4xl", "mx-auto");
  });

  it("switches sections with underlined level-1 tabs, not pills", async () => {
    renderSettings("/settings");

    const general = await screen.findByRole("tab", { name: "General", hidden: true });
    expect(general).toHaveAttribute("aria-selected", "true");
    expect(general.className).toContain("border-b-2");
    expect(screen.getByRole("tablist", { hidden: true })).toHaveClass("border-b");
    expect(screen.getByRole("tablist", { hidden: true })).not.toHaveClass("bg-muted");
  });

  it("titles every section in Sentence case on every tab", async () => {
    const user = setupUser();
    const { container } = renderSettings("/settings");
    expect(await screen.findByRole("heading", { level: 2, hidden: true, name: "App preferences" })).toBeInTheDocument();

    const tabs = screen.getAllByRole("tab", { hidden: true }).map((t) => t.textContent);
    for (const name of tabs) {
      await user.click(screen.getByRole("tab", { name, hidden: true }));
      await waitFor(() => expect(screen.getByRole("tab", { name, hidden: true })).toHaveAttribute("aria-selected", "true"));
      // Let the tab's panel settle before reading its headings.
      await screen.findAllByRole("heading", { level: 2, hidden: true });
      expect(shoutingHeadings(container), `tab ${name}`).toEqual([]);
    }

    await user.click(screen.getByRole("tab", { name: "Approval Rules", hidden: true }));
    expect(await screen.findByRole("heading", { level: 2, hidden: true, name: "Approval rules" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Employee Groups", hidden: true }));
    expect(await screen.findByRole("heading", { level: 2, hidden: true, name: "Employee groups" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "System Announcements", hidden: true }));
    expect(await screen.findByRole("heading", { level: 2, hidden: true, name: "System announcements" })).toBeInTheDocument();
  });

  it("titles the HR and Sales sections in Sentence case", async () => {
    renderSettings("/settings?tab=hr");
    expect(await screen.findByRole("heading", { level: 2, hidden: true, name: "Leave categories" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 2, hidden: true, name: "Working week" })).toBeInTheDocument();
  });
});

describe("Profile on PageShell", () => {
  beforeEach(() => {
    mockUser.current = {
      ...makeEmployee({ name: "Dana Reyes" }),
      dashboardQuote: "Steady wins.",
    };
  });

  const renderProfile = () =>
    renderWithProviders(
      <MemoryRouter initialEntries={["/profile"]}>
        <ProfilePage />
      </MemoryRouter>,
    );

  it("puts Save settings in the header as the standard button, off until something changes", async () => {
    renderProfile();

    const heading = await screen.findByRole("heading", { level: 1, name: /My\s*Profile/ });
    const save = within(headerOf(heading)).getByRole("button", { name: "Save settings" });
    expect(save).toBeDisabled();
    expect(save.className).not.toMatch(/uppercase|rounded-full|tracking-widest|h-auto/);

    await setupUser().type(screen.getByPlaceholderText(/7-word motivational quote/i), " more");
    expect(save).toBeEnabled();
  });

  it("renders in a narrow centred column with Sentence-case section headings", async () => {
    const { container } = renderProfile();
    await screen.findByRole("heading", { level: 1, name: /My\s*Profile/ });

    expect(narrowColumn()).toHaveClass("max-w-4xl", "mx-auto");
    expect(screen.getByRole("heading", { name: "Organizational details" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Signature" })).toBeInTheDocument();
    for (const title of ["Live preview", "Profile photo", "Dashboard banner", "Motivational quote"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(shoutingHeadings(container)).toEqual([]);
  });
});

describe("HR Management configuration tabs on PageShell", () => {
  beforeEach(() => {
    mockUser.current = makeHrEmployee({ name: "HR Admin" });
  });

  const renderHr = () =>
    renderWithProviders(
      <MemoryRouter initialEntries={["/hr/management"]}>
        <EmployeeManagement />
      </MemoryRouter>,
    );

  it("keeps the Employees register wide and the configuration tabs a narrow column", async () => {
    const user = setupUser();
    renderHr();

    await screen.findByRole("button", { name: /add employee/i });
    expect(narrowColumn()).toHaveClass("max-w-7xl");

    await user.click(screen.getByRole("tab", { name: "Categories Config" }));
    expect(narrowColumn()).toHaveClass("max-w-4xl", "mx-auto");
    await user.click(screen.getByRole("tab", { name: /Leave & Form Config/ }));
    expect(narrowColumn()).toHaveClass("max-w-4xl", "mx-auto");
  });

  it("offers Add Employee only where employees are listed", async () => {
    const user = setupUser();
    renderHr();
    await screen.findByRole("button", { name: /add employee/i });

    await user.click(screen.getByRole("tab", { name: "Categories Config" }));
    expect(screen.queryByRole("button", { name: /add employee/i })).not.toBeInTheDocument();
    // The category tab keeps its own Add Category action.
    expect(await screen.findByRole("button", { name: /add category/i })).toBeInTheDocument();
  });

  it("titles the leave configuration section in Sentence case", async () => {
    const user = setupUser();
    const { container } = renderHr();
    await user.click(await screen.findByRole("tab", { name: /Leave & Form Config/ }));

    expect(await screen.findByRole("heading", { level: 2, name: "Leave categories" })).toBeInTheDocument();
    expect(shoutingHeadings(container)).toEqual([]);
  });
});
