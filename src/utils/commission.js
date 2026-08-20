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
