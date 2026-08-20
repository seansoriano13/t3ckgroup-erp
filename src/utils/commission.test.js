import { describe, expect, it } from "vitest";
import {
  assertPercentagesSumTo100,
  calculateCommissionableRevenue,
  calculateCommissionBreakdown,
  calculateCommissionPool,
  splitByDepartment,
  splitByPosition,
  splitSalesShareForRoles,
  splitSalesShareForSsp,
} from "./commission";

const DEPARTMENTS = [
  { name: "Sales", allocationPercent: 50 },
  { name: "Operations", allocationPercent: 25 },
  { name: "Administration", allocationPercent: 15 },
  { name: "Human Resources", allocationPercent: 5 },
  { name: "Finance & Accounting", allocationPercent: 5 },
];

describe("calculateCommissionableRevenue", () => {
  it("divides out VAT, then applies withholding to the VAT-exclusive amount", () => {
    // 1,000,000 / 1.12 = 892,857.142857... (VAT-exclusive)
    // 892,857.142857... * 0.92 = 821,428.571428... (after withholding)
    const revenue = calculateCommissionableRevenue(1_000_000, {
      vatPercent: 12,
      withholdingPercent: 8,
    });

    expect(revenue).toBeCloseTo(821_428.57, 2);
  });

  it("returns the full contract value when VAT and withholding are both zero", () => {
    const revenue = calculateCommissionableRevenue(500_000, {
      vatPercent: 0,
      withholdingPercent: 0,
    });

    expect(revenue).toBeCloseTo(500_000, 2);
  });
});

describe("calculateCommissionPool", () => {
  it("takes a percentage of Commissionable Revenue", () => {
    expect(calculateCommissionPool(821_428.57, 1)).toBeCloseTo(8_214.29, 2);
  });
});

describe("assertPercentagesSumTo100", () => {
  it("does not throw when percentages sum to exactly 100", () => {
    expect(() => assertPercentagesSumTo100([50, 25, 15, 5, 5])).not.toThrow();
  });

  it("tolerates tiny rounding error", () => {
    expect(() => assertPercentagesSumTo100([33.34, 33.33, 33.33])).not.toThrow();
  });

  it("throws with the label and total when the sum is off", () => {
    expect(() => assertPercentagesSumTo100([50, 25], { label: "Department allocations" })).toThrow(
      /Department allocations must sum to 100% \(currently 75\.00%\)/,
    );
  });
});

describe("splitByDepartment", () => {
  const POOL = 8_214.285714285714;

  it("splits the pool across departments by allocation percentage", () => {
    const shares = splitByDepartment(POOL, DEPARTMENTS);

    expect(shares).toEqual([
      { name: "Sales", allocationPercent: 50, amount: expect.closeTo(4_107.14, 2) },
      { name: "Operations", allocationPercent: 25, amount: expect.closeTo(2_053.57, 2) },
      { name: "Administration", allocationPercent: 15, amount: expect.closeTo(1_232.14, 2) },
      { name: "Human Resources", allocationPercent: 5, amount: expect.closeTo(410.71, 2) },
      { name: "Finance & Accounting", allocationPercent: 5, amount: expect.closeTo(410.71, 2) },
    ]);
  });

  it("sums back to the full pool", () => {
    const shares = splitByDepartment(POOL, DEPARTMENTS);
    const total = shares.reduce((sum, share) => sum + share.amount, 0);

    expect(total).toBeCloseTo(POOL, 1);
  });
});

describe("splitByPosition", () => {
  it("splits a department's share across positions by allocation percentage", () => {
    const positions = [
      { name: "Operations Manager", allocationPercent: 60 },
      { name: "Operations Staff", allocationPercent: 40 },
    ];

    const shares = splitByPosition(2_000, positions);

    expect(shares).toEqual([
      { name: "Operations Manager", allocationPercent: 60, amount: 1_200 },
      { name: "Operations Staff", allocationPercent: 40, amount: 800 },
    ]);
  });
});

describe("splitSalesShareForSsp", () => {
  it("attributes the entire Sales share to the deal owner", () => {
    expect(splitSalesShareForSsp(4_107.14)).toEqual([{ role: "deal_owner", amount: 4_107.14 }]);
  });
});

describe("splitSalesShareForRoles", () => {
  const CP_SPLITS = [
    { shareRole: "deal_owner", percent: 40 },
    { shareRole: "supporting_salesperson", percent: 30 },
    { shareRole: "sales_director", percent: 30 },
  ];

  it("splits the supporting-salesperson percentage evenly between two filled slots", () => {
    const owner = { id: "owner" };
    const support1 = { id: "support-1" };
    const support2 = { id: "support-2" };
    const director = { id: "director" };

    const shares = splitSalesShareForRoles(1_000, CP_SPLITS, {
      deal_owner: owner,
      supporting_salespeople: [support1, support2],
      sales_director: director,
    });

    expect(shares).toEqual([
      { role: "deal_owner", employee: owner, amount: 400 },
      { role: "supporting_salesperson", employee: support1, amount: 150 },
      { role: "supporting_salesperson", employee: support2, amount: 150 },
      { role: "sales_director", employee: director, amount: 300 },
    ]);
  });

  it("gives the full supporting-salesperson percentage to a single filled slot", () => {
    const owner = { id: "owner" };
    const support1 = { id: "support-1" };

    const shares = splitSalesShareForRoles(1_000, CP_SPLITS, {
      deal_owner: owner,
      supporting_salespeople: [support1, null],
      sales_director: null,
    });

    expect(shares).toEqual([
      { role: "deal_owner", employee: owner, amount: 400 },
      { role: "supporting_salesperson", employee: support1, amount: 300 },
    ]);
  });

  it("drops a role entirely when no participant fills it, without redistributing its percentage", () => {
    const owner = { id: "owner" };

    const shares = splitSalesShareForRoles(1_000, CP_SPLITS, {
      deal_owner: owner,
      supporting_salespeople: [],
      sales_director: null,
    });

    expect(shares).toEqual([{ role: "deal_owner", employee: owner, amount: 400 }]);
  });
});

describe("calculateCommissionBreakdown", () => {
  it("produces Commissionable Revenue, the Pool, and the department split from a contract value", () => {
    const breakdown = calculateCommissionBreakdown({
      contractValue: 1_000_000,
      vatPercent: 12,
      withholdingPercent: 8,
      poolPercent: 1,
      departments: DEPARTMENTS,
    });

    expect(breakdown.commissionableRevenue).toBeCloseTo(821_428.57, 2);
    expect(breakdown.commissionPool).toBeCloseTo(8_214.29, 2);
    expect(breakdown.departmentShares.find((share) => share.name === "Sales").amount).toBeCloseTo(4_107.14, 2);
  });

  it("returns a zero pool for a zero-value opportunity", () => {
    const breakdown = calculateCommissionBreakdown({
      contractValue: 0,
      vatPercent: 12,
      withholdingPercent: 8,
      poolPercent: 1,
      departments: DEPARTMENTS,
    });

    expect(breakdown.commissionPool).toBe(0);
  });
});
