import { supabase } from "../lib/supabase";
import {
  RATE_TYPES,
  assertPercentagesSumTo100,
  calculateCommissionBreakdown,
  splitSalesShareForRoles,
  resolveEffectiveRatesFromList,
  aggregateOpportunityCommissions,
} from "../utils/commission";
import { getCurrentLocalDate } from "../utils/formatDate";

const RATE_TYPE_LIST = [RATE_TYPES.VAT, RATE_TYPES.WITHHOLDING, RATE_TYPES.POOL];

// Retention (issue #42) is creatable and listable like any other rate, but
// deliberately absent from RATE_TYPE_LIST above: that list is what
// getEffectiveRates treats as required, and a Retention rate is optional —
// read only by Project Evaluation.
const CREATABLE_RATE_TYPES = [...RATE_TYPE_LIST, RATE_TYPES.RETENTION];

/**
 * Throws unless `actorId` is a Super Admin. This is enforced independently
 * at the database via RLS (see supabase/migrations/0028, 0031) — this check
 * exists so the failure is immediate, testable without a real database, and
 * doesn't depend on trusting a client-supplied permission flag.
 */
async function requireSuperAdmin(actorId) {
  const { data, error } = await supabase
    .from("employees")
    .select("is_super_admin")
    .eq("id", actorId)
    .single();
  if (error) throw error;

  if (!data?.is_super_admin) {
    throw new Error("Only a Super Admin can make this change.");
  }
}

/**
 * A "Sales Director" isn't a flag on `employees` — it's whoever is actually
 * set as `sales_director_id` on at least one opportunity. Checked here
 * rather than trusting a client-supplied role, for the same reason as
 * requireSuperAdmin.
 *
 * Scratch and Retail SORs are excluded (issue #36 migration 0046; issue #171)
 * because this is an authorization check rather than a report: a deal drawn
 * on the Flow Canvas to watch a Stage fire, or a Shopee order approved
 * through the retail queue, must not be able to grant somebody the
 * Commission Dashboard as a side effect of being named on it.
 */
async function isSalesDirector(actorId) {
  const { data, error } = await supabase
    .from("sales_opportunities")
    .select("id")
    .eq("sales_director_id", actorId)
    .eq("is_scratch", false)
    .eq("is_retail", false)
    .limit(1);
  if (error) throw error;

  return (data?.length || 0) > 0;
}

/** Throws unless `actorId` is a Super Admin or a Sales Director (see isSalesDirector). */
async function requireSalesDirectorOrSuperAdmin(actorId) {
  const { data, error } = await supabase
    .from("employees")
    .select("is_super_admin")
    .eq("id", actorId)
    .single();
  if (error) throw error;

  if (data?.is_super_admin) return;
  if (await isSalesDirector(actorId)) return;

  throw new Error("Only a Sales Director or Super Admin can edit the Commission Split.");
}

/**
 * The Commission Rate (VAT, Withholding, Pool) in force as of a given date —
 * the latest row of each type whose effective-from date is on or before it.
 */
async function getEffectiveRates(asOfDate = getCurrentLocalDate()) {
  const { data, error } = await supabase
    .from("commission_rates")
    .select("rate_type, percent, effective_from")
    .lte("effective_from", asOfDate)
    .order("effective_from", { ascending: false });
  if (error) throw error;

  const rates = {};
  for (const type of RATE_TYPE_LIST) {
    const row = data.find((r) => r.rate_type === type);
    if (!row) {
      throw new Error(`No effective Commission Rate found for ${type} as of ${asOfDate}.`);
    }
    rates[type] = Number(row.percent);
  }

  return {
    vatPercent: rates[RATE_TYPES.VAT],
    withholdingPercent: rates[RATE_TYPES.WITHHOLDING],
    poolPercent: rates[RATE_TYPES.POOL],
  };
}

