import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import CostingMatrixPage from "@/pages/costing-matrix";
import { renderWithProviders, setupUser } from "@/test/support";
import { db } from "@/test/db/store";
import { stubRpc } from "@/test/msw/server";

/**
 * The Costing Matrix page (#606, spec #595): every SOR with a Costing Matrix, Planned and Actual
 * Revenue side by side, for the Closed Book. Who may read the rows is the policy tier's (117); the
 * maths is costingMath's (#605); this proves the screen: the columns, the highlight and estimate
 * marks, the totals, the filters and search, opening a row on its Costing Matrix tab, and sending
 * anyone outside the Closed Book home.
 *
 * Rows (default rates, ITR 8% over a 250,000 allowance):
 *   SOR-101  Final Offer 2,980,000, Final Acquire 2,338,500, nothing bought     Planned = Actual = 423,100
 *   SOR-102  same offer and cost, one item bought at 1,100,000 for 1,000,000    Actual 323,100 (-100,000), estimate
 *   SOR-103  no Final Offer yet                                                 no figures
 */

let authUser;
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser, isAuthLoading: false }) }));

const base = {
  final_offer_total: "2980000.00",
  final_acquire_total: "2338500.00",
  landed_cost_total: "0",
  bought_final_acquire_total: "0",
  items_bought: 0,
  items_total: 2,
  ipas_short: false,
  entities: [],
};
const rows = [
  { ...base, opportunity_id: "aaaaaaaa-0000-4000-8000-000000000101", sor_code: "SOR-101", sales_reference: "S04081", project_title: "BFP Command Bus", stage: "Bidding", entities: ["T3CK Group Inc"] },
  {
    ...base,
    opportunity_id: "aaaaaaaa-0000-4000-8000-000000000102",
    sor_code: "SOR-102",
    sales_reference: "S04090",
    project_title: "Rescue vehicle for the city",
    stage: "Awarded",
    entities: ["T3CK Group Inc", "Rescue Co"],
    landed_cost_total: "1100000.00",
    bought_final_acquire_total: "1000000.00",
    items_bought: 1,
    ipas_short: true,
  },
  { ...base, opportunity_id: "aaaaaaaa-0000-4000-8000-000000000103", sor_code: "SOR-103", sales_reference: null, project_title: "Water tanker", stage: "Bidding", final_offer_total: null, final_acquire_total: null, items_total: 0 },
];

