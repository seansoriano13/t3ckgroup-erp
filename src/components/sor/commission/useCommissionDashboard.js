import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { commissionService } from "../../../services/commissionService";
import { useAuth } from "../../../context/AuthContext";
import { RATE_TYPES } from "../../../utils/commission";
import { getPresetDateRange, rateTimeline, SPLIT_PROJECT_TYPES } from "./commissionView";

/**
 * Everything the Commission Dashboard's two tabs read: the ledger for the
 * chosen scope and period, the live Commission Rates, and the Commission Split
 * for each Project Type — plus who may see which amounts (Privacy Masking).
 */
export function useCommissionDashboard() {
  const { user } = useAuth();
  const [scope, setScope] = useState("REALIZED");
  const [datePreset, setDatePreset] = useState("ALL");
  const dateFilter = useMemo(() => getPresetDateRange(datePreset), [datePreset]);

  const dashboardQuery = useQuery({
    queryKey: ["commissionDashboard", scope, datePreset],
    queryFn: () => commissionService.getCommissionDashboardData({ scope, dateFilter }),
  });
  const ratesQuery = useQuery({
    queryKey: ["commissionRateHistory"],
    queryFn: () => commissionService.listRateHistory(),
  });

  const isSuperAdmin = !!(user?.is_super_admin || user?.isSuperAdmin);
  const isHead = !!(user?.is_head || user?.isHead);
  const department = user?.department?.toLowerCase() ?? "";
  const canViewAllFinancials = isSuperAdmin || department.includes("accounting") || department.includes("finance");

  // The rate in force today per type; a rate dated in the future is Scheduled, not live.
  const rates = useMemo(() => {
    const live = (type) => {
      const current = rateTimeline(ratesQuery.data, type).find((r) => r.status === "current");
      return current ? Number(current.percent) : undefined;
    };
    return {
      vat: live(RATE_TYPES.VAT) ?? 12,
      withholding: live(RATE_TYPES.WITHHOLDING) ?? 8,
      pool: live(RATE_TYPES.POOL) ?? 1,
      retention: live(RATE_TYPES.RETENTION),
    };
  }, [ratesQuery.data]);

  const dashboard = dashboardQuery.data;
  const salesPercent = dashboard?.departmentTotals?.find((d) => d.isSales)?.allocationPercent ?? 50;

  return {
    user,
    scope,
    setScope,
    datePreset,
    setDatePreset,
    isLoading: dashboardQuery.isLoading,
    error: dashboardQuery.error,
    dashboard,
    rates,
    rateHistory: ratesQuery.data ?? [],
    salesPercent,
    isHead,
    /** Company-level amounts: the pool, revenue, the other departments. */
    canViewAllFinancials,
    /** Sales-side amounts: the Sales fund and every person's share. */
    canViewSalesAmounts: canViewAllFinancials || isHead,
  };
}

/** The Commission Split for every Project Type that has one, keyed by Project Type. */
export function useCommissionSplits() {
  const queries = useQueries({
    queries: SPLIT_PROJECT_TYPES.map((p) => ({
      queryKey: ["commissionSplits", p.value],
      queryFn: () => commissionService.getSplitsForProjectType(p.value),
    })),
  });
  return {
    splits: Object.fromEntries(SPLIT_PROJECT_TYPES.map((p, i) => [p.value, queries[i].data || []])),
    isLoading: queries.some((q) => q.isLoading),
  };
}