/**
 * The Retention rate in force as of a date, or null if none has ever been
 * set (issue #42). Read only by Project Evaluation — getEffectiveRates above
 * never calls this, so a Commission Pool figure is never affected by whether
 * a Retention rate exists.
 */
async function getEffectiveRetentionPercent(asOfDate = getCurrentLocalDate()) {
  const { data, error } = await supabase
    .from("commission_rates")
    .select("percent, effective_from")
    .eq("rate_type", RATE_TYPES.RETENTION)
    .lte("effective_from", asOfDate)
    .order("effective_from", { ascending: false })
    .limit(1);
  if (error) throw error;

  return data?.[0] ? Number(data[0].percent) : null;
}

/** The current Commission Department allocations. */
async function getDepartments() {
  const { data, error } = await supabase
    .from("commission_departments")
    .select("id, key, name, allocation_percent")
    .order("name", { ascending: true });
  if (error) throw error;

  return data.map((department) => ({
    id: department.id,
    key: department.key,
    name: department.name,
    allocationPercent: Number(department.allocation_percent),
  }));
}

/** The Commission Split percentages (Sales role → percent) for a Project Type. */
async function getSplitsForProjectType(projectType) {
  const { data, error } = await supabase
    .from("commission_splits")
    .select("share_role, percent")
    .eq("project_type", projectType);
  if (error) throw error;

  return data.map((split) => ({ shareRole: split.share_role, percent: Number(split.percent) }));
}

/** Every Commission Rate ever recorded, most recent first — for the admin history view. */
async function listRateHistory() {
  const { data, error } = await supabase
    .from("commission_rates")
    .select("id, rate_type, percent, effective_from")
    .order("effective_from", { ascending: false })
    .order("rate_type", { ascending: true });
  if (error) throw error;

  return data;
}

/** Adds a new dated Commission Rate row. Super-Admin-only. */
async function createRate({ rateType, percent, effectiveFrom }, actorId) {
  await requireSuperAdmin(actorId);

  if (!CREATABLE_RATE_TYPES.includes(rateType)) {
    throw new Error(`Rate type must be one of ${CREATABLE_RATE_TYPES.join(", ")}.`);
  }
  if (!effectiveFrom) {
    throw new Error("Effective-from date is required.");
  }

  const { data, error } = await supabase
    .from("commission_rates")
    .insert({ rate_type: rateType, percent, effective_from: effectiveFrom })
    .select()
    .single();
  if (error) throw error;

  return data;
}

/**
 * Updates the allocation percentages of the existing Commission Departments
 * (there is no "add a department" flow — the set is fixed, only the split
 * between them changes). Validates the percentages sum to 100 before writing
 * anything. Super-Admin-only. Every entry must carry the `id` from
 * getDepartments() — updates go by id, never by name, since name is the one
 * field this screen lets a Super Admin freely rename.
 */
async function saveDepartmentAllocations(departments, actorId) {
  await requireSuperAdmin(actorId);

  assertPercentagesSumTo100(
    departments.map((department) => department.allocationPercent),
    { label: "Department allocations" },
  );

  for (const department of departments) {
    const { error } = await supabase
      .from("commission_departments")
      .update({ name: department.name, allocation_percent: department.allocationPercent })
      .eq("id", department.id);
    if (error) throw error;
  }

  return getDepartments();
}

/** The Commission Positions within one Commission Department. */
async function getPositions(departmentId) {
  const { data, error } = await supabase
    .from("commission_positions")
    .select("id, name, allocation_percent")
    .eq("department_id", departmentId)
    .order("name", { ascending: true });
  if (error) throw error;

  return data.map((position) => ({
    id: position.id,
    name: position.name,
    allocationPercent: Number(position.allocation_percent),
  }));
}

/**
 * Replaces the full set of Commission Positions within one Department: adds
 * entries with no `id`, updates entries that have one, and deletes any
 * existing position not present in `positions` (so removing a row in the
 * editor actually removes it, not just hides it). Validates the percentages
 * sum to 100 before writing anything. Super-Admin-only.
 */
