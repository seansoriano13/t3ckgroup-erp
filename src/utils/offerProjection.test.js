import { describe, it, expect } from "vitest";
import { projectOffer } from "./offerProjection";
import { summary } from "./costingMath";

const RATES = { vatDivisor: 1.12, taxRate: 0.05, retentionRate: 0.01, itrRate: 0.25, itrAllowance: 0 };

// One Tender Line (2 x Final Offer 150,000 = 300,000) with one Component (2 x Acquire 60,000, Final Acquire 60,000)
const component = { id: "c1", quantity: 2, acquire_unit: 60000, final_acquire_unit: 60000 };
const other = { id: "c2", quantity: 1, acquire_unit: 10000, final_acquire_unit: 10000 };
const line = { id: "l1", quantity: 2, final_offer_unit: 150000, components: [component, other] };

function closedBookMatrix() {
  const matrix = { tenderLines: [line], costRows: [], money: { marketing: 0, opex: 0 }, rates: RATES };
  return { ...matrix, summary: summary(matrix, RATES) };
}

const priceTierMatrix = () => ({ tenderLines: [{ id: "l1", quantity: 2, components: [{ id: "c1", quantity: 2 }] }] });

const row = { offer_id: "o1", acquire_unit: 50000, markup_price_unit: 62500 };

describe("what the Purchasing tier sees", () => {
  it("shows the Acquire and the Markup Price the database served", () => {
    const p = projectOffer({ projection: row, componentId: "c1", matrix: priceTierMatrix() });
    expect(p.acquireUnit).toBe(50000);
    expect(p.markupPriceUnit).toBe(62500);
  });

  it("gives no margin and no summary when the matrix has no summary", () => {
    const p = projectOffer({ projection: row, componentId: "c1", matrix: priceTierMatrix() });
    expect(p.margin).toBeNull();
    expect(p.summary).toBeNull();
  });

  it("gives no margin and no summary when there is no matrix at all", () => {
    const p = projectOffer({ projection: row, componentId: "c1", matrix: null });
    expect(p.margin).toBeNull();
    expect(p.summary).toBeNull();
  });
});

describe("what the Closed Book also sees", () => {
  it("projects the Tender Line margin from the line's Final Offer and the swapped Acquire", () => {
    const p = projectOffer({ projection: row, componentId: "c1", matrix: closedBookMatrix() });
    // now: 300,000 - (120,000 + 10,000) = 170,000; if it won: 300,000 - (100,000 + 10,000) = 190,000
    expect(p.margin.current).toEqual({ amount: 170000, percent: 56.67 });
    expect(p.margin.projected).toEqual({ amount: 190000, percent: 63.33 });
  });

  it("projects what the matrix summary would become", () => {
    const matrix = closedBookMatrix();
    const p = projectOffer({ projection: row, componentId: "c1", matrix });
    expect(p.summary.operationalExpenses.from).toBe(matrix.summary.operationalExpenses);
    expect(p.summary.operationalExpenses.to).toBe(110000);
    // the summary's own arithmetic, over the matrix with the Component taken at this Offer's Acquire
    const swapped = {
      ...matrix,
      tenderLines: [{ ...line, components: [{ ...component, acquire_unit: 50000, final_acquire_unit: 50000 }, other] }],
    };
    expect(p.summary.revenue.to).toBe(summary(swapped, RATES).revenue);
    expect(p.summary.revenue.from).toBe(matrix.summary.revenue);
  });

  it("does not change the matrix it was given", () => {
    const matrix = closedBookMatrix();
    const before = JSON.stringify(matrix);
    projectOffer({ projection: row, componentId: "c1", matrix });
    expect(JSON.stringify(matrix)).toBe(before);
  });

  it("gives no margin when the line has no Final Offer yet, rather than zero", () => {
    const matrix = closedBookMatrix();
    matrix.tenderLines = [{ ...line, final_offer_unit: null }];
    const p = projectOffer({ projection: row, componentId: "c1", matrix });
    expect(p.margin.projected).toEqual({ amount: null, percent: null });
  });

  it("gives no margin when a sibling Component has no Acquire, rather than a wrong one", () => {
    const matrix = closedBookMatrix();
    matrix.tenderLines = [{ ...line, components: [component, { ...other, acquire_unit: null }] }];
    const p = projectOffer({ projection: row, componentId: "c1", matrix });
    expect(p.margin.projected.amount).toBeNull();
  });

  it("finds nothing to project when the Component is not in the matrix", () => {
    const p = projectOffer({ projection: row, componentId: "missing", matrix: closedBookMatrix() });
    expect(p.margin).toBeNull();
    expect(p.summary).toBeNull();
  });
});

describe("an Offer with no figure", () => {
  const blank = { offer_id: "o2", acquire_unit: null, markup_price_unit: null };

  it("shows no projection rather than a wrong one", () => {
    expect(projectOffer({ projection: blank, componentId: "c1", matrix: closedBookMatrix() })).toBeNull();
  });

  it("shows none when the database served nothing for it", () => {
    expect(projectOffer({ projection: null, componentId: "c1", matrix: closedBookMatrix() })).toBeNull();
    expect(projectOffer({ projection: undefined, componentId: "c1", matrix: null })).toBeNull();
  });
});
