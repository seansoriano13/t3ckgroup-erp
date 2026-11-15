import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router";
import toast from "react-hot-toast";
import LeaveApprovalsPage from "@/pages/approvals/leaves/index.jsx";
import { renderWithProviders } from "@/test/support";

/**
 * #1015 / #1027: a notification's `?record=` is a row id or a leave group id,
 * and the queue's own key is `table:row:group`. A bare id finds its row; a key
 * that is not in the queue says so and clears the address.
 */

vi.mock("react-hot-toast", () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/ProtectedRoute", () => ({ default: ({ children }) => children }));
vi.mock("@/services/headApprovalService", () => ({ decideHeadApproval: vi.fn(async () => ({})) }));
vi.mock("@/pages/approvals/_components/useApprovalQueues", async (orig) => {
  const actual = await orig();
  const request = {
    id: "row-7",
    table: "sil_leaves",
    matchColumn: "leave_group_id",
    matchValue: "group-7",
    requestType: "SIL",
    date: "2026-10-01",
    created_at: new Date().toISOString(),
    reason: "Family trip",
    employee: { id: "emp-1", name: "Ana Cruz", department: "IT" },
  };
  return {
    ...actual,
    useApprovalQueues: () => ({
      roles: { user: { id: "head-1" }, isHr: false },
      leavesPending: [request],
      isLoadingLeaves: false,
      isErrorLeaves: false,
      refetchLeaves: vi.fn(),
    }),
  };
});

const Where = () => <output data-testid="where">{useLocation().search}</output>;
const renderAt = (entry) =>
  renderWithProviders(
    <MemoryRouter initialEntries={[entry]}>
      <LeaveApprovalsPage />
      <Where />
    </MemoryRouter>,
  );

describe("Leave approvals ?record=", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a bare leave group id opens the matching row, under the queue's key", async () => {
    renderAt("/approvals/leaves?record=group-7");

    await waitFor(() => expect(screen.getByTestId("where").textContent).toContain("sil_leaves"));
    expect(toast).not.toHaveBeenCalled();
  });

  it("a full key that is not in the queue says so and clears the address", async () => {
    renderAt("/approvals/leaves?record=sil_leaves:group-9:row-9");

    await waitFor(() => expect(toast).toHaveBeenCalledWith("This request is not waiting on you any more."));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(""));
  });
});