function renderPage() {
  return renderWithProviders(
    <MemoryRouter initialEntries={["/costing-matrix"]}>
      <Routes>
        <Route path="/costing-matrix" element={<CostingMatrixPage />} />
        <Route path="/" element={<p>The dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const rowFor = async (sor) => (await screen.findByText(sor)).closest("tr");

describe("the Costing Matrix page", () => {
  beforeEach(() => {
    authUser = { id: "bbbbbbbb-0000-4000-8000-000000000001", isFinalAcquire: true };
    db.seed("costing_settings", { id: 1 });
    stubRpc("costing_matrix_page", rows);
  });

  afterEach(() => vi.restoreAllMocks());

  it("lists one row per SOR with Final Offer, Planned and Actual Revenue, the difference and items bought", async () => {
    renderPage();

    const plain = await rowFor("SOR-101");
    expect(within(plain).getByText("S04081")).toBeInTheDocument();
    expect(within(plain).getByText("BFP Command Bus")).toBeInTheDocument();
    expect(within(plain).getByText("Bidding")).toBeInTheDocument();
    expect(plain).toHaveTextContent("₱2,980,000.00");
    expect(within(plain).getByTestId("costing-matrix-planned")).toHaveTextContent("₱423,100.00");
    expect(within(plain).getByTestId("costing-matrix-actual")).toHaveTextContent("₱423,100.00");
    expect(within(plain).getByTestId("costing-matrix-items")).toHaveTextContent("0 of 2");

    const bought = await rowFor("SOR-102");
    expect(within(bought).getByTestId("costing-matrix-planned")).toHaveTextContent("₱423,100.00");
    expect(within(bought).getByTestId("costing-matrix-actual")).toHaveTextContent("₱323,100.00");
    expect(within(bought).getByTestId("costing-matrix-difference")).toHaveTextContent("-₱100,000.00");
    expect(within(bought).getByTestId("costing-matrix-items")).toHaveTextContent("1 of 2");
  });

  it("highlights a row whose Actual is below Planned, and marks Actual an estimate only where an IPAS is short", async () => {
    renderPage();

    expect(await rowFor("SOR-102")).toHaveAttribute("data-lower", "true");
    expect(await rowFor("SOR-101")).toHaveAttribute("data-lower", "false");
    expect(within(await rowFor("SOR-102")).getByTestId("costing-matrix-estimate")).toHaveTextContent("estimate");
    expect(within(await rowFor("SOR-101")).queryByTestId("costing-matrix-estimate")).not.toBeInTheDocument();
  });

  it("shows a dash, never a zero, for a SOR whose Revenue cannot be worked yet", async () => {
    renderPage();

    const row = await rowFor("SOR-103");
    expect(within(row).getByTestId("costing-matrix-planned")).toHaveTextContent("—");
    expect(within(row).getByTestId("costing-matrix-actual")).toHaveTextContent("—");
    expect(within(row).getByTestId("costing-matrix-difference")).toHaveTextContent("—");
    expect(within(row).queryByTestId("costing-matrix-estimate")).not.toBeInTheDocument();
  });

  it("totals the rows shown, leaving out a SOR with no figure yet", async () => {
    renderPage();
    await rowFor("SOR-101");

    const totals = screen.getByTestId("costing-matrix-totals");
    expect(totals).toHaveTextContent("Total of 3 SORs shown");
    expect(within(totals).getByTestId("costing-matrix-incomplete")).toHaveTextContent("1 without a figure yet, left out");
    expect(within(totals).getByTestId("costing-matrix-total-planned")).toHaveTextContent("₱846,200.00");
    expect(within(totals).getByTestId("costing-matrix-total-actual")).toHaveTextContent("₱746,200.00");
    expect(within(totals).getByTestId("costing-matrix-total-difference")).toHaveTextContent("-₱100,000.00");
    expect(within(totals).getByTestId("costing-matrix-total-offer")).toHaveTextContent("₱5,960,000.00");
    expect(within(totals).getByTestId("costing-matrix-total-items")).toHaveTextContent("1 of 4");
    expect(within(totals).getByTestId("costing-matrix-total-estimate")).toBeInTheDocument();
  });

  it("searches by SOR number, SO number or project, highlights the match, and totals what is left", async () => {
    const user = setupUser();
    renderPage();
    await rowFor("SOR-101");

    const search = screen.getByPlaceholderText(/search so number, sor number or project/i);
    await user.type(search, "s04090");
    await waitFor(() => expect(screen.queryByText("BFP Command Bus")).not.toBeInTheDocument());
    const row = screen.getByTestId("costing-matrix-row");
    expect(row).toHaveTextContent("SOR-102");
    expect(row.querySelector("span.font-semibold.rounded-\\[2px\\]")).not.toBeNull();
    expect(screen.getByTestId("costing-matrix-totals")).toHaveTextContent("Total of 1 SOR shown");
    expect(screen.getByTestId("costing-matrix-total-planned")).toHaveTextContent("₱423,100.00");

    await user.clear(search);
    await user.type(search, "SOR-103");
    await waitFor(() => expect(screen.getAllByTestId("costing-matrix-row")).toHaveLength(1));
    expect(screen.getByTestId("costing-matrix-row")).toHaveTextContent("Water tanker");

    await user.clear(search);
    await user.type(search, "rescue vehicle");
    await waitFor(() => expect(screen.getAllByTestId("costing-matrix-row")).toHaveLength(1));
    expect(screen.getByTestId("costing-matrix-row")).toHaveTextContent("SOR-102");
  });

  it("opens that SOR's Costing Matrix tab when a row is clicked", async () => {
    const opened = vi.fn();
    window.addEventListener("OPEN_ENTITY_DETAILS", opened);
    const user = setupUser();
    renderPage();

    await user.click(await rowFor("SOR-102"));

    await waitFor(() => expect(opened).toHaveBeenCalled());
    expect(opened.mock.calls[0][0].detail).toEqual({ id: rows[1].opportunity_id, type: "OPPORTUNITY", view: "pms" });
    window.removeEventListener("OPEN_ENTITY_DETAILS", opened);
  });

  it("says plainly when nothing matches", async () => {
    const user = setupUser();
    renderPage();
    await rowFor("SOR-101");

    await user.type(screen.getByPlaceholderText(/search so number/i), "no such project");
    expect(await screen.findByText("No matching SOR")).toBeInTheDocument();
  });

  it("shows an empty register its own message", async () => {
    stubRpc("costing_matrix_page", []);
    renderPage();
    expect(await screen.findByText("No Costing Matrix yet")).toBeInTheDocument();
  });

  it("lets a Super Admin in", async () => {
    authUser = { id: "bbbbbbbb-0000-4000-8000-000000000002", isSuperAdmin: true };
    renderPage();
    expect(await rowFor("SOR-101")).toBeInTheDocument();
  });

  it.each([
    ["Purchasing", { has_purchasing_flow: true }],
    ["Finance", { has_finance_flow: true }],
    ["the Deal Team", { has_sales_flow: true }],
    ["a Head", { isHead: true }],
  ])("sends %s home, and never asks the database", async (_who, flags) => {
    authUser = { id: "bbbbbbbb-0000-4000-8000-000000000003", ...flags };
    const asked = vi.fn();
    stubRpc("costing_matrix_page", () => {
      asked();
      return rows;
    });
    renderPage();

    expect(await screen.findByText("The dashboard")).toBeInTheDocument();
    expect(screen.queryByText("SOR-101")).not.toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });
});

describe("the Costing Matrix page filters", () => {
  beforeEach(() => {
    authUser = { id: "bbbbbbbb-0000-4000-8000-000000000001", isFinalAcquire: true };
    db.seed("costing_settings", { id: 1 });
    stubRpc("costing_matrix_page", rows);
  });

  const pick = async (user, chip, option) => {
    await user.click(screen.getByRole("button", { name: new RegExp(chip, "i") }));
    await user.click(await screen.findByRole("button", { name: option }));
  };

  it("narrows by stage", async () => {
    const user = setupUser();
    renderPage();
    await rowFor("SOR-101");

    await pick(user, "Any stage", "Awarded");

    await waitFor(() => expect(screen.getAllByTestId("costing-matrix-row")).toHaveLength(1));
    expect(screen.getByTestId("costing-matrix-row")).toHaveTextContent("SOR-102");
  });

  it("narrows by entity", async () => {
    const user = setupUser();
    renderPage();
    await rowFor("SOR-101");

    await pick(user, "Any entity", "Rescue Co");

    await waitFor(() => expect(screen.getAllByTestId("costing-matrix-row")).toHaveLength(1));
    expect(screen.getByTestId("costing-matrix-row")).toHaveTextContent("SOR-102");
  });

  it("keeps only the SORs whose Actual is below Planned", async () => {
    const user = setupUser();
    renderPage();
    await rowFor("SOR-101");

    await pick(user, "Any margin", "Actual below Planned");

    await waitFor(() => expect(screen.getAllByTestId("costing-matrix-row")).toHaveLength(1));
    expect(screen.getByTestId("costing-matrix-row")).toHaveTextContent("SOR-102");
    expect(screen.getByTestId("costing-matrix-totals")).toHaveTextContent("Total of 1 SOR shown");
  });
});
