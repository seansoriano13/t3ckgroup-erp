import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders, setupUser } from "../support";
import SuperAdminActivityLogPage from "../../pages/super-admin/activity-log/index";

const MOCK_SOR_LOG = {
  id: "log-1",
  taskId: "opp-123",
  taskDescription: "[OPPORTUNITY]",
  taskStatus: null,
  type: "SYSTEM",
  content: "Sales opportunity S0001 details updated: Stage changed from LEAD to MEETING",
  metadata: { event: "OPPORTUNITY_STAGE_CHANGED" },
  createdAt: "2026-08-20T10:00:00Z",
  authorId: "user-1",
  authorName: "Alice",
  entityType: "OPPORTUNITY",
  entityId: "opp-123",
  isSystemLog: true,
};

const MOCK_SYSTEM_OPP_LOG = {
  id: "log-2",
  taskId: "opp-456",
  taskDescription: "[OPPORTUNITY]",
  taskStatus: null,
  type: "SYSTEM",
  content: "Sales opportunity S0002 registered for Beta Inc (₱100,000.00).",
  metadata: { event: "OPPORTUNITY_REGISTERED" },
  createdAt: "2026-08-20T11:00:00Z",
  authorId: "user-2",
  authorName: "Bob",
  entityType: "OPPORTUNITY",
  entityId: "opp-456",
  isSystemLog: true,
};

const MOCK_CHECKLIST_TASK_LOG = {
  id: "log-checklist-1",
  taskId: "task-789",
  taskDescription: JSON.stringify([
    { text: "Confirm site survey", checked: false },
    { text: "Send quotation", checked: true },
  ]),
  taskStatus: "IN_PROGRESS",
  type: "TASK",
  content: "Checklist updated",
  metadata: {},
  createdAt: "2026-08-20T09:00:00Z",
  authorId: "user-1",
  authorName: "Alice",
};

vi.mock("../../services/tasks/taskActivityService", () => ({
  taskActivityService: {
    getRecentTaskActivity: vi.fn(async () => [MOCK_CHECKLIST_TASK_LOG]),
    subscribeToAllActivity: vi.fn(() => ({})),
    unsubscribeFromActivity: vi.fn(),
  },
}));

vi.mock("../../services/groupTaskActivityService", () => ({
  groupTaskActivityService: {
    getRecentGroupActivity: vi.fn(async () => []),
    subscribeToAllActivity: vi.fn(() => ({})),
    unsubscribeFromActivity: vi.fn(),
  },
}));

vi.mock("../../services/systemAuditLogService", () => ({
  systemAuditLogService: {
    getRecentSystemActivity: vi.fn(async (params) => {
      if (params.entityType === "OPPORTUNITY") {
        return [MOCK_SOR_LOG];
      }
      return [MOCK_SYSTEM_OPP_LOG];
    }),
    subscribeToAllActivity: vi.fn(() => ({})),
    unsubscribeFromActivity: vi.fn(),
  },
}));

vi.mock("../../services/opportunityService", () => ({
  opportunityService: {
    getOpportunities: vi.fn(async () => [
      { id: "opp-123", opportunity_no: "S0001", project_title: "Alpha CCTV" },
      { id: "opp-456", opportunity_no: "S0002", project_title: "Beta Network" },
    ]),
  },
}));

vi.mock("../../services/employeeService", () => ({
  employeeService: {
    getAllEmployees: vi.fn(async () => [
      { id: "user-1", name: "Alice", avatar_path: null },
      { id: "user-2", name: "Bob", avatar_path: null },
    ]),
  },
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", name: "Alice", isSuperAdmin: true, is_super_admin: true, is_hr: true },
  }),
}));

describe("SuperAdminActivityLogPage Clickable SOR Logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches OPEN_ENTITY_DETAILS with type OPPORTUNITY when clicking an SOR log card", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    renderWithProviders(<SuperAdminActivityLogPage />);

    // Switch to SOR Logs tab
    const sorTab = await screen.findByRole("tab", { name: "SOR Logs" });
    fireEvent.click(sorTab);

    // Wait for the SOR log item to appear
    await waitFor(() => {
      expect(screen.getByText(/Alpha CCTV S0001/i)).toBeInTheDocument();
    });

    const cardButton = screen.getByText(/Alpha CCTV S0001/i).closest("button");
    expect(cardButton).not.toBeDisabled();

    fireEvent.click(cardButton);

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "OPEN_ENTITY_DETAILS",
        detail: { id: "opp-123", type: "OPPORTUNITY" },
      })
    );
  });

  it("dispatches OPEN_ENTITY_DETAILS with type OPPORTUNITY when clicking an OPPORTUNITY system log", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    renderWithProviders(<SuperAdminActivityLogPage />);

    // Switch to System Logs tab
    const systemTab = await screen.findByRole("tab", { name: "System Logs" });
    fireEvent.click(systemTab);

    // Wait for the System log item with entityType OPPORTUNITY
    await waitFor(() => {
      expect(screen.getByText(/Beta Network S0002/i)).toBeInTheDocument();
    });

    const cardButton = screen.getByText(/Beta Network S0002/i).closest("button");
    expect(cardButton).not.toBeDisabled();

    fireEvent.click(cardButton);

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "OPEN_ENTITY_DETAILS",
        detail: { id: "opp-456", type: "OPPORTUNITY" },
      })
    );
  });

  it("renders a JSON-encoded checklist title as checklist items, not raw JSON", async () => {
    renderWithProviders(<SuperAdminActivityLogPage />);

    const tasksTab = await screen.findByRole("tab", { name: "Task Logs" });
    fireEvent.click(tasksTab);

    await waitFor(() => {
      expect(screen.getByText("Confirm site survey")).toBeInTheDocument();
    });

    expect(screen.getByText("Send quotation")).toBeInTheDocument();
    expect(screen.queryByText(/"checked":true/)).not.toBeInTheDocument();
  });
});

