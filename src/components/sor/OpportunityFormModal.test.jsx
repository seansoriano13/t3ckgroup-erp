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
import { odooService } from "../../services/odooService";
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

vi.mock("../../services/odooService", () => ({
  odooService: { fetchOrderLines: vi.fn() },
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
 * The Company an SOR is sold to is the field salespeople get wrong — 14 of 154
 * live records held a person there and the organisation in Contact Person. So
 * the two are filled from Odoo with OPPOSITE trust rules (ADR 0006): the
 * quotation's customer overwrites Company outright, while Contact Person is
 * only filled when empty, because the typed value routinely carries a mobile
 * number or a working name that Odoo does not hold.
 */
// #816 removed the registration form's Fetch from Odoo button; #820 reworks the lookup, so these wait for it.
describe.skip("OpportunityFormModal — the customer fetched from Odoo", () => {
  const COMPANY = "e.g. Acme Corp";
  const CONTACT = "e.g. Juan Dela Cruz";
  const REFERENCE = "e.g. S01237";

  const found = (overrides = {}) => ({
    success: true,
    found: true,
    order: { id: 8234, name: "S08234", state: "sent" },
    customer: {
      company: "Makati City Government",
      company_id: 4471,
      contact: "Erika jane D. Duenas",
    },
    items: [{ product_name: "Pumper", unit: "Units", quantity: 2, unit_price: 1500 }],
    ...overrides,
  });

  const type = (placeholder, value) =>
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

  const clickFetch = () =>
    fireEvent.click(screen.getByRole("button", { name: /fetch/i }));

  const submit = () => {
    const form = document.getElementById("opportunity-form");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  };

  const fetchWith = async (response) => {
    odooService.fetchOrderLines.mockResolvedValue(response);
    const onSubmit = renderForm();
    await screen.findByText("101");
    type(REFERENCE, "S08234");
    clickFetch();
    return onSubmit;
  };

  const companyFilled = () =>
    waitFor(() =>
      expect(screen.getByPlaceholderText(COMPANY)).toHaveValue("Makati City Government"),
    );

  it("fills the Company and the Contact Person from the quotation", async () => {
    await fetchWith(found());

    await companyFilled();
    expect(screen.getByPlaceholderText(CONTACT)).toHaveValue("Erika jane D. Duenas");
  });

  it("overwrites a Company that was typed by hand", async () => {
    odooService.fetchOrderLines.mockResolvedValue(found());
    renderForm();
    await screen.findByText("101");
    type(COMPANY, "Makati LGU");
    type(REFERENCE, "S08234");
    clickFetch();

    await companyFilled();
  });

  it("leaves a Contact Person that was typed by hand alone", async () => {
    odooService.fetchOrderLines.mockResolvedValue(found());
    renderForm();
    await screen.findByText("101");
    type(CONTACT, "Erika - 09171234567");
    type(REFERENCE, "S08234");
    clickFetch();

    await companyFilled();
    expect(screen.getByPlaceholderText(CONTACT)).toHaveValue("Erika - 09171234567");
  });

  it("still fills the Company when the quotation has no product lines yet", async () => {
    await fetchWith(
      found({
        items: [],
        message: "S08234 was found in Odoo but has no product lines yet.",
      }),
    );

    await companyFilled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success.mock.calls[0][0]).toContain("no product lines");
  });

  it("leaves the form untouched when the reference matches nothing", async () => {
    odooService.fetchOrderLines.mockResolvedValue({
      success: false,
      found: false,
      message: "No Odoo quotation found matching S09999.",
    });
    renderForm();
    await screen.findByText("101");
    type(COMPANY, "Makati LGU");
    type(REFERENCE, "S09999");
    clickFetch();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByPlaceholderText(COMPANY)).toHaveValue("Makati LGU");
  });

  it("leaves the form untouched when Odoo cannot be reached", async () => {
    odooService.fetchOrderLines.mockRejectedValue(new Error("Failed to fetch"));
    renderForm();
    await screen.findByText("101");
    type(COMPANY, "Makati LGU");
    type(REFERENCE, "S08234");
    clickFetch();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByPlaceholderText(COMPANY)).toHaveValue("Makati LGU");
  });

  it("names the company in the toast that reports the pull", async () => {
    await fetchWith(found());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success.mock.calls[0][0]).toContain("Makati City Government");
    expect(toast.success.mock.calls[0][0]).toContain("S08234");
  });

  it("marks the fields the fetch changed and leaves the others unmarked", async () => {
    odooService.fetchOrderLines.mockResolvedValue(found());
    renderForm();
    await screen.findByText("101");
    // Already correct — Odoo agrees, so nothing about this field changed and
    // a highlight would be telling the salesperson something untrue.
    type(COMPANY, "Makati City Government");
    type(REFERENCE, "S08234");
    clickFetch();

    await waitFor(() =>
      expect(screen.getByPlaceholderText(CONTACT)).toHaveValue("Erika jane D. Duenas"),
    );
    expect(
      screen.getByPlaceholderText(CONTACT).closest("[data-autofilled]"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(COMPANY).closest("[data-autofilled]"),
    ).not.toBeInTheDocument();
  });

  it("submits the Odoo partner behind a fetched Company", async () => {
    const onSubmit = await fetchWith(found());

    await companyFilled();
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].odoo_partner_id).toBe(4471);
  });

  it("drops the Odoo partner once the Company is edited by hand", async () => {
    const onSubmit = await fetchWith(found());

    await companyFilled();
    type(COMPANY, "Makati City Govt");
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].odoo_partner_id).toBe(null);
  });
});

