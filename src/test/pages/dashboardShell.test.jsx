/**
 * Issue #440 — the Dashboard and Retail are Report-type Pages on PageShell:
 * the time range sits in the header, no gradient summary cards remain, and the
 * Dashboard's greeting banner (personalised from the Profile) sits above the
 * standard layout.
 */
import { screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "@/pages/index";
import RetailPage from "@/pages/retail/index";
import { renderWithProviders } from "@/test/support";
import { makeEmployee } from "@/test/factories";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

const headerOf = (heading) => heading.closest("div.border-b");
const noGradient = (container) =>
  expect(container.innerHTML).not.toMatch(/bg-linear|bg-gradient|\bfrom-|blur-/);

describe("Dashboard on PageShell", () => {
  beforeEach(() => {
    mockUser.current = {
      ...makeEmployee({ name: "Dana Reyes" }),
      dashboardQuote: "Steady wins.",
    };
  });

  const renderDashboard = () =>
    renderWithProviders(
      <MemoryRouter initialEntries={["/"]}>
        <Dashboard />
      </MemoryRouter>,
    );

  it("keeps the greeting banner, personalised from the Profile, above the page header", async () => {
    renderDashboard();

    const greeting = await screen.findByText("Hi Dana,");
    expect(screen.getByText("Steady wins.")).toBeInTheDocument();
    const heading = screen.getByRole("heading", { name: /Private\s*Workflow/ });
    expect(
      Boolean(greeting.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it("puts the time range in the header, inline rather than floating", async () => {
    const { container } = renderDashboard();

    const header = headerOf(await screen.findByRole("heading", { name: /Private\s*Workflow/ }));
    expect(within(header).getByText("Month")).toBeInTheDocument();
    expect(container.ownerDocument.querySelector(".fixed")).toBeNull();
    noGradient(container);
  });
});

describe("Retail on PageShell", () => {
  it("puts the time range in the header and shows no gradient cards", async () => {
    mockUser.current = makeEmployee({ name: "Sean", is_super_admin: true });
    const { container } = renderWithProviders(
      <MemoryRouter initialEntries={["/retail"]}>
        <RetailPage />
      </MemoryRouter>,
    );

    const header = headerOf(await screen.findByRole("heading", { name: /Retail/ }));
    expect(within(header).getByRole("tab", { name: "3 months" })).toBeInTheDocument();
    expect(await screen.findByText("Total sales", {}, { timeout: 5000 })).toBeInTheDocument();
    noGradient(container);
  });
});
