/**
 * Issue #437 — the SOR Register is a Register-type Page on PageShell, full-width.
 * The display toggle (List / Board / Overview / Deleted) and the one main
 * action ("Register SOR") sit in the header; nothing floats.
 */
import { screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OpportunitiesPage from "@/pages/sors/index";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

// The modal has its own suite; here it only has to say whether it opened.
vi.mock("@/components/sor/OpportunityFormModal", () => ({
  default: ({ isOpen, opportunity }) =>
    isOpen && !opportunity ? <div role="dialog">Register SOR form</div> : null,
}));

vi.mock("@/components/sor/DeletedOpportunitiesView", () => ({
  default: () => <div>Deleted SORs body</div>,
}));

const renderRegister = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/sors"]}>
      <OpportunitiesPage />
    </MemoryRouter>,
  );

describe("SOR Register on PageShell", () => {
  beforeEach(() => {
    mockUser.current = makeEmployee({ name: "Reg Ister" });
    sessionStorage.clear();
  });

  it("renders through PageShell, full-width", async () => {
    renderRegister();

    const body = await screen.findByTestId("page-body");
    const frame = body.parentElement;
    expect(frame.className).toContain("max-w-full");
    expect(screen.getByRole("heading", { name: /SOR\s*Register/ })).toBeInTheDocument();
  });

  it("puts Register SOR in the header as the standard button, not floating", async () => {
    const user = setupUser();
    renderRegister();

    const header = (await screen.findByRole("heading", { name: /SOR\s*Register/ })).closest(
      "div.border-b",
    );
    const button = within(header).getByRole("button", { name: /register sor/i });
    expect(button.className).toContain("h-8");
    expect(document.querySelector(".fixed")).toBeNull();

    await user.click(button);
    expect(await screen.findByText("Register SOR form")).toBeInTheDocument();
  });

  it("keeps the display toggle in the header and switches to Deleted", async () => {
    const user = setupUser();
    renderRegister();

    const header = (await screen.findByRole("heading", { name: /SOR\s*Register/ })).closest(
      "div.border-b",
    );
    expect(within(header).getByRole("tab", { name: /^List/i, selected: true })).toBeInTheDocument();
    expect(within(header).getByRole("tab", { name: /^Board/i })).toBeInTheDocument();
    expect(within(header).getByRole("tab", { name: /^Overview/i })).toBeInTheDocument();

    await user.click(within(header).getByRole("tab", { name: /^Deleted/i }));
    expect(await screen.findByText("Deleted SORs body")).toBeInTheDocument();
  });

  it("draws the one-line filter row in the toolbar slot on List, and drops it on Deleted", async () => {
    const user = setupUser();
    renderRegister();

    const toolbar = await screen.findByTestId("page-toolbar");
    expect(within(toolbar).getByPlaceholderText(/search number/i)).toBeInTheDocument();
    expect(within(toolbar).getByText("Filters")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Deleted/i }));
    expect(screen.queryByTestId("page-toolbar")).toBeNull();
  });
});