/**
 * Splitting the empty-quotation case out of the failure path (so the Company
 * still gets verified) put the Product List in reach of a response that
 * carries no items. These pin the two things that must NOT follow from that.
 */
// #816 removed the registration form's Fetch from Odoo button; #820 reworks the lookup, so these wait for it.
describe.skip("OpportunityFormModal — a quotation with no product lines", () => {
  const COMPANY = "e.g. Acme Corp";
  const REFERENCE = "e.g. S01237";
  const PRODUCT = "e.g. Boom Lift";

  const emptyQuotation = {
    success: true,
    found: true,
    order: { id: 8234, name: "S08234", state: "draft" },
    customer: { company: "Makati City Government", company_id: 4471, contact: "" },
    items: [],
    message: "S08234 was found in Odoo but has no product lines yet.",
  };

  it("leaves a hand-built Product List standing", async () => {
    // The old contract failed this response outright, so the items survived by
    // accident. Now that it succeeds, an empty list must not read as "replace
    // everything with nothing" — that is the salesperson's typing, gone.
    odooService.fetchOrderLines.mockResolvedValue(emptyQuotation);
    vi.stubGlobal("confirm", () => true);

    renderForm();
    await screen.findByText("101");
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));
    fireEvent.change(screen.getByPlaceholderText(PRODUCT), {
      target: { value: "Boom Lift" },
    });
    fireEvent.change(screen.getByPlaceholderText(REFERENCE), {
      target: { value: "S08234" },
    });

    fireEvent.click(screen.getByRole("button", { name: /fetch from odoo/i }));

    await waitFor(() =>
      expect(screen.getByPlaceholderText(COMPANY)).toHaveValue("Makati City Government"),
    );
    expect(screen.getByPlaceholderText(PRODUCT)).toHaveValue("Boom Lift");
  });

  it("reports the whole outcome in one toast", async () => {
    // One fetch, one piece of feedback. Two toasts for one gesture reads as
    // two things having happened.
    odooService.fetchOrderLines.mockResolvedValue(emptyQuotation);
    renderForm();
    await screen.findByText("101");
    fireEvent.change(screen.getByPlaceholderText(REFERENCE), {
      target: { value: "S08234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fetch/i }));

    await waitFor(() =>
      expect(screen.getByPlaceholderText(COMPANY)).toHaveValue("Makati City Government"),
    );
    const toasts = toast.success.mock.calls.length + toast.error.mock.calls.length;
    expect(toasts).toBe(1);
  });
});

// #816 removed the registration form's Fetch from Odoo button; #820 reworks the lookup, so these wait for it.
describe.skip("SorField — the fetched-value highlight", () => {
  it("replaces the resting border rather than stacking a second one on it", async () => {
    // Both are border-colour utilities, so which one wins is decided by
    // stylesheet order, not by the order they appear in the class attribute.
    // Leaving `border-border` in place next to `border-mauve-8` is how a
    // highlight ends up invisible while every behavioural test still passes.
    odooService.fetchOrderLines.mockResolvedValue({
      success: true,
      found: true,
      order: { id: 8234, name: "S08234", state: "sent" },
      customer: { company: "Makati City Government", company_id: 4471, contact: "" },
      items: [{ product_name: "Pumper", unit: "Units", quantity: 1, unit_price: 10 }],
    });
    renderForm();
    await screen.findByText("101");
    fireEvent.change(screen.getByPlaceholderText("e.g. S01237"), {
      target: { value: "S08234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fetch/i }));

    const box = await waitFor(() => {
      const el = screen.getByPlaceholderText("e.g. Acme Corp").closest("[data-autofilled]");
      expect(el).toBeInTheDocument();
      return el;
    });
    expect(box.className).toContain("border-mauve-8");
    expect(box.className).not.toContain("border-border");
  });
});

/**
 * The fetch overwrites Company on purpose — that is the field salespeople get
 * wrong. Undo exists for the case the overwrite itself is wrong: `findOrder`
 * falls back to a fuzzy `ilike` match, so a mistyped reference can resolve to
 * a real but different quotation and hand back a real but different customer.
 */
// #816 removed the registration form's Fetch from Odoo button; #820 reworks the lookup, so these wait for it.
describe.skip("OpportunityFormModal — putting back a Company the fetch displaced", () => {
  const COMPANY = "e.g. Acme Corp";
  const REFERENCE = "e.g. S01237";

  const found = {
    success: true,
    found: true,
    order: { id: 8234, name: "S08234", state: "sent" },
    customer: { company: "Makati City Government", company_id: 4471, contact: "" },
    items: [{ product_name: "Pumper", unit: "Units", quantity: 1, unit_price: 10 }],
  };

  const fetchOver = async (typedCompany) => {
    odooService.fetchOrderLines.mockResolvedValue(found);
    const onSubmit = renderForm();
    await screen.findByText("101");
    if (typedCompany) {
      fireEvent.change(screen.getByPlaceholderText(COMPANY), {
        target: { value: typedCompany },
      });
    }
    fireEvent.change(screen.getByPlaceholderText(REFERENCE), {
      target: { value: "S08234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fetch from odoo/i }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText(COMPANY)).toHaveValue("Makati City Government"),
    );
    return onSubmit;
  };

  const undo = () => screen.queryByRole("button", { name: /^undo$/i });

  it("offers to restore the Company that was typed before the fetch", async () => {
    await fetchOver("Makati LGU");

    fireEvent.click(undo());

    expect(screen.getByPlaceholderText(COMPANY)).toHaveValue("Makati LGU");
  });

  it("drops the Odoo partner when the fetched Company is put back", async () => {
    // The restored name is the salesperson's again, so nothing vouches for it.
    const onSubmit = await fetchOver("Makati LGU");

    fireEvent.click(undo());
    document
      .getElementById("opportunity-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].odoo_partner_id).toBe(null);
    expect(onSubmit.mock.calls[0][0].client_name).toBe("Makati LGU");
  });

  it("does not offer to restore an empty Company", async () => {
    // Company is required, so undoing into a blank would only break the form.
    await fetchOver("");

    expect(undo()).not.toBeInTheDocument();
  });

  it("withdraws the offer once the Company is typed over", async () => {
    await fetchOver("Makati LGU");

    fireEvent.change(screen.getByPlaceholderText(COMPANY), {
      target: { value: "Makati City Govt" },
    });

    expect(undo()).not.toBeInTheDocument();
  });

  it("offers nothing when Odoo agreed with what was already typed", async () => {
    await fetchOver("Makati City Government");

    expect(undo()).not.toBeInTheDocument();
  });
});
