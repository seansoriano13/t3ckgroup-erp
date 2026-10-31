/**
 * The Sales Director field is locked rather than chosen, so nothing in the UI
 * surfaces what it is about to submit. It shipped hardcoded to the account's
 * display name ("101") instead of its id, and since sales_director_id is a
 * uuid FK, every registration died on `invalid input syntax for type uuid`.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../test/support";
import OpportunityFormModal from "./OpportunityFormModal";
import toast from "react-hot-toast";

const DIRECTOR_ID = "7a223a36-16b3-4842-a6e0-88798459b653";
const OWNER_ID = "d44bd378-0d34-458a-91ef-615d8c695edb";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

vi.mock("../../services/employeeService", () => ({
  employeeService: {
    getAllEmployees: vi.fn(async () => [
      {
        id: DIRECTOR_ID,
        name: "101",
        role: "CEO & SALES DIRECTOR",
        subDepartment: "",
      },
      {
        id: OWNER_ID,
        name: "Maey Zausa",
        role: "SALES HEAD/CONSULTANT",
        subDepartment: "",
      },
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

const SALE_TYPE_ID = "6f6a1a2a-5555-4a3a-9a3a-1a2b3c4d5e6f";
const ENTRY_STAGE_ID = "9c9c9c9c-1111-4a3a-9a3a-1a2b3c4d5e6f";
const CONDITION_ID = "1d1d1d1d-2222-4a3a-9a3a-1a2b3c4d5e6f";

vi.mock("../../services/salesFlowService", () => ({
  salesFlowService: {
    getSaleTypes: vi.fn(async () => [{ id: SALE_TYPE_ID, name: "Flow A" }]),
    getFlow: vi.fn(async (saleTypeId) =>
      saleTypeId === SALE_TYPE_ID
        ? { stages: [{ id: ENTRY_STAGE_ID, sort_order: 0 }], edges: [] }
        : { stages: [], edges: [] },
    ),
  },
}));

vi.mock("../../services/stageConditionService", () => ({
  stageConditionService: {
    getForStage: vi.fn(async (stageId) =>
      stageId === ENTRY_STAGE_ID
        ? [
            {
              id: CONDITION_ID,
              kind: "assignment",
              label: "Buyer assigned",
              is_required: true,
              config: { who: [] },
            },
          ]
        : [],
    ),
  },
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

// AuthContext spreads the record from employeeService, which is camelCased —
// there is no `is_super_admin` on the auth user, only `isSuperAdmin`.
const authUser = { id: OWNER_ID, isSuperAdmin: false };
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: authUser }),
}));

function renderForm(props = {}) {
  const onSubmit = vi.fn();
  renderWithProviders(
    <OpportunityFormModal
      isOpen
      onClose={() => {}}
      onSubmit={onSubmit}
      isPending={false}
      {...props}
    />,
  );
  return onSubmit;
}

describe("OpportunityFormModal — Sales Director", () => {
  it("submits the director's uuid rather than the account's display name", async () => {
    const onSubmit = renderForm();

    // The locked field shows the resolved director once employees load.
    await screen.findByText("101");

    const form = document.getElementById("opportunity-form");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const payload = onSubmit.mock.calls[0][0];
    expect(payload.sales_director_id).toBe(DIRECTOR_ID);
    expect(payload.sales_director_id).toMatch(UUID_RE);
  });

  it("keeps an existing director when editing rather than re-resolving", async () => {
    const onSubmit = renderForm({
      opportunity: {
        id: "0e4a4b7c-1d2e-4f30-9a8b-7c6d5e4f3a2b",
        client_name: "LGU - Tuguegarao",
        project_title: "2 Units Boom Lift",
        sales_director_id: OWNER_ID,
      },
    });

    await screen.findByText("Maey Zausa");

    const form = document.getElementById("opportunity-form");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].sales_director_id).toBe(OWNER_ID);
  });
});

describe("OpportunityFormModal — Assignment conditions", () => {
  it("does not offer an entry-Stage Assignment condition on the registration form", async () => {
    const onSubmit = renderForm();
    await screen.findByText("101");

    fireEvent.click(screen.getByText("Select sale type…"));
    fireEvent.click(await screen.findByText("Flow A"));

    await screen.findByText(/Showing \d+ fields? for Flow A/);
    expect(screen.queryByText("Buyer assigned")).not.toBeInTheDocument();

    const form = document.getElementById("opportunity-form");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("dayOneAssignments");
  });
});

describe("OpportunityFormModal — Project Type Auto-derivation & Strategic Toggle", () => {
  it("displays SSP badge by default on a blank registration form", async () => {
    renderForm();
    const badge = await screen.findByTestId("project-type-badge");
    expect(badge).toHaveTextContent("SSP — Single Salesperson Project");
  });

  it("submits with project_type SSP by default", async () => {
    const onSubmit = renderForm();
    await screen.findByText("101");

    const form = document.getElementById("opportunity-form");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].project_type).toBe("SSP");
  });

  it("toggles to Strategic when Mark as Strategic is clicked", async () => {
    const onSubmit = renderForm();
    await screen.findByText("101");

    const toggleButton = screen.getByRole("button", { name: /mark as strategic/i });
    fireEvent.click(toggleButton);

    const badge = await screen.findByTestId("project-type-badge");
    expect(badge).toHaveTextContent("Strategic Project");

    const form = document.getElementById("opportunity-form");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].project_type).toBe("STRATEGIC");
  });

  it("unsets Strategic back to auto-derived SSP when clicked again", async () => {
    renderForm();
    await screen.findByText("101");

    const toggleButton = screen.getByRole("button", { name: /mark as strategic/i });
    fireEvent.click(toggleButton);

    let badge = await screen.findByTestId("project-type-badge");
    expect(badge).toHaveTextContent("Strategic Project");

    // Click again to unset
    const unsetButton = screen.getByRole("button", { name: /★ strategic/i });
    fireEvent.click(unsetButton);

    badge = await screen.findByTestId("project-type-badge");
    expect(badge).toHaveTextContent("SSP — Single Salesperson Project");
  });

  it("shows Closing Salesperson selector and Deal Owner / Originator label when Strategic", async () => {
    renderForm();
    await screen.findByText("101");

    // Initially no Closing Salesperson field
    expect(screen.queryByText("Closing Salesperson")).not.toBeInTheDocument();

    const toggleButton = screen.getByRole("button", { name: /mark as strategic/i });
    fireEvent.click(toggleButton);

    // After marking Strategic, Closing Salesperson is shown
    expect(screen.getByText("Closing Salesperson")).toBeInTheDocument();
    expect(screen.getByText("Deal Owner / Originator")).toBeInTheDocument();
  });
});

/**
 * #820: the S0 box on the registration form. The form checks the format and hands the S0 to
 * `createOpportunity`, which runs the save step's checks (duplicates, Odoo, product pull) before
 * anything is registered (see opportunityService.test.js). The form no longer asks "go ahead
 * anyway" about a duplicate: a duplicate is refused, not confirmed.
 */
describe("OpportunityFormModal � the S0 box", () => {
  const REFERENCE = "e.g. S01237";

  const type = (placeholder, value) =>
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

  const submit = () => {
    const form = document.getElementById("opportunity-form");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  };

  it("has no Fetch from Odoo button", async () => {
    renderForm();
    await screen.findByText("101");
    expect(screen.queryByRole("button", { name: /fetch/i })).not.toBeInTheDocument();
  });

  it("hands a typed S0 to registration, normalised, and never asks to go ahead anyway", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const onSubmit = renderForm();
    await screen.findByText("101");
    type(REFERENCE, " so01237 ");
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].sales_reference).toBe("S01237");
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("refuses a number that is not an S0 before registering", async () => {
    const onSubmit = renderForm();
    await screen.findByText("101");
    type(REFERENCE, "not-a-quote");
    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("lets a blank S0 register (it can be added later)", async () => {
    const onSubmit = renderForm();
    await screen.findByText("101");
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].sales_reference).toBe("");
  });
});
