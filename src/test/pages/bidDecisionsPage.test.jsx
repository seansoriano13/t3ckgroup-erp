import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import BidDecisionsPage from "@/pages/approvals/bid-decisions";
import { APPROVAL_QUEUES } from "@/pages/approvals/_components/useApprovalQueues";
import { renderWithProviders, setupUser } from "@/test/support";
import { stubRpc } from "@/test/msw/server";
import { getPermissionContext } from "@/utils/permissions";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

/**
 * The Approval Center's Bid Decisions queue (#320): Costing Matrices whose Final Offers are all set
 * and that have no live Bid Decision, for the Final Acquire list and Super Admins. Who may decide
 * and what the database lists is the policy tier's (85-costing-bid-decision); this proves the
 * screen lists what it is given, shows nothing to anyone else, and opens the SOR.
 */

const pending = {
  matrix_id: "11111111-aaaa-4aaa-8aaa-000000000001",
  opportunity_id: "22222222-bbbb-4bbb-8bbb-000000000002",
  project_title: "Rescue vehicle for the city",
  client_name: "City Government",
  deal_owner_id: "33333333-cccc-4ccc-8ccc-000000000003",
  deal_owner_name: "Dee Owner",
  final_offer_total: "2980000.00",
  abc_total: "3200000.00",
  waiting_since: "2026-10-14T01:00:00.000Z",
};

function renderQueue() {
  return renderWithProviders(
    <MemoryRouter initialEntries={["/approvals/bid-decisions"]}>
      <Routes>
        <Route path="/approvals/bid-decisions" element={<BidDecisionsPage />} />
        <Route path="/approvals" element={<p>The Approval Center home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("the Bid Decisions queue", () => {
  beforeEach(() => {
    mockUser.current = { id: "44444444-dddd-4ddd-8ddd-000000000004", isFinalAcquire: true };
  });

  it("lists a pending decision for the Final Acquire list with the figures and the Deal Owner", async () => {
    stubRpc("costing_pending_bid_decisions", [pending]);
    renderQueue();

    const row = (await screen.findByText("Rescue vehicle for the city")).closest("tr");
    expect(within(row).getByText(/Final Offer ₱2,980,000\.00 · ABC ₱3,200,000\.00/)).toBeInTheDocument();
    expect(within(row).getByText("Dee Owner")).toBeInTheDocument();
    expect(within(row).getByText("City Government")).toBeInTheDocument();
    expect(within(row).getByText(/BID-/)).toBeInTheDocument();
  });

  it("opens the SOR when a row is clicked", async () => {
    stubRpc("costing_pending_bid_decisions", [pending]);
    const opened = vi.fn();
    window.addEventListener("OPEN_ENTITY_DETAILS", opened);
    const user = setupUser();
    renderQueue();

    await user.click(await screen.findByText("Rescue vehicle for the city"));

    await waitFor(() => expect(opened).toHaveBeenCalled());
    expect(opened.mock.calls[0][0].detail).toEqual({ id: pending.opportunity_id, type: "OPPORTUNITY" });
    window.removeEventListener("OPEN_ENTITY_DETAILS", opened);
  });

  it("says plainly when nothing is waiting", async () => {
    stubRpc("costing_pending_bid_decisions", []);
    renderQueue();

    expect(await screen.findByText("No bid is waiting for a decision")).toBeInTheDocument();
  });

  it("lets a Super Admin in, and sends anyone else back to the Approval Center", async () => {
    stubRpc("costing_pending_bid_decisions", [pending]);
    mockUser.current = { id: "55555555-eeee-4eee-8eee-000000000005", isSuperAdmin: true };
    const first = renderQueue();
    expect(await screen.findByText("Rescue vehicle for the city")).toBeInTheDocument();
    first.unmount();

    mockUser.current = { id: "66666666-ffff-4fff-8fff-000000000006", isHead: true };
    renderQueue();
    expect(await screen.findByText("The Approval Center home")).toBeInTheDocument();
    expect(screen.queryByText("Rescue vehicle for the city")).not.toBeInTheDocument();
  });

  it("is a tab and a navigation entry for the deciders only", () => {
    const tab = APPROVAL_QUEUES.find((q) => q.key === "bidDecisions");
    expect(tab.path).toBe("/approvals/bid-decisions");
    expect(tab.can({ isBidDecider: true })).toBe(true);
    expect(tab.can({ isBidDecider: false })).toBe(false);

    expect(getPermissionContext({ isFinalAcquire: true }).isBidDecider).toBe(true);
    expect(getPermissionContext({ isSuperAdmin: true }).isBidDecider).toBe(true);
    // Purchasing, or on a Deal Team: the database lists only their own SORs.
    expect(getPermissionContext({ isCostingOpen: true }).isBidDecider).toBe(true);
    expect(getPermissionContext({ isHead: true }).isBidDecider).toBe(false);
  });
});
