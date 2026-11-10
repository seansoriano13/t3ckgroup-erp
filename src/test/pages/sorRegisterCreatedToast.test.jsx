/**
 * Issue #888 — after Register SOR, the toast names the SOR by its sor_code
 * ("SOR-257 registered."), not the legacy opportunity_no (null now), and the
 * new SOR opens so the user lands on the deal they just made.
 */
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import toast from "react-hot-toast";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OpportunitiesPage from "@/pages/sors/index";
import { opportunityService } from "@/services/opportunityService";
import { renderWithProviders, setupUser } from "@/test/support";
import { makeEmployee } from "@/test/factories";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

// The form has its own suite. Here a button stands in for a filled-in form
// that submits, so the test drives the real register mutation.
vi.mock("@/components/sor/OpportunityFormModal", () => ({
  default: ({ isOpen, onSubmit, opportunity }) =>
    isOpen && !opportunity ? (
      <div role="dialog">
        <button type="button" onClick={() => onSubmit({ client_name: "Acme" })}>
          Submit new SOR
        </button>
      </div>
    ) : null,
}));

// The details modal has its own suite; here it only shows which SOR it opened.
vi.mock("@/components/sor/OpportunityDetailsModal", () => ({
  default: ({ isOpen, opportunity }) =>
    isOpen && opportunity ? <div role="dialog">Details for {opportunity.sor_code}</div> : null,
}));

vi.mock("@/components/sor/DeletedOpportunitiesView", () => ({
  default: () => <div>Deleted SORs body</div>,
}));

const CREATED = {
  id: "opp-new-257",
  sor_code: "SOR-257",
  opportunity_no: null,
  client_name: "Acme",
};

const renderRegister = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/sors"]}>
      <OpportunitiesPage />
    </MemoryRouter>,
  );

describe("SOR Register: toast and open after Register SOR", () => {
  beforeEach(() => {
    mockUser.current = { ...makeEmployee({ name: "Reg Ister" }), has_sales_flow: true };
    localStorage.clear();
    vi.clearAllMocks();
    vi.spyOn(opportunityService, "getOpportunities").mockResolvedValue([]);
    vi.spyOn(opportunityService, "createOpportunity").mockResolvedValue({ ...CREATED });
    vi.spyOn(opportunityService, "getOpportunityById").mockResolvedValue({ ...CREATED });
  });

  it("toasts the sor_code and opens the new SOR after Register", async () => {
    const user = setupUser();
    renderRegister();

    await user.click(await screen.findByRole("button", { name: /register sor/i }));
    await user.click(await screen.findByRole("button", { name: "Submit new SOR" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("SOR-257 registered."));
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/null/));
    expect(await screen.findByText("Details for SOR-257")).toBeInTheDocument();
    expect(opportunityService.getOpportunityById).toHaveBeenCalledWith("opp-new-257");
  });
});
