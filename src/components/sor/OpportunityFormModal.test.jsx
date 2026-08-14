/**
 * The Sales Director field is locked rather than chosen, so nothing in the UI
 * surfaces what it is about to submit. It shipped hardcoded to the account's
 * display name ("101") instead of its id, and since sales_director_id is a
 * uuid FK, every registration died on `invalid input syntax for type uuid`.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/support";
import OpportunityFormModal from "./OpportunityFormModal";

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

vi.mock("../../services/odooService", () => ({
  odooService: { fetchOrderLines: vi.fn() },
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: OWNER_ID, is_super_admin: false } }),
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
