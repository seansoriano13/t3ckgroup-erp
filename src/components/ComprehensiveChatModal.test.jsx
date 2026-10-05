import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, setupUser } from "../test/support";
import { stubRpc } from "../test/msw/server";
import ComprehensiveChatModal from "./ComprehensiveChatModal";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", name: "Alice" } }),
}));

// The database function names a group task's thread `COMMITTEE_TASK` (the
// table's old name); everything the thread opens — GlobalDetailManager, the
// message/receipt keys — speaks `GROUP_TASK`.
const RPC_GROUP_ROW = {
  entity_id: "gt-1",
  entity_type: "COMMITTEE_TASK",
  title: "Site survey kickoff",
  subtitle: "Committee Task",
  status: "CANCELLED",
  latest_message: "Group task was cancelled.",
  latest_author: "System",
  latest_created_at: "2026-07-14T08:00:00.000Z",
  last_read_at: null,
  is_unread: false,
  is_deleted: false,
  is_archived: false,
};

describe("ComprehensiveChatModal — group task thread", () => {
  const opened = vi.fn();
  const onOpen = (e) => opened(e.detail);

  beforeEach(() => {
    opened.mockClear();
    window.addEventListener("OPEN_ENTITY_DETAILS", onOpen);
    stubRpc("get_user_active_chats", [RPC_GROUP_ROW]);
  });

  afterEach(() => window.removeEventListener("OPEN_ENTITY_DETAILS", onOpen));

  async function openThread() {
    const user = setupUser();
    renderWithProviders(<ComprehensiveChatModal isOpen onClose={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /Site survey kickoff/ }));
    return user;
  }

  it("asks for the Group Task detail modal, the type GlobalDetailManager renders", async () => {
    const user = await openThread();

    await user.click(await screen.findByRole("button", { name: /Details/ }));

    expect(opened).toHaveBeenCalledWith({ id: "gt-1", type: "GROUP_TASK" });
  });

  it("labels the thread Group Task, not the old committee name", async () => {
    await openThread();

    // Sidebar row says Group Task; the header says it too, with the generic
    // "Overview" rather than the RPC's constant "Committee Task" subtitle.
    expect(await screen.findByText("Group Task")).toBeInTheDocument();
    expect(await screen.findByText(/Group Task\s*•\s*Overview/)).toBeInTheDocument();
    expect(screen.queryByText(/committee/i)).toBeNull();
  });
});
