import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, setupUser } from "../../test/support";
import ArchivedOpportunitiesView from "./ArchivedOpportunitiesView";
import { opportunityService } from "../../services/opportunityService";

vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const ROW = {
  id: "opp-1",
  client_name: "Acme Corp",
  project_title: "CCTV Rollout",
  expected_value: 500000,
  sales_reference: "S01234",
  archived_at: "2026-11-24T01:00:00.000Z",
};

vi.mock("../../services/opportunityService", () => ({
  opportunityService: {
    getArchivedOpportunities: vi.fn(async () => [ROW]),
    setArchived: vi.fn(async () => ({})),
  },
}));

describe("ArchivedOpportunitiesView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists an archived SOR and lets a Super Admin un-archive it", async () => {
    renderWithProviders(<ArchivedOpportunitiesView isSuperAdmin />);
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    await setupUser().click(screen.getByRole("button", { name: /un-archive/i }));
    await waitFor(() => expect(opportunityService.setArchived).toHaveBeenCalledWith("opp-1", false));
  });

  it("offers nobody else an un-archive button, but the SOR still opens", async () => {
    renderWithProviders(<ArchivedOpportunitiesView isSuperAdmin={false} />);
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /un-archive/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });
});