async function savePositionAllocations(departmentId, positions, actorId) {
  await requireSuperAdmin(actorId);

  assertPercentagesSumTo100(
    positions.map((position) => position.allocationPercent),
    { label: "Position allocations" },
  );

  const existing = positions.filter((position) => position.id);
  const fresh = positions.filter((position) => !position.id);

  const current = await getPositions(departmentId);
  const keptIds = new Set(existing.map((position) => position.id));
  const toDeleteIds = current.filter((position) => !keptIds.has(position.id)).map((position) => position.id);
  if (toDeleteIds.length > 0) {
    const { error } = await supabase.from("commission_positions").delete().in("id", toDeleteIds);
    if (error) throw error;
  }

  for (const position of existing) {
    const { error } = await supabase
      .from("commission_positions")
      .update({ name: position.name, allocation_percent: position.allocationPercent })
      .eq("id", position.id);
    if (error) throw error;
  }

  if (fresh.length > 0) {
    const { error } = await supabase.from("commission_positions").insert(
      fresh.map((position) => ({
        department_id: departmentId,
        name: position.name,
        allocation_percent: position.allocationPercent,
      })),
    );
    if (error) throw error;
  }

  return getPositions(departmentId);
}

/**
 * Replaces the Commission Split percentages for one Project Type. Validates
 * the percentages sum to 100 before writing anything. Restricted to a Sales
 * Director (see isSalesDirector) or Super Admin.
 */
async function saveSplitsForProjectType(projectType, splits, actorId) {
  await requireSalesDirectorOrSuperAdmin(actorId);

  assertPercentagesSumTo100(
    splits.map((split) => split.percent),
    { label: "Commission Split percentages" },
  );

  const { error } = await supabase.from("commission_splits").upsert(
    splits.map((split) => ({
      project_type: projectType,
      share_role: split.shareRole,
      percent: split.percent,
    })),
    { onConflict: "project_type,share_role" },
  );
  if (error) throw error;

  return getSplitsForProjectType(projectType);
}

/**
 * The full Commission Pool breakdown for one opportunity: Commissionable
 * Revenue, the Pool, the Department split, and the Sales role split (or, for
 * a Single Salesperson Project, the whole Sales share attributed to the deal
 * owner). Rates are resolved as of the opportunity's Contract Date once it
 * has one (set automatically at Awarded — see opportunityService.updateStatus);
 * before that, as of today, so the figure stays a live, moving estimate.
 */
async function getCommissionBreakdownForOpportunity(opportunityId) {
  const { data: opportunity, error } = await supabase
    .from("sales_opportunities")
    .select(
      `id, expected_value, project_type, contract_date,
       deal_owner:employees!sales_opportunities_deal_owner_id_fkey(id, name, avatar_path),
       closing_sales:employees!sales_opportunities_closing_sales_id_fkey(id, name, avatar_path),
       support_1:employees!sales_opportunities_support_sales_1_id_fkey(id, name, avatar_path),
       support_2:employees!sales_opportunities_support_sales_2_id_fkey(id, name, avatar_path),
       sales_director:employees!sales_opportunities_sales_director_id_fkey(id, name, avatar_path)`,
    )
    .eq("id", opportunityId)
    .single();
  if (error) throw error;

  const asOfDate = opportunity.contract_date ?? getCurrentLocalDate();
  const [rates, departments] = await Promise.all([getEffectiveRates(asOfDate), getDepartments()]);

  const breakdown = calculateCommissionBreakdown({
    contractValue: Number(opportunity.expected_value) || 0,
    ...rates,
    departments,
  });

  // Identified by `key`, not `name` — a Super Admin can freely rename a
  // Commission Department (see saveDepartmentAllocations), so matching on
  // the display name would silently break this the moment "Sales" is
  // renamed to anything else.
  const salesIndex = departments.findIndex((department) => department.key === "sales");
  const salesShare = salesIndex === -1 ? null : breakdown.departmentShares[salesIndex];
  if (salesShare) {
    breakdown.departmentShares = breakdown.departmentShares.map((share, i) =>
      i === salesIndex ? { ...share, isSales: true } : share,
    );
  }

  let salesRoleShares = [];
  if (salesShare) {
    const splits = await getSplitsForProjectType(opportunity.project_type);
    salesRoleShares = splitSalesShareForRoles(salesShare.amount, splits, {
      deal_owner: opportunity.deal_owner ?? null,
      closing_salesperson: opportunity.closing_sales ?? null,
      supporting_salespeople: [opportunity.support_1, opportunity.support_2],
      sales_director: opportunity.sales_director ?? null,
    });
  }

  return {
    opportunityId: opportunity.id,
    projectType: opportunity.project_type,
    contractDate: opportunity.contract_date,
    rateAsOfDate: asOfDate,
    ...breakdown,
    salesRoleShares,
  };
}

