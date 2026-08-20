// Pure commission-pool math. No database, no network — every value comes in
// as an argument and every result goes out as a plain number, so this can be
// tested directly against the policy's own worked examples.
//
// Commissionable Revenue divides VAT out of the contract value (the value is
// VAT-inclusive), then applies withholding on top of the VAT-exclusive
// amount — not a flat subtraction. This mirrors how the source policy
// resolved the same ambiguity when this math was first implemented
// elsewhere: VAT first, then withholding, both as percentage reductions.

/**
 * Throws unless a set of allocation percentages sums to 100 (within a small
 * rounding tolerance), so misconfiguration is caught immediately on save
 * rather than silently under- or over-allocating the pool.
 */
export function assertPercentagesSumTo100(percentages, { label = "Percentages", tolerance = 0.01 } = {}) {
  const total = percentages.reduce((sum, percent) => sum + percent, 0);
  if (Math.abs(total - 100) > tolerance) {
    throw new Error(`${label} must sum to 100% (currently ${total.toFixed(2)}%).`);
  }
}

export const RATE_TYPES = {
  VAT: "VAT",
  WITHHOLDING: "WITHHOLDING",
  POOL: "POOL",
};

export const RATE_TYPE_LABELS = {
  [RATE_TYPES.VAT]: "VAT",
  [RATE_TYPES.WITHHOLDING]: "Withholding (ITR)",
  [RATE_TYPES.POOL]: "Pool",
};

/**
 * Contract Value, less VAT (divided out), less Withholding (applied to the
 * VAT-exclusive amount).
 */
export function calculateCommissionableRevenue(contractValue, { vatPercent, withholdingPercent }) {
  const netOfVat = contractValue / (1 + vatPercent / 100);
  return netOfVat * (1 - withholdingPercent / 100);
}

/** The Commission Pool: a percentage of Commissionable Revenue. */
export function calculateCommissionPool(commissionableRevenue, poolPercent) {
  return commissionableRevenue * (poolPercent / 100);
}

/**
 * Splits the Commission Pool across Departments by each Department's
 * allocation percentage. `departments` is `[{ name, allocationPercent }]`.
 */
export function splitByDepartment(commissionPool, departments) {
  return departments.map((department) => ({
    name: department.name,
    allocationPercent: department.allocationPercent,
    amount: commissionPool * (department.allocationPercent / 100),
  }));
}

/**
 * Splits one Department's share across Positions within it by each
 * Position's allocation percentage. `positions` is `[{ name, allocationPercent }]`.
 */
export function splitByPosition(departmentAmount, positions) {
  return positions.map((position) => ({
    name: position.name,
    allocationPercent: position.allocationPercent,
    amount: departmentAmount * (position.allocationPercent / 100),
  }));
}

/**
 * Derives the project type from the support sales assignments:
 * - Strategic is always a manual override — if the current type is Strategic
 *   it is preserved regardless of support sales.
 * - If any support salesperson is assigned → Collaborative Project (CP).
 * - Otherwise → Single Salesperson Project (SSP).
 */
export function deriveProjectType({ supportSales1Id, supportSales2Id, currentProjectType } = {}) {
  if (currentProjectType === "STRATEGIC") return "STRATEGIC";
  if (supportSales1Id || supportSales2Id) return "CP";
  return "SSP";
}

/**
 * A Single Salesperson Project attributes the entire Sales department share
 * to the deal owner — there is no other role on the deal to split it with.
 */
export function splitSalesShareForSsp(salesDepartmentAmount) {
  return [{ role: "deal_owner", amount: salesDepartmentAmount }];
}

/**
 * Splits a Collaborative Project or Strategic opportunity's Sales department
 * share across deal owner, supporting salespeople, and sales director, per
 * the Commission Split percentages for that Project Type.
 *
 * `splits` is `[{ shareRole, percent }]`. `participants` is
 * `{ deal_owner, supporting_salespeople: [], sales_director }`, each an
 * employee record or null/empty.
 *
 * The two support-salesperson slots are an unordered pair, not distinct
 * roles: `supporting_salesperson`'s percentage is the combined share for
 * whichever of those slots are actually filled, divided evenly among them.
 * A role with no participant filling it (an empty slot, or a split row with
 * no matching role) contributes no share — its percentage isn't
 * redistributed to the other roles.
 */
