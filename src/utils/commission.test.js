import { describe, expect, it } from "vitest";
import {
  assertPercentagesSumTo100,
  calculateCommissionableRevenue,
  calculateCommissionBreakdown,
  calculateCommissionPool,
  deriveProjectType,
  resolveEffectiveRatesFromList,
  aggregateOpportunityCommissions,
  splitByDepartment,
  splitByPosition,
  splitSalesShareForRoles,
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

describe("deriveProjectType", () => {
  it("returns SSP when no support salespeople are present", () => {
    expect(deriveProjectType({ supportSales1Id: null, supportSales2Id: null })).toBe("SSP");
  });

  it("returns SSP when support IDs are empty strings", () => {
    expect(deriveProjectType({ supportSales1Id: "", supportSales2Id: "" })).toBe("SSP");
  });

  it("returns CP when support_sales_1 is filled", () => {
    expect(deriveProjectType({ supportSales1Id: "abc-123", supportSales2Id: null })).toBe("CP");
  });

  it("returns CP when support_sales_2 is filled", () => {
    expect(deriveProjectType({ supportSales1Id: null, supportSales2Id: "def-456" })).toBe("CP");
  });

  it("returns CP when both support sales are filled", () => {
    expect(deriveProjectType({ supportSales1Id: "abc", supportSales2Id: "def" })).toBe("CP");
  });

  it("preserves Strategic override even when no support sales are present", () => {
    expect(deriveProjectType({ supportSales1Id: null, supportSales2Id: null, currentProjectType: "STRATEGIC" })).toBe("STRATEGIC");
  });

  it("preserves Strategic override when support sales are present", () => {
    expect(deriveProjectType({ supportSales1Id: "abc", supportSales2Id: "def", currentProjectType: "STRATEGIC" })).toBe("STRATEGIC");
  });

  it("ignores currentProjectType when it is SSP (auto-derives normally)", () => {
    expect(deriveProjectType({ supportSales1Id: "abc", supportSales2Id: null, currentProjectType: "SSP" })).toBe("CP");
  });

  it("ignores currentProjectType when it is CP (auto-derives normally)", () => {
    expect(deriveProjectType({ supportSales1Id: null, supportSales2Id: null, currentProjectType: "CP" })).toBe("SSP");
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

describe("resolveEffectiveRatesFromList", () => {
  const rateList = [
    { rate_type: "VAT", percent: 12, effective_from: "2025-01-01" },
    { rate_type: "WITHHOLDING", percent: 8, effective_from: "2025-01-01" },
    { rate_type: "POOL", percent: 1, effective_from: "2025-01-01" },
    { rate_type: "VAT", percent: 10, effective_from: "2026-06-01" },
    { rate_type: "POOL", percent: 1.5, effective_from: "2026-06-01" },
  ];

  it("resolves rates effective on a given historical date", () => {
    const rates2025 = resolveEffectiveRatesFromList(rateList, "2025-05-15");
    expect(rates2025).toEqual({ vatPercent: 12, withholdingPercent: 8, poolPercent: 1 });

    const rates2026 = resolveEffectiveRatesFromList(rateList, "2026-07-01");
    expect(rates2026).toEqual({ vatPercent: 10, withholdingPercent: 8, poolPercent: 1.5 });
  });

  it("throws when a rate type is missing for the date", () => {
    expect(() => resolveEffectiveRatesFromList(rateList, "2024-01-01")).toThrow(
      /No effective Commission Rate found for VAT/,
    );
  });
});

describe("aggregateOpportunityCommissions", () => {
  const RATES = { vatPercent: 12, withholdingPercent: 8, poolPercent: 1 };
  const SPLITS = {
    SSP: [
      { shareRole: "deal_owner", percent: 80 },
      { shareRole: "sales_director", percent: 20 },
    ],
    CP: [
      { shareRole: "deal_owner", percent: 60 },
      { shareRole: "supporting_salesperson", percent: 30 },
      { shareRole: "sales_director", percent: 10 },
    ],
    STRATEGIC: [
      { shareRole: "deal_owner", percent: 50 },
      { shareRole: "supporting_salesperson", percent: 30 },
      { shareRole: "sales_director", percent: 20 },
    ],
  };

  const alice = { id: "emp-alice", name: "Alice", avatar_path: null };
  const bob = { id: "emp-bob", name: "Bob", avatar_path: null };
  const carol = { id: "emp-carol", name: "Carol", avatar_path: null };
  const daveDirector = { id: "emp-dave", name: "Dave Director", avatar_path: null };

  const opp1 = {
    id: "opp-1",
    opportunity_no: "SOR-001",
    project_title: "SSP Won Deal",
    client_name: "Client A",
    expected_value: 1_000_000,
    status: "AWARDED",
    project_type: "SSP",
    contract_date: "2026-03-01",
    deal_owner: alice,
    support_1: null,
    support_2: null,
    sales_director: daveDirector,
  };

  const opp2 = {
    id: "opp-2",
    opportunity_no: "SOR-002",
    project_title: "CP Won Deal",
    client_name: "Client B",
    expected_value: 2_000_000,
    status: "CLOSED_WON",
    project_type: "CP",
    contract_date: "2026-03-15",
    deal_owner: bob,
    support_1: alice,
    support_2: carol,
    sales_director: daveDirector,
  };

  const oppPipeline = {
    id: "opp-3",
    opportunity_no: "SOR-003",
    project_title: "Early Lead",
    client_name: "Client C",
    expected_value: 500_000,
    status: "LEAD",
    project_type: "SSP",
    contract_date: null,
    created_at: "2026-03-20",
    deal_owner: alice,
  };

  const oppLost = {
    id: "opp-4",
    opportunity_no: "SOR-004",
    project_title: "Lost Deal",
    client_name: "Client D",
    expected_value: 800_000,
    status: "CLOSED_LOST",
    project_type: "SSP",
    contract_date: null,
    deal_owner: alice,
  };

  it("aggregates realized deals by default (excluding pipeline leads and closed lost)", () => {
    const agg = aggregateOpportunityCommissions({
      opportunities: [opp1, opp2, oppPipeline, oppLost],
      ratesResolver: () => RATES,
      departments: DEPARTMENTS,
      splitsByProjectType: SPLITS,
      scope: "REALIZED",
    });

    expect(agg.totalDealsCount).toBe(2);
    expect(agg.wonDealsCount).toBe(2);
    expect(agg.totalContractValue).toBe(3_000_000);

    // Opp1: 1M -> CommRev = 821,428.57, Pool = 8,214.29
    // Opp2: 2M -> CommRev = 1,642,857.14, Pool = 16,428.57
    // Total CommRev = 2,464,285.71, Total Pool = 24,642.86
    expect(agg.totalCommissionableRevenue).toBeCloseTo(2_464_285.71, 2);
    expect(agg.totalCommissionPool).toBeCloseTo(24_642.86, 2);

    // Sales Department total (50% of pool): 12,321.43
    expect(agg.salesDeptTotal).toBeCloseTo(12_321.43, 2);
    expect(agg.otherDeptsTotal).toBeCloseTo(12_321.43, 2);

    // Regulation CCPR-2026-001 splits, applied identically regardless of
    // project type — SSP is 80% deal owner / 20% sales director, no
    // supporting-salesperson row (see supabase/migrations/0032).
    // Alice earned:
    // - From opp1 (SSP Deal Owner, 80% of Sales share 4,107.14): 3,285.71
    // - From opp2 (CP Support Rep, 30% split / 2 supporters = 15% of Sales share 8,214.29): 1,232.14
    // Total Alice = 4,517.86
    const aliceMetrics = agg.salesEmployees.find((e) => e.employeeId === "emp-alice");
    expect(aliceMetrics).toBeDefined();
    expect(aliceMetrics.totalCommissionShare).toBeCloseTo(4_517.86, 2);
    expect(aliceMetrics.wonDealsCount).toBe(2);
    expect(aliceMetrics.totalContractValue).toBe(3_000_000);
    expect(aliceMetrics.roleBreakdown.deal_owner).toBeCloseTo(3_285.71, 2);
    expect(aliceMetrics.roleBreakdown.supporting_salesperson).toBeCloseTo(1_232.14, 2);

    // Bob (Opp2 Deal Owner: 60% of Sales share 8,214.29): 4,928.57
    const bobMetrics = agg.salesEmployees.find((e) => e.employeeId === "emp-bob");
    expect(bobMetrics.totalCommissionShare).toBeCloseTo(4_928.57, 2);

    // Dave Director earns his 20% Sales Director share on both deals:
    // - Opp1 (SSP Sales Director, 20% of Sales share 4,107.14): 821.43
    // - Opp2 (CP Sales Director, 10% of Sales share 8,214.29): 821.43
    // Total Dave = 1,642.86
    const daveMetrics = agg.salesEmployees.find((e) => e.employeeId === "emp-dave");
    expect(daveMetrics.totalCommissionShare).toBeCloseTo(1_642.86, 2);

    // Zero discrepancy check: Sum of all rep shares = sales department total
    const sumRepShares = agg.salesEmployees.reduce((sum, e) => sum + e.totalCommissionShare, 0);
    expect(sumRepShares).toBeCloseTo(agg.salesDeptTotal, 2);
  });

  it("includes early pipeline deals when scope is FORECAST", () => {
    const agg = aggregateOpportunityCommissions({
      opportunities: [opp1, opp2, oppPipeline, oppLost],
      ratesResolver: () => RATES,
      departments: DEPARTMENTS,
      splitsByProjectType: SPLITS,
      scope: "FORECAST",
    });

    expect(agg.totalDealsCount).toBe(3); // excludes oppLost
    expect(agg.wonDealsCount).toBe(2);
    expect(agg.totalContractValue).toBe(3_500_000);
  });

  it("filters by date range correctly", () => {
    const agg = aggregateOpportunityCommissions({
      opportunities: [opp1, opp2],
      ratesResolver: () => RATES,
      departments: DEPARTMENTS,
      splitsByProjectType: SPLITS,
      dateFilter: { startDate: "2026-03-10", endDate: "2026-03-31" },
    });

    expect(agg.totalDealsCount).toBe(1);
    expect(agg.dealLedger[0].id).toBe("opp-2");
  });
});
