import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GroupTaskTableView from "@/pages/group-tasks/_components/GroupTaskTableView";
import { renderWithProviders, setupUser } from "@/test/support";

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
    const user = setupUser();
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

  it("opens a row on Enter and exposes sort headers as buttons with aria-sort on the th", async () => {
    const user = setupUser();
    const onView = vi.fn();
    const taskItem = mockGroupTask({ id: "g1", title: "Keyboard Row" });

    renderWithProviders(
      <GroupTaskTableView tasks={[taskItem]} searchTerm="" onView={onView} />,
    );

    const row = screen.getByText("Keyboard Row").closest("tr");
    row.focus();
    await user.keyboard("{Enter}");
    expect(onView).toHaveBeenCalledWith(taskItem);

    const th = screen.getByRole("columnheader", { name: /Creator/ });
    expect(th).toHaveAttribute("aria-sort", "none");
    await user.click(within(th).getByRole("button"));
    expect(th).toHaveAttribute("aria-sort", "ascending");
  });

  it("renders empty state when no group tasks exist", () => {
    renderWithProviders(
      <GroupTaskTableView tasks={[]} searchTerm="" onView={vi.fn()} />,
    );

    expect(screen.getByText("No group tasks found")).toBeInTheDocument();
  });
});

describe("GroupTaskTableView paging", () => {
  it("pages through tasks with the shared pager", async () => {
    const user = setupUser();
    const tasks = Array.from({ length: 30 }, (_, i) =>
      mockGroupTask({
        id: `g${i}`,
        title: `Paged task ${String(i).padStart(2, "0")}`,
        created_at: `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      }),
    );

    renderWithProviders(<GroupTaskTableView tasks={tasks} searchTerm="" onView={vi.fn()} />);

    // Newest first: 29 down to 05 on page 1.
    expect(screen.getByText("Paged task 29")).toBeInTheDocument();
    expect(screen.queryByText("Paged task 04")).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /next page/i }));

    expect(screen.getByText("Paged task 04")).toBeInTheDocument();
    expect(screen.queryByText("Paged task 29")).not.toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });
});
