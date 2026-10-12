import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import GroupTasksPage from "@/pages/group-tasks/index.jsx";
import { renderWithProviders, setupUser } from "@/test/support";

const tasks = vi.hoisted(() => ({ current: [] }));

vi.mock("@/services/groupTaskService", () => ({
  groupTaskService: { getGroupTasks: vi.fn(async () => tasks.current) },
}));

vi.mock("@/services/employeeService", () => ({
  employeeService: { getAllEmployees: vi.fn(async () => []) },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-9", name: "Ana Reyes", is_head: false, is_hr: false, isSuperAdmin: false },
  }),
}));

describe("Group Tasks grid paging", () => {
  beforeEach(() => {
    localStorage.setItem("group_tasks_view_mode", "grid");
    tasks.current = Array.from({ length: 30 }, (_, i) => ({
      id: `g${i}`,
      title: `Grid task ${String(i).padStart(2, "0")}`,
      status: "ACTIVE",
      created_by: "user-1",
      creator: { name: "Head Ito" },
      created_at: `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      members: [],
    }));
  });

  it("pages the card grid with the same pager as the table view", async () => {
    const user = setupUser();
    renderWithProviders(
      <MemoryRouter>
        <GroupTasksPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getAllByText(/^Grid task /)).toHaveLength(25);

    await user.click(screen.getByRole("button", { name: /next page/i }));

    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getAllByText(/^Grid task /)).toHaveLength(5);
  });
});
