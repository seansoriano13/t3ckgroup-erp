import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TaskTableView from "./TaskTableView";
import { renderWithProviders, setupUser } from "@/test/support";

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}));

const mockTask = (overrides = {}) => ({
  id: "task-1",
  taskDescription: "Fix network router in main server room",
  projectTitle: "Network Infrastructure Maintenance",
  categoryId: "IT-01",
  categoryName: "IT Support",
  loggedById: "emp-1",
  loggedByName: "Ana Reyes",
  department: "IT",
  status: "INCOMPLETE",
  priority: "HIGH",
  hrVerified: false,
  checklist: null,
  startAt: "2026-03-05T02:00:00Z",
  endAt: "2026-03-10T02:00:00Z",
  createdAt: "2026-03-05T02:00:00Z",
  ...overrides,
});

const owner = { id: "emp-1", name: "Ana Reyes" };

describe("TaskTableView", () => {
  it("renders tasks correctly with titles, categories, assignees, badges, and priority", () => {
    mockUser.current = owner;
    const onView = vi.fn();
    const tasks = [
      mockTask({ id: "t1", projectTitle: "Server Upgrade", priority: "HIGH" }),
      mockTask({ id: "t2", projectTitle: "Client Onboarding", priority: "LOW", status: "COMPLETED", hrVerified: true }),
    ];

    renderWithProviders(
      <TaskTableView tasks={tasks} searchTerm="" onView={onView} />,
    );

    expect(screen.getByText("Server Upgrade")).toBeInTheDocument();
    expect(screen.getByText("Client Onboarding")).toBeInTheDocument();
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("LOW")).toBeInTheDocument();
  });

  it("calls onView when a table row is clicked", async () => {
    const user = setupUser();
    mockUser.current = owner;
    const onView = vi.fn();
    const taskItem = mockTask({ id: "t1", projectTitle: "Inspect Firewall" });

    renderWithProviders(
      <TaskTableView tasks={[taskItem]} searchTerm="" onView={onView} />,
    );

    const titleElement = screen.getByText("Inspect Firewall");
    await user.click(titleElement);

    expect(onView).toHaveBeenCalledTimes(1);
    expect(onView).toHaveBeenCalledWith(taskItem);
  });

  it("renders empty state when task list is empty", () => {
    renderWithProviders(
      <TaskTableView tasks={[]} searchTerm="" onView={vi.fn()} />,
    );

    expect(screen.getByText("No tasks found.")).toBeInTheDocument();
  });

  it("renders checklist progress correctly", () => {
    const checklistTask = mockTask({
      id: "t-check",
      projectTitle: "Checklist Project",
      checklist: JSON.stringify([
        { text: "Item 1", checked: true },
        { text: "Item 2", checked: false },
        { text: "Item 3", checked: true },
      ]),
    });

    renderWithProviders(
      <TaskTableView tasks={[checklistTask]} searchTerm="" onView={vi.fn()} />,
    );

    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("renders grouped checklist progress with step indicator", () => {
    const groupedTask = mockTask({
      id: "t-grouped",
      projectTitle: "Multi-Step Project",
      checklist: [
        { id: "g1", title: "Step 1", items: [{ text: "Item 1", checked: true }] },
        { id: "g2", title: "Step 2", items: [{ text: "Item 2", checked: false }] },
      ],
    });

    renderWithProviders(
      <TaskTableView tasks={[groupedTask]} searchTerm="" onView={vi.fn()} />,
    );

    expect(screen.getByText(/S2\s*·\s*1\/2/)).toBeInTheDocument();
  });
});