describe("SuperAdminActivityLogPage task filters", () => {
  const rowFor = (id, title, status) => ({
    ...MOCK_CHECKLIST_TASK_LOG,
    id,
    taskId: `task-${id}`,
    taskDescription: title,
    taskStatus: status,
    content: `note ${id}`,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const { taskActivityService } = await import("../../services/tasks/taskActivityService");
    // The server narrows the rows; the page must show what comes back as is.
    taskActivityService.getRecentTaskActivity.mockImplementation(async (params) =>
      params.taskStatus === "COMPLETED"
        ? [rowFor("a", "Finished job", "COMPLETED")]
        : [rowFor("a", "Finished job", "COMPLETED"), rowFor("b", "Open job", "INCOMPLETE")],
    );
  });

  it("changes the rows when a Task status is picked, using the real COMPLETED value", async () => {
    const { taskActivityService } = await import("../../services/tasks/taskActivityService");
    const user = setupUser();
    renderWithProviders(<SuperAdminActivityLogPage />);

    expect(await screen.findByText("Open job")).toBeInTheDocument();

    await user.click(screen.getByText("All statuses"));
    await user.click(screen.getByRole("button", { name: "Completed" }));

    await waitFor(() => expect(screen.queryByText("Open job")).not.toBeInTheDocument());
    expect(screen.getByText("Finished job")).toBeInTheDocument();
    expect(taskActivityService.getRecentTaskActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ taskStatus: "COMPLETED" }),
    );
  });

  it("does not filter the loaded page by department on the client", async () => {
    renderWithProviders(<SuperAdminActivityLogPage />);

    // Rows carry no department; the server already decided what belongs.
    expect(await screen.findByText("Finished job")).toBeInTheDocument();
    expect(screen.getByText("Open job")).toBeInTheDocument();
  });
});

describe("SuperAdminActivityLogPage tab filters and polish", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { taskActivityService } = await import("../../services/tasks/taskActivityService");
    taskActivityService.getRecentTaskActivity.mockImplementation(async () => [MOCK_CHECKLIST_TASK_LOG]);
  });

  it("shows Task status and Department on Task Logs but not on System Logs", async () => {
    const user = setupUser();
    renderWithProviders(<SuperAdminActivityLogPage />);

    expect(await screen.findByText("Confirm site survey")).toBeInTheDocument();
    expect(screen.getByText("All statuses")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/task description/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /filters/i }));
    expect(screen.getByText("All departments")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("tab", { name: "System Logs" }));
    expect(await screen.findByText(/Beta Network S0002/i)).toBeInTheDocument();
    expect(screen.queryByText("All statuses")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/task description/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /filters/i }));
    expect(screen.queryByText("All departments")).not.toBeInTheDocument();
    expect(screen.queryByText("All sub-departments")).not.toBeInTheDocument();
  });

  it("logs no console error for titles that start with [", async () => {
    const { taskActivityService } = await import("../../services/tasks/taskActivityService");
    taskActivityService.getRecentTaskActivity.mockImplementation(async () => [
      { ...MOCK_CHECKLIST_TASK_LOG, id: "pr-1", taskDescription: "[PR] S07696", content: "note" },
    ]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(<SuperAdminActivityLogPage />);

    expect(await screen.findByText("[PR] S07696")).toBeInTheDocument();
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("checklist"), expect.anything());
    errorSpy.mockRestore();
  });

  it("swaps a date range typed backwards", async () => {
    const user = setupUser();
    renderWithProviders(<SuperAdminActivityLogPage />);
    await screen.findByText("Confirm site survey");
    await user.click(screen.getByRole("button", { name: /filters/i }));

    const from = screen.getByLabelText(/date from/i);
    const to = screen.getByLabelText(/date to/i);
    fireEvent.change(from, { target: { value: "2026-11-19" } });
    fireEvent.change(to, { target: { value: "2026-11-01" } });

    await waitFor(() => expect(from).toHaveValue("2026-11-01"));
    expect(to).toHaveValue("2026-11-19");
  });

  it("keeps the Status on the phone card of a Task Logs row", async () => {
    renderWithProviders(<SuperAdminActivityLogPage />);
    const row = (await screen.findByText("Confirm site survey")).closest("tr");
    await waitFor(() => {
      const status = Array.from(row.querySelectorAll("td")).find((td) => td.dataset.label === "Status");
      expect(status).toBeTruthy();
      expect(status.dataset.phone).not.toBe("hide");
    });
  });

  it("names what changed in the System Logs Subject", async () => {
    const { systemAuditLogService } = await import("../../services/systemAuditLogService");
    systemAuditLogService.getRecentSystemActivity.mockImplementation(async () => [
      {
        ...MOCK_SYSTEM_OPP_LOG,
        id: "m-1",
        entityType: "MEETING_REQUEST",
        taskDescription: "[MEETING_REQUEST]",
        content: "Booked",
        metadata: { venue: "Boardroom A" },
      },
    ]);
    const user = setupUser();
    renderWithProviders(<SuperAdminActivityLogPage />);
    await user.click(await screen.findByRole("tab", { name: "System Logs" }));
    expect(await screen.findByText("Boardroom A")).toBeInTheDocument();
  });
});
