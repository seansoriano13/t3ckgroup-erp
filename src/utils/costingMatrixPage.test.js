import { describe, it, expect } from "vitest";
import { filterMatrixPage, matrixPageTotals, shapeMatrixPage } from "./costingMatrixPage";
import { revenueComparison, revenueInputs } from "./costingMath";

const RATES = { itrRate: 0.08, itrAllowance: 250000 };

const read = (overrides = {}) => ({
  opportunity_id: "opp-1",
  sor_code: "SOR-101",
  sales_reference: "S04081",
  project_title: "BFP Command Bus",
  stage: "Bidding",
  entities: ["T3CK Group Inc"],
  final_offer_total: "2980000.00",
  final_acquire_total: "2338500.00",
  landed_cost_total: "0",
  bought_final_acquire_total: "0",
  items_bought: 0,
  items_total: 2,
  ipas_short: false,
  ...overrides,
});

describe("shapeMatrixPage", () => {
  it("works Planned and Actual Revenue with the maths the SOR's own summary uses", () => {
    const [row] = shapeMatrixPage([read({ landed_cost_total: "1100000.00", bought_final_acquire_total: "1000000.00", items_bought: 1, ipas_short: true })], RATES);

    // The database's totals are exactly what revenueInputs builds from a shaped matrix, so the same call gives the same answer.
    const matrix = {
      tenderLines: [{ final_offer_unit: 2980000, quantity: 1, components: [
        { final_acquire_unit: 1000000, quantity: 1, landed_cost: { total: 1100000, mark: "provisional" } },
        { final_acquire_unit: 1338500, quantity: 1 },
      ] }],
      costRows: [],
    };
    expect(row.comparison).toEqual(revenueComparison(revenueInputs(matrix, { ipasShort: true }), RATES));
    expect(row.comparison.planned).toBe(423100);
    expect(row.comparison.actual).toBe(323100);
    expect(row.comparison.difference).toBe(-100000);
    expect(row.comparison.actualLower).toBe(true);
    expect(row.comparison.estimate).toBe(true);
  });

  it("names the SOR and keeps a missing SO number as an empty string", () => {
    const [row] = shapeMatrixPage([read({ sales_reference: null })], RATES);
    expect(row).toMatchObject({ opportunityId: "opp-1", sorNumber: "SOR-101", soNumber: "", projectTitle: "BFP Command Bus", stage: "Bidding", finalOffer: 2980000 });
  });

  it("leaves every figure null while an input is blank, never zero", () => {
    const [row] = shapeMatrixPage([read({ final_offer_total: null })], RATES);
    expect(row.finalOffer).toBeNull();
    expect(row.comparison.planned).toBeNull();
    expect(row.comparison.actual).toBeNull();
    expect(row.comparison.difference).toBeNull();
    expect(row.comparison.actualLower).toBe(false);
  });
});

describe("filterMatrixPage", () => {
  const rows = shapeMatrixPage(
    [
      read(),
      read({ opportunity_id: "opp-2", sor_code: "SOR-102", sales_reference: "S04090", project_title: "Rescue vehicle", stage: "Awarded", entities: ["Rescue Co"], landed_cost_total: "1100000", bought_final_acquire_total: "1000000", items_bought: 1 }),
      read({ opportunity_id: "opp-3", sor_code: "SOR-103", sales_reference: null, project_title: "Water tanker", final_offer_total: null }),
    ],
    RATES,
  );
  const ids = (list) => list.map((r) => r.opportunityId);

  it("filters by stage, entity and Actual below Planned", () => {
    expect(ids(filterMatrixPage(rows, { stage: "Awarded" }))).toEqual(["opp-2"]);
    expect(ids(filterMatrixPage(rows, { entity: "Rescue Co" }))).toEqual(["opp-2"]);
    expect(ids(filterMatrixPage(rows, { belowPlanned: true }))).toEqual(["opp-2"]);
    expect(ids(filterMatrixPage(rows, {}))).toEqual(["opp-1", "opp-2", "opp-3"]);
  });

  it("searches the SOR number, SO number and project name, ignoring case", () => {
    expect(ids(filterMatrixPage(rows, { search: "sor-103" }))).toEqual(["opp-3"]);
    expect(ids(filterMatrixPage(rows, { search: "S04090" }))).toEqual(["opp-2"]);
    expect(ids(filterMatrixPage(rows, { search: "command" }))).toEqual(["opp-1"]);
    expect(ids(filterMatrixPage(rows, { search: "  " }))).toHaveLength(3);
  });

  it("finds an SOR from the SO number and project written together, the way Purchasing writes them", () => {
    expect(ids(filterMatrixPage(rows, { search: "S04081 BFP Command Bus" }))).toEqual(["opp-1"]);
  });
});

describe("matrixPageTotals", () => {
  it("adds the money columns of the rows given, leaves out a row with no figure and says how many", () => {
    const rows = shapeMatrixPage(
      [
        read(),
        read({ landed_cost_total: "1100000", bought_final_acquire_total: "1000000", items_bought: 1, ipas_short: true }),
        read({ final_offer_total: null, items_total: 3 }),
      ],
      RATES,
    );
    expect(matrixPageTotals(rows)).toEqual({
      count: 3,
      finalOffer: 5960000,
      planned: 846200,
      actual: 746200,
      difference: -100000,
      itemsBought: 1,
      itemsTotal: 7,
      estimate: true,
      incomplete: 1,
    });
  });

  it("is not an estimate when the only provisional row has no Actual figure", () => {
    const rows = shapeMatrixPage([read({ final_offer_total: null, ipas_short: true })], RATES);
    expect(matrixPageTotals(rows).estimate).toBe(false);
  });

  it("is all zeros for no rows", () => {
    expect(matrixPageTotals([])).toMatchObject({ count: 0, finalOffer: 0, planned: 0, actual: 0, difference: 0, estimate: false, incomplete: 0 });
  });
});