export function splitSalesShareForRoles(salesDepartmentAmount, splits, participants) {
  const shares = [];

  for (const split of splits) {
    if (split.shareRole === "supporting_salesperson") {
      const supporters = (participants.supporting_salespeople || []).filter(Boolean);
      if (supporters.length === 0) continue;

      const totalAmount = salesDepartmentAmount * (split.percent / 100);
      const perPersonAmount = totalAmount / supporters.length;
      supporters.forEach((employee) => {
        shares.push({ role: "supporting_salesperson", employee, amount: perPersonAmount });
      });
      continue;
    }

    const employee = participants[split.shareRole];
    if (!employee) continue;

    shares.push({
      role: split.shareRole,
      employee,
      amount: salesDepartmentAmount * (split.percent / 100),
    });
  }

  return shares;
}

/**
 * The full per-opportunity breakdown: Commissionable Revenue, Commission
 * Pool, and the Department split. `departments` is `[{ name, allocationPercent }]`.
 */
export function calculateCommissionBreakdown({
  contractValue,
  vatPercent,
  withholdingPercent,
  poolPercent,
  departments,
}) {
  const commissionableRevenue = calculateCommissionableRevenue(contractValue, {
    vatPercent,
    withholdingPercent,
  });
  const commissionPool = calculateCommissionPool(commissionableRevenue, poolPercent);
  const departmentShares = splitByDepartment(commissionPool, departments);

  return { commissionableRevenue, commissionPool, departmentShares };
}

/**
 * Resolves effective rates for a given date from an array of dated rate records
 * [ { rate_type, percent, effective_from } ]
 */
export function resolveEffectiveRatesFromList(rateList = [], asOfDate) {
  const rates = {};
  for (const type of Object.values(RATE_TYPES)) {
    const matching = rateList
      .filter((r) => r.rate_type === type && (!r.effective_from || r.effective_from <= asOfDate))
      .sort((a, b) => (b.effective_from || "").localeCompare(a.effective_from || ""));
    const latest = matching[0];
    if (!latest) {
      throw new Error(`No effective Commission Rate found for ${type} as of ${asOfDate}.`);
    }
    rates[type] = Number(latest.percent);
  }
  return {
    vatPercent: rates[RATE_TYPES.VAT],
    withholdingPercent: rates[RATE_TYPES.WITHHOLDING],
    poolPercent: rates[RATE_TYPES.POOL],
  };
}

const REALIZED_STATUSES = [
  "AWARDED",
  "PO_RECEIVED",
  "PROJECT_DELIVERY",
  "COLLECTION",
  "CLOSED_WON",
  "RETENTION",
];

/**
 * Aggregates commission metrics across a collection of opportunities.
 * Sums independent per-opportunity calculations based on each opportunity's
 * Contract Date (or currentDate if unawarded).
 */
