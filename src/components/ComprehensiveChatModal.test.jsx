import { useEffect, useRef } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
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
    renderWithProviders(
      <MemoryRouter>
        <ComprehensiveChatModal isOpen onClose={() => {}} />
      </MemoryRouter>,
    );
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

describe("ComprehensiveChatModal — address", () => {
  beforeEach(() => stubRpc("get_user_active_chats", [RPC_GROUP_ROW]));

  const Where = () => <output data-testid="where">{useLocation().search}</output>;
  const renderAt = (entry, isOpen = false) =>
    renderWithProviders(
      <MemoryRouter initialEntries={[entry]}>
        <ComprehensiveChatModal isOpen={isOpen} onClose={() => {}} />
        <Where />
      </MemoryRouter>,
    );

  it("opens the window on the chat the address names, and keeps the address", async () => {
    renderAt("/group-tasks?chat=group-task:gt-1");

    expect((await screen.findAllByText(/Site survey kickoff/)).length).toBeGreaterThan(0);
    expect(screen.getByTestId("where").textContent).toBe("?chat=group-task:gt-1");
  });

  it("writes the picked chat to the address", async () => {
    const user = setupUser();
    renderAt("/group-tasks?chat=inbox");

    await user.click(await screen.findByRole("button", { name: /Site survey kickoff/ }));

    await waitFor(() =>
      expect(screen.getByTestId("where").textContent).toBe("?chat=group-task:gt-1"),
    );
  });

  it("opened from the menu with no chat chosen, the address says inbox", async () => {
    renderAt("/tasks", true);

    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("?chat=inbox"));
  });

  it("clears the address on close", async () => {
    const user = setupUser();
    renderAt("/tasks?chat=inbox");

    await screen.findByText("Your Conversations");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(""));
  });

  it("Details keeps the record's address when the chat closes after it", async () => {
    const user = setupUser();
    // Stands in for GlobalDetailManager: it adds ?open= when asked to open a record.
    const Opener = () => {
      const navigate = useNavigate();
      const { search } = useLocation();
      const ref = useRef(search);
      ref.current = search;
      useEffect(() => {
        const onOpen = (e) => { 
          const next = new URLSearchParams(ref.current);
          next.set("open", `group-task:${e.detail.id}`);
          navigate({ search: `?${next}` });
        };
        window.addEventListener("OPEN_ENTITY_DETAILS", onOpen);
        return () => window.removeEventListener("OPEN_ENTITY_DETAILS", onOpen);
      }, [navigate]);
      return null;
    };
    renderWithProviders(
      <MemoryRouter initialEntries={["/group-tasks?chat=inbox"]}>
        <ComprehensiveChatModal isOpen onClose={() => {}} />
        <Opener />
        <Where />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: /Site survey kickoff/ }));
    await user.click(await screen.findByRole("button", { name: /Details/ }));

    // The chat closes about 300ms later and must remove only ?chat=.
    await waitFor(() => expect(screen.getByTestId("where").textContent).not.toContain("chat="), {
      timeout: 2000,
    });
    expect(screen.getByTestId("where").textContent).toContain("open=group-task");
  });
});
