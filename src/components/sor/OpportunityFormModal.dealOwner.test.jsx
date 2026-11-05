/**
 * The registrant is the usual Deal Owner. A new registration starts with them
 * picked when they are on the employee list; a salesperson can still change it.
 * (The server already falls back to the registrant when none is named, #793.
 * This makes the form show that choice instead of an empty box.)
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../test/support";
import OpportunityFormModal from "./OpportunityFormModal";

const DIRECTOR_ID = "7a223a36-16b3-4842-a6e0-88798459b653";
const OWNER_ID = "d44bd378-0d34-458a-91ef-615d8c695edb";
const SALE_TYPE_ID = "6f6a1a2a-5555-4a3a-9a3a-1a2b3c4d5e6f";

vi.mock("../../services/employeeService", () => ({
  employeeService: {
    getAllEmployees: vi.fn(async () => [
      { id: DIRECTOR_ID, name: "101", role: "CEO & SALES DIRECTOR", subDepartment: "" },
      { id: OWNER_ID, name: "Maey Zausa", role: "SALES HEAD/CONSULTANT", subDepartment: "" },
    ]),
  },
}));

vi.mock("../../services/leadSourceService", () => ({
  leadSourceService: {
    getActiveLeadSources: vi.fn(async () => [{ value: "LGU", label: "LGU" }]),
  },
}));

vi.mock("../../services/opportunityService", () => ({
  opportunityService: { getItems: vi.fn(async () => []) },
}));

vi.mock("../../services/salesFlowService", () => ({
  salesFlowService: {
    getSaleTypes: vi.fn(async () => [{ id: SALE_TYPE_ID, name: "Flow A" }]),
    getFlow: vi.fn(async () => ({ stages: [], edges: [] })),
  },
}));

vi.mock("../../services/stageConditionService", () => ({
  stageConditionService: { getForStage: vi.fn(async () => []) },
}));

vi.mock("../../services/employeeGroupService", () => ({
  employeeGroupService: { list: vi.fn(async () => []) },
}));

vi.mock("../../services/formFieldService", () => ({
  formFieldService: { getForSaleType: vi.fn(async () => []) },
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// Mutable so one test can make the registrant someone off the employee list.
const authUser = { id: OWNER_ID, isSuperAdmin: false };
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: authUser }),
}));

function renderForm() {
  const onSubmit = vi.fn();
  renderWithProviders(
    <OpportunityFormModal isOpen onClose={() => {}} onSubmit={onSubmit} isPending={false} />,
  );
  return onSubmit;
}

async function chooseSaleType() {
  fireEvent.click(await screen.findByText("Select sale type…"));
  fireEvent.click(await screen.findByText("Flow A"));
}

function submitForm() {
  const form = document.getElementById("opportunity-form");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("OpportunityFormModal: Deal Owner defaults to the registrant", () => {
  it("starts a new registration with the registrant picked as Deal Owner", async () => {
    authUser.id = OWNER_ID;
    const onSubmit = renderForm();

    // The Deal Owner box shows the registrant once the employee list is in.
    expect(await screen.findByText("Maey Zausa")).toBeInTheDocument();
    await chooseSaleType();
    submitForm();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].deal_owner_id).toBe(OWNER_ID);
  });

  it("leaves Deal Owner empty when the registrant is not on the employee list", async () => {
    authUser.id = "not-on-the-employee-list";
    try {
      const onSubmit = renderForm();
      await screen.findByText("101");
      await chooseSaleType();
      submitForm();

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0][0].deal_owner_id).toBe("");
      expect(screen.queryByText("Maey Zausa")).not.toBeInTheDocument();
    } finally {
      authUser.id = OWNER_ID;
    }
  });
});