export function aggregateOpportunityCommissions({
  opportunities = [],
  ratesResolver,
  departments = [],
  splitsByProjectType = {},
  scope = "REALIZED", // "REALIZED" | "FORECAST" | "ALL"
  currentDate = new Date().toISOString().slice(0, 10),
  dateFilter = null, // { startDate, endDate, dateField = "contract_date" }
} = {}) {
  const filteredOpps = opportunities.filter((opp) => {
    if (opp.status === "CLOSED_LOST") return false;

    if (scope === "REALIZED") {
      if (!REALIZED_STATUSES.includes(opp.status)) return false;
    }

    if (dateFilter?.startDate || dateFilter?.endDate) {
      const targetDate = opp[dateFilter.dateField || "contract_date"] || opp.created_at?.slice(0, 10);
      if (dateFilter.startDate && targetDate && targetDate < dateFilter.startDate) return false;
      if (dateFilter.endDate && targetDate && targetDate > dateFilter.endDate) return false;
    }

    return true;
  });

  let totalContractValue = 0;
  let totalCommissionableRevenue = 0;
  let totalCommissionPool = 0;
  let wonDealsCount = 0;

  const salesDeptIndex = departments.findIndex(
    (d) => d.key === "sales" || d.name?.toLowerCase() === "sales",
  );
  const salesDeptName = salesDeptIndex !== -1 ? departments[salesDeptIndex].name : "Sales";

  const departmentTotalsMap = {};
  for (const dept of departments) {
    departmentTotalsMap[dept.name] = {
      name: dept.name,
      allocationPercent: dept.allocationPercent,
      amount: 0,
      isSales: dept.key === "sales" || dept.name?.toLowerCase() === "sales",
    };
  }

  const salesEmployeesMap = new Map();
  const dealLedger = [];

  for (const opp of filteredOpps) {
    const isWon = REALIZED_STATUSES.includes(opp.status);
    if (isWon) wonDealsCount += 1;

    const contractValue = Number(opp.expected_value) || 0;
    totalContractValue += contractValue;

    const asOfDate = opp.contract_date || currentDate;
    const rates = typeof ratesResolver === "function" ? ratesResolver(asOfDate) : ratesResolver;

    const breakdown = calculateCommissionBreakdown({
      contractValue,
      ...rates,
      departments,
    });

    totalCommissionableRevenue += breakdown.commissionableRevenue;
    totalCommissionPool += breakdown.commissionPool;

    for (const share of breakdown.departmentShares) {
      if (departmentTotalsMap[share.name]) {
        departmentTotalsMap[share.name].amount += share.amount;
      }
    }

    const salesShareAmount = breakdown.departmentShares[salesDeptIndex]?.amount || 0;

    const dealOwner = opp.deal_owner || null;
    const support1 = opp.support_1 || null;
    const support2 = opp.support_2 || null;
    const salesDirector = opp.sales_director || null;

    const projectType = opp.project_type || "SSP";
    const splits = splitsByProjectType[projectType] || [];
    const salesRoleShares = splitSalesShareForRoles(salesShareAmount, splits, {
      deal_owner: dealOwner,
      supporting_salespeople: [support1, support2],
      sales_director: salesDirector,
    });

    dealLedger.push({
      id: opp.id,
      opportunityNo: opp.opportunity_no,
      projectTitle: opp.project_title,
      clientName: opp.client_name,
      status: opp.status,
      projectType: opp.project_type,
      contractDate: opp.contract_date,
      createdAt: opp.created_at,
      contractValue,
      rates,
      commissionableRevenue: breakdown.commissionableRevenue,
      commissionPool: breakdown.commissionPool,
      departmentShares: breakdown.departmentShares,
      salesRoleShares,
      salesShareAmount,
      participants: {
        dealOwner,
        support1,
        support2,
        salesDirector,
      },
    });

    for (const roleShare of salesRoleShares) {
      if (!roleShare.employee?.id) continue;
      const emp = roleShare.employee;
      if (!salesEmployeesMap.has(emp.id)) {
        salesEmployeesMap.set(emp.id, {
          employeeId: emp.id,
          name: emp.name,
          avatarPath: emp.avatar_path || emp.avatarPath,
          wonDealsCount: 0,
          totalDealsCount: 0,
          totalContractValue: 0,
          totalCommissionShare: 0,
          roleBreakdown: {
            deal_owner: 0,
            supporting_salesperson: 0,
            sales_director: 0,
          },
          dealIds: new Set(),
        });
      }

      const empEntry = salesEmployeesMap.get(emp.id);
      empEntry.totalCommissionShare += roleShare.amount;
      if (empEntry.roleBreakdown[roleShare.role] !== undefined) {
        empEntry.roleBreakdown[roleShare.role] += roleShare.amount;
      }
      if (!empEntry.dealIds.has(opp.id)) {
        empEntry.dealIds.add(opp.id);
        empEntry.totalDealsCount += 1;
        if (isWon) empEntry.wonDealsCount += 1;
        empEntry.totalContractValue += contractValue;
      }
    }
  }

  const salesEmployees = Array.from(salesEmployeesMap.values())
    .map((e) => ({
      ...e,
      dealIds: Array.from(e.dealIds),
    }))
    .sort((a, b) => b.totalCommissionShare - a.totalCommissionShare);

  const departmentTotals = Object.values(departmentTotalsMap);
  const salesDeptTotal = departmentTotalsMap[salesDeptName]?.amount || 0;
  const otherDeptsTotal = totalCommissionPool - salesDeptTotal;

  return {
    totalDealsCount: filteredOpps.length,
    wonDealsCount,
    totalContractValue,
    totalCommissionableRevenue,
    totalCommissionPool,
    salesDeptTotal,
    otherDeptsTotal,
    departmentTotals,
    salesEmployees,
    dealLedger,
  };
}
