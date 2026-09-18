import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../support";
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
    const sorTab = await screen.findByRole("button", { name: "SOR Logs" });
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
    const systemTab = await screen.findByRole("button", { name: "System Logs" });
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

    const tasksTab = await screen.findByRole("button", { name: "Task Logs" });
    fireEvent.click(tasksTab);

    await waitFor(() => {
      expect(screen.getByText("Confirm site survey")).toBeInTheDocument();
    });

    expect(screen.getByText("Send quotation")).toBeInTheDocument();
    expect(screen.queryByText(/"checked":true/)).not.toBeInTheDocument();
  });
});
