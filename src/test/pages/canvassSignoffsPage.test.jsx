import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import CanvassSignoffsPage from "@/pages/approvals/canvass-signoffs";
import { APPROVAL_QUEUES } from "@/pages/approvals/_components/useApprovalQueues";
import { renderWithProviders, setupUser } from "@/test/support";
import { stubRpc } from "@/test/msw/server";
import { db } from "@/test/db/store";
import { makeEmployee } from "@/test/factories";
import { getPermissionContext } from "@/utils/permissions";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current, isAuthLoading: false }),
}));

/**
 * The Approval Center's Canvass sign-off queue (#279): Canvasses with a winner and a reason that
 * nobody has signed, for the purchasing approver list (the Transmittal Check by list). Who may sign
 * and what the database lists is the policy tier's (92-canvass-signoff); this proves the screen
 * lists what it is given to a list member, shows nothing to anyone else, warns under three Offers
 * before confirming, and signs.
 */

const pending = (overrides = {}) => ({
  canvass_id: "11111111-aaaa-4aaa-8aaa-000000000001",
  number: "CNV_0142",
  component_id: "22222222-bbbb-4bbb-8bbb-000000000002",
  requested_item_id: null,
  subject_name: "Ambulance Folding Stretcher",
  reason: "Cheapest quote that meets the 227 kg load.",
  creator_id: "33333333-cccc-4ccc-8ccc-000000000003",
  creator_name: "Marco Dizon",
  opportunity_id: "44444444-dddd-4ddd-8ddd-000000000004",
  project_title: "Rescue vehicle for the city",
  client_name: "City Government",
  offer_count: 2,
  winner_brand: "Redleaf",
  winner_supplier: "Redleaf Inc.",
  waiting_since: "2026-10-14T01:00:00.000Z",
  ...overrides,
});

let approver;

function renderQueue() {
  return renderWithProviders(
    <MemoryRouter initialEntries={["/approvals/canvass-signoffs"]}>
      <Routes>
        <Route path="/approvals/canvass-signoffs" element={<CanvassSignoffsPage />} />
        <Route path="/approvals" element={<p>The Approval Center home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("the Canvass sign-off queue", () => {
  beforeEach(() => {
    approver = makeEmployee({ name: "Ana Reyes" });
    db.seed("ipas_signer_lists", { list_key: "transmittal_check_by", employee_id: approver.id });
    mockUser.current = { id: approver.id };
  });

  it("lists a ready, unsigned Canvass for a list member, with the winner and who canvassed it", async () => {
    stubRpc("canvass_pending_signoffs", [pending()]);
    renderQueue();

    const row = (await screen.findByText("Ambulance Folding Stretcher")).closest("tr");
    expect(within(row).getByText("CNV_0142")).toBeInTheDocument();
    expect(within(row).getByText(/Winner Redleaf Inc\. · Redleaf · 2 offers/)).toBeInTheDocument();
    expect(within(row).getByText("Marco Dizon")).toBeInTheDocument();
  });

  it("warns under three Offers before confirming, then signs", async () => {
    stubRpc("canvass_pending_signoffs", [pending()]);
    const sign = vi.fn(() => ({ canvass_id: pending().canvass_id, number: "CNV_0142", signed_off_at: "2026-10-18T01:00:00Z", offer_count: 2 }));
    stubRpc("canvass_sign", sign);
    const user = setupUser();
    renderQueue();

    await user.click(await screen.findByText("Ambulance Folding Stretcher"));

    expect(await screen.findByTestId("signoff-warning")).toHaveTextContent("Two offers only — below the three-offer minimum");
    expect(screen.getByTestId("signoff-reason")).toHaveTextContent("Cheapest quote that meets the 227 kg load.");
    expect(sign).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Sign off anyway" }));
    await waitFor(() => expect(sign).toHaveBeenCalled());
    expect(sign.mock.calls[0][0]).toEqual({ p_canvass_id: pending().canvass_id });
  });

  it("marks the Canvass signed wherever it is already cached, without a refresh", async () => {
    stubRpc("canvass_pending_signoffs", [pending({ offer_count: 3 })]);
    stubRpc("canvass_sign", () => ({ canvass_id: pending().canvass_id, number: "CNV_0142", signed_off_at: "2026-10-18T01:00:00Z", offer_count: 3 }));
    const user = setupUser();
    const { client } = renderQueue();
    // The same Canvass, as its Component's panel and its own record left it in the cache.
    const cached = { id: pending().canvass_id, number: "CNV_0142", signed_off_at: null, offers: [] };
    client.setQueryData(["canvass", "component", pending().component_id], cached);
    client.setQueryData(["canvass", "canvass", pending().canvass_id], cached);

    await user.click(await screen.findByText("Ambulance Folding Stretcher"));
    await user.click(await screen.findByRole("button", { name: "Sign off" }));

    await waitFor(() =>
      expect(client.getQueryData(["canvass", "component", pending().component_id])?.signed_off_at).toBe("2026-10-18T01:00:00Z"),
    );
    expect(client.getQueryData(["canvass", "canvass", pending().canvass_id]).signed_off_at).toBe("2026-10-18T01:00:00Z");
    expect(client.getQueryState(["canvass", "canvass", pending().canvass_id]).isInvalidated).toBe(true);
  });

  it("shows no warning at three Offers", async () => {
    stubRpc("canvass_pending_signoffs", [pending({ offer_count: 3 })]);
    const user = setupUser();
    renderQueue();

    await user.click(await screen.findByText("Ambulance Folding Stretcher"));

    expect(await screen.findByRole("button", { name: "Sign off" })).toBeInTheDocument();
    expect(screen.queryByTestId("signoff-warning")).not.toBeInTheDocument();
  });

  it("says plainly when nothing is waiting", async () => {
    stubRpc("canvass_pending_signoffs", []);
    renderQueue();
    expect(await screen.findByText("No Canvass is waiting for sign-off")).toBeInTheDocument();
  });

  it("sends anyone off the list, a Super Admin included, back to the Approval Center", async () => {
    stubRpc("canvass_pending_signoffs", [pending()]);
    const outsider = makeEmployee({ name: "Super Admin", is_super_admin: true });
    mockUser.current = { id: outsider.id, isSuperAdmin: true };
    renderQueue();

    expect(await screen.findByText("The Approval Center home")).toBeInTheDocument();
    expect(screen.queryByText("Ambulance Folding Stretcher")).not.toBeInTheDocument();
  });

  it("is a tab and a navigation entry for the Check by list only", () => {
    const tab = APPROVAL_QUEUES.find((q) => q.key === "canvass");
    expect(tab.path).toBe("/approvals/canvass-signoffs");
    expect(tab.can({ isCanvassApprover: true })).toBe(true);
    expect(tab.can({ isCanvassApprover: false, isSuperAdmin: true })).toBe(false);

    expect(getPermissionContext({ isTransmittalCheckBy: true }).isTransmittalCheckBy).toBe(true);
  });
});
