import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import GroupTaskTableView from "@/pages/group-tasks/_components/GroupTaskTableView";
import { renderWithProviders } from "@/test/support";

const mockGroupTask = (overrides = {}) => ({
  id: "gt-1",
  title: "Q1 Server Migration",
  description: "Migrate legacy servers to AWS cloud infrastructure",
  status: "ACTIVE",
  created_by: "emp-1",
  creator: { name: "Head Ito" },
  due_date: "2026-04-15T00:00:00Z",
  created_at: "2026-03-01T00:00:00Z",
  members: [
    { employee_id: "emp-1", employee: { name: "Head Ito" }, status: "DONE" },
    { employee_id: "emp-2", employee: { name: "Ana Reyes" }, status: "PENDING" },
  ],
  ...overrides,
});

describe("GroupTaskTableView", () => {
  it("renders group tasks with titles, creators, progress, and status", () => {
    const onView = vi.fn();
    const tasks = [
      mockGroupTask({ id: "g1", title: "Q1 Server Migration" }),
      mockGroupTask({
        id: "g2",
        title: "Annual Compliance Audit",
        status: "COMPLETED",
        members: [
          { employee_id: "emp-1", employee: { name: "Head Ito" }, status: "DONE" },
          { employee_id: "emp-2", employee: { name: "Ana Reyes" }, status: "DONE" },
        ],
      }),
    ];

    renderWithProviders(
      <GroupTaskTableView tasks={tasks} searchTerm="" onView={onView} />,
    );

    expect(screen.getByText("Q1 Server Migration")).toBeInTheDocument();
    expect(screen.getByText("Annual Compliance Audit")).toBeInTheDocument();
    expect(screen.getAllByText("Head Ito").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();
  });

  it("calls onView when a table row is clicked", async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    const taskItem = mockGroupTask({ id: "g1", title: "Office Relocation Plan" });

    renderWithProviders(
      <GroupTaskTableView tasks={[taskItem]} searchTerm="" onView={onView} />,
    );

    const titleElement = screen.getByText("Office Relocation Plan");
    await user.click(titleElement);

    expect(onView).toHaveBeenCalledTimes(1);
    expect(onView).toHaveBeenCalledWith(taskItem);
  });

  it("renders empty state when no group tasks exist", () => {
    renderWithProviders(
      <GroupTaskTableView tasks={[]} searchTerm="" onView={vi.fn()} />,
    );

    expect(screen.getByText("No Group Tasks Found")).toBeInTheDocument();
  });
});
