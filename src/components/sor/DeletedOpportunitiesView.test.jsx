import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/support";
import DeletedOpportunitiesView from "./DeletedOpportunitiesView";
import { opportunityService } from "../../services/opportunityService";

const ROW = {
  id: "opp-1",
  client_name: "Acme Corp",
  project_title: "CCTV Rollout",
  expected_value: 500000,
  sales_reference: "S01234",
  deal_owner_id: "owner-1",
  deleted_at: "2026-09-01T10:00:00.000Z",
  deleted_by_employee: { id: "deleter-1", name: "Cara Lim", avatar_path: null },
};

vi.mock("../../services/opportunityService", () => ({
  opportunityService: {
    getDeletedOpportunities: vi.fn(async () => [ROW]),
    restoreOpportunity: vi.fn(async () => ({ ...ROW, is_deleted: false })),
    purgeOpportunity: vi.fn(async () => ({ id: ROW.id })),
  },
}));

describe("DeletedOpportunitiesView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    opportunityService.getDeletedOpportunities.mockResolvedValue([ROW]);
  });

  it("lists a deleted SOR with who deleted it and when", async () => {
    renderWithProviders(<DeletedOpportunitiesView currentUserId="owner-1" isSuperAdmin={false} />);

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Cara Lim")).toBeInTheDocument();
  });

  it("shows an empty state when there is nothing deleted", async () => {
    opportunityService.getDeletedOpportunities.mockResolvedValue([]);

    renderWithProviders(<DeletedOpportunitiesView currentUserId="owner-1" isSuperAdmin={false} />);

    expect(await screen.findByText("Nothing deleted")).toBeInTheDocument();
  });

  it("offers Restore to the SOR's own Deal Owner, but not permanent delete", async () => {
    renderWithProviders(<DeletedOpportunitiesView currentUserId="owner-1" isSuperAdmin={false} />);

    await screen.findByText("Acme Corp");
    expect(screen.getByText("Restore")).toBeInTheDocument();
    expect(screen.queryByText("Delete forever")).not.toBeInTheDocument();
  });

  it("hides Restore from someone who is neither Super Admin nor the Deal Owner", async () => {
    renderWithProviders(<DeletedOpportunitiesView currentUserId="stranger-1" isSuperAdmin={false} />);

    await screen.findByText("Acme Corp");
    expect(screen.queryByText("Restore")).not.toBeInTheDocument();
  });

  it("offers both Restore and permanent delete to a Super Admin", async () => {
    renderWithProviders(<DeletedOpportunitiesView currentUserId="admin-1" isSuperAdmin={true} />);

    await screen.findByText("Acme Corp");
    expect(screen.getByText("Restore")).toBeInTheDocument();
    expect(screen.getByText("Delete forever")).toBeInTheDocument();
  });

  it("requires typing the Sales Reference before permanent delete confirms", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DeletedOpportunitiesView currentUserId="admin-1" isSuperAdmin={true} />);

    await screen.findByText("Acme Corp");
    await user.click(screen.getByText("Delete forever"));

    const confirmButtons = screen.getAllByText("Delete forever");
    const dialogConfirm = confirmButtons[confirmButtons.length - 1];
    expect(dialogConfirm).toBeDisabled();

    const input = screen.getByRole("textbox");
    await user.type(input, "S01234");
    expect(dialogConfirm).not.toBeDisabled();

    await user.click(dialogConfirm);

    await waitFor(() =>
      expect(opportunityService.purgeOpportunity).toHaveBeenCalledWith("opp-1", "S01234", "admin-1"),
    );
  });
});
