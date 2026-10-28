import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/support";
import { employeeService } from "../services/employeeService";
import { MemoryRouter } from "react-router"
import GlobalDetailManager from "./GlobalDetailManager";

// This lives beside GlobalDetailManager.test.jsx rather than inside it because
// that file has to name the procurement service, which is called something
// different on either side of the staging merge. Nothing here names a module
// whose path differs between branches, so this file merges as it stands.
//
// The two detail modals are stubbed for the same reason: they are the only way
// the procurement service reaches this component's import graph, and the group
// task branch is the one under test.
vi.mock("./sor/OpportunityDetailsModal", () => ({ default: () => null }));
vi.mock("./TaskDetails", () => ({ default: () => null }));

vi.mock("../services/taskService", () => ({
  taskService: { getTaskById: vi.fn(async () => null) },
}));

vi.mock("../services/groupTaskService", () => ({
  groupTaskService: { getGroupTaskById: vi.fn(async () => null) },
}));

vi.mock("../services/opportunityService", () => ({
  opportunityService: {
    getOpportunityById: vi.fn(async () => null),
    getItems: vi.fn(async () => []),
    getNotes: vi.fn(async () => []),
  },
}));

vi.mock("../services/employeeService", () => ({
  employeeService: { getAllEmployees: vi.fn(async () => []) },
}));

// A rank-and-file employee: no head, no HR, no super admin. This is the whole
// point of the test — the roster fetch used to be gated on being a manager, so
// a fixture with any of these flags set would pass against the bug.
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-9", name: "Ana Reyes", is_head: false, is_hr: false, isSuperAdmin: false },
  }),
}));

const openEntity = (type, id) =>
  act(() => {
    window.dispatchEvent(
      new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id, type } }),
    );
  });

describe("GlobalDetailManager — mention roster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the roster for a non-manager opening a group task", async () => {
    renderWithProviders(<MemoryRouter><GlobalDetailManager /></MemoryRouter>);
    openEntity("GROUP_TASK", "gt-1");

    // The roster is what the detail modal hands the mention picker. Gated on
    // `canManage`, this stayed empty and every `@` matched nobody.
    await waitFor(() => {
      expect(employeeService.getAllEmployees).toHaveBeenCalled();
    });
  });

  it("leaves the roster alone for entity types that never mention anyone", async () => {
    renderWithProviders(<MemoryRouter><GlobalDetailManager /></MemoryRouter>);
    openEntity("TASK", "t-1");

    // The task and SOR views fetch their own roster; pulling every employee
    // here as well would be a query nobody reads.
    await waitFor(() => {
      expect(employeeService.getAllEmployees).not.toHaveBeenCalled();
    });
  });
});