/**
 * Aggregates all opportunity commission metrics across the whole company
 * for the Commission Dashboard.
 */
async function getCommissionDashboardData({
  scope = "REALIZED",
  dateFilter = null,
} = {}) {
  const [oppsResult, ratesResult, departments, splitsSsp, splitsCp, splitsStrategic] = await Promise.all([
    supabase
      .from("sales_opportunities")
      .select(
        `id, opportunity_no, project_title, client_name, expected_value, status, project_type, contract_date, created_at, sale_type_id, flow_stage_id,
         deal_owner:employees!sales_opportunities_deal_owner_id_fkey(id, name, avatar_path),
         closing_sales:employees!sales_opportunities_closing_sales_id_fkey(id, name, avatar_path),
         support_1:employees!sales_opportunities_support_sales_1_id_fkey(id, name, avatar_path),
         support_2:employees!sales_opportunities_support_sales_2_id_fkey(id, name, avatar_path),
         sales_director:employees!sales_opportunities_sales_director_id_fkey(id, name, avatar_path),
         flow_snapshot:flow_snapshots(snapshot_data)`,
      )
      .neq("is_deleted", true)
      // Issue #36, migration 0046 — a Scratch SOR carries a value and a
      // Contract Date like any other deal, so the flag is the only thing
      // keeping it out of the company's booked money.
      .eq("is_scratch", false)
      // Issue #170/#171 — a retail order has no Contract Date, so it was
      // leaking in full into the Forecast scope while being invisible to
      // Realized. The flag removes it from both instead of fixing one.
      .eq("is_retail", false)
      .order("contract_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("commission_rates")
      .select("rate_type, percent, effective_from")
      .order("effective_from", { ascending: false }),
    getDepartments(),
    getSplitsForProjectType("SSP"),
    getSplitsForProjectType("CP"),
    getSplitsForProjectType("STRATEGIC"),
  ]);

  if (oppsResult.error) throw oppsResult.error;
  if (ratesResult.error) throw ratesResult.error;

  const rateList = ratesResult.data || [];
  const ratesResolver = (asOfDate) => resolveEffectiveRatesFromList(rateList, asOfDate);

  const splitsByProjectType = {
    SSP: splitsSsp,
    CP: splitsCp,
    STRATEGIC: splitsStrategic,
  };

  return aggregateOpportunityCommissions({
    opportunities: oppsResult.data || [],
    ratesResolver,
    departments,
    splitsByProjectType,
    scope,
    dateFilter,
  });
}

export const commissionService = {
  getEffectiveRates,
  getEffectiveRetentionPercent,
  getDepartments,
  getSplitsForProjectType,
  getCommissionBreakdownForOpportunity,
  getCommissionDashboardData,
  listRateHistory,
  createRate,
  saveDepartmentAllocations,
  getPositions,
  savePositionAllocations,
  saveSplitsForProjectType,
  isSalesDirector,
};
