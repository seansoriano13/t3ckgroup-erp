import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import SideNav from "./SideNav";
import { renderWithProviders } from "../test/support";
import * as AuthContext from "../context/AuthContext";
import * as useNavBadgesModule from "../hooks/useNavBadges";

// Mock child modals and drawers that aren't part of navigation DOM
vi.mock("./NotificationDrawer", () => ({ default: () => null }));
vi.mock("./ComprehensiveChatModal", () => ({ default: () => null }));
vi.mock("./GlobalDetailManager", () => ({ default: () => null }));
vi.mock("./BroadcastModal", () => ({ default: () => null }));
vi.mock("./LogTaskModal", () => ({ default: () => null }));
vi.mock("../pages/group-tasks/_components/CreateGroupTaskModal", () => ({ default: () => null }));
vi.mock("./offsets/ApplyLeaveModal", () => ({ default: () => null }));
vi.mock("./sor/OpportunityFormModal", () => ({ default: () => null }));
vi.mock("./RoleSwitcher", () => ({ default: () => <div data-testid="role-switcher" /> }));

describe("SideNav Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderSideNav(user) {
    vi.spyOn(AuthContext, "useAuth").mockReturnValue({
      user,
      isAuthLoading: false,
    });

    return renderWithProviders(
      <MemoryRouter>
        <SideNav />
      </MemoryRouter>
    );
  }

  it("renders Workspace module and personal links for standard user", () => {
    const user = {
      id: "u1",
      name: "Alice",
      isSuperAdmin: false,
      isHead: false,
      isHr: false,
      has_task_flow: false,
      has_sales_flow: false,
    };

    renderSideNav(user);

    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("My Leaves & Overtime")).toBeInTheDocument();
    expect(screen.queryByText("My Tasks")).not.toBeInTheDocument();
    expect(screen.queryByText("Human Resources")).not.toBeInTheDocument();
    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
  });

  it("renders Operations and Approvals for Department Head with task flow", () => {
    const user = {
      id: "head-1",
      name: "Bob Head",
      isHead: true,
      has_task_flow: true,
    };

    renderSideNav(user);

    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
    expect(screen.getByText("Group Tasks")).toBeInTheDocument();
    expect(screen.getByText("Task Templates")).toBeInTheDocument();
    expect(screen.getByText("Approvals")).toBeInTheDocument();
    expect(screen.getByText("Task Approvals")).toBeInTheDocument();
  });

  it("renders Sales module with SOR Register for sales user", () => {
    const user = {
      id: "sales-1",
      name: "Charlie Sales",
      has_sales_flow: true,
    };

    renderSideNav(user);

    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("SOR / CRM")).toBeInTheDocument();
  });

  it("renders all ERP modules for Super Admin", () => {
    const user = {
      id: "admin-1",
      name: "Super Admin",
      isSuperAdmin: true,
    };

    renderSideNav(user);

    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("Approvals")).toBeInTheDocument();
    expect(screen.getByText("Human Resources")).toBeInTheDocument();
    expect(screen.getByText("Administration")).toBeInTheDocument();
    expect(screen.getByText("System Admin")).toBeInTheDocument();
    expect(screen.getByText("Activity Log")).toBeInTheDocument();
  });

  it("renders categorized quick actions button for users", () => {
    const user = {
      id: "u1",
      name: "Alice",
      has_task_flow: true,
      has_sales_flow: true,
    };

    renderSideNav(user);

    const createBtn = screen.getByTitle("Create new...");
    expect(createBtn).toBeInTheDocument();
  });

  it("renders live link badges when badges are present", () => {
    const user = {
      id: "head-1",
      name: "Bob Head",
      isHead: true,
      has_task_flow: true,
    };

    vi.spyOn(useNavBadgesModule, "useNavBadges").mockReturnValue({
      taskApprovals: 5,
      hrVerifications: 0,
      leaveApprovals: 0,
    });

    renderSideNav(user);

    const linkBadge = screen.getByTestId("link-badge-Task Approvals");
    expect(linkBadge).toBeInTheDocument();
    expect(linkBadge).toHaveTextContent("5");
  });

  it("persists accordion collapse toggle in localStorage", async () => {
    const user = {
      id: "persisted-user-1",
      name: "Persistence Test",
      isSuperAdmin: true,
    };

    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    renderSideNav(user);

    // Initial check
    expect(getItemSpy).toHaveBeenCalledWith("erp_sidebar_groups_persisted-user-1");

    // Click Workspace header to collapse
    const workspaceHeader = screen.getByText("Workspace");
    fireEvent.click(workspaceHeader);

    expect(setItemSpy).toHaveBeenCalledWith(
      "erp_sidebar_groups_persisted-user-1",
      expect.stringContaining('"workspace":false')
    );
  });
});
