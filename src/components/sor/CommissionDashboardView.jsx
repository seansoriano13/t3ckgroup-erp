import { useMemo } from "react";
import { useLocation, useSearchParams } from "react-router";
import PageHeader from "../ui/PageHeader";
import Spinner from "../ui/Spinner";
import { colourDepartments } from "./commission/commissionView";
import { useCommissionDashboard } from "./commission/useCommissionDashboard";
import { PeriodField, Segmented, UnderlineTabs } from "./commission/parts";
import PoolTab from "./commission/PoolTab";
import FormulaTab from "./commission/FormulaTab";

const TABS = [
  { value: "pool", label: "Pool" },
  { value: "formula", label: "Formula" },
];

/**
 * The Commission Dashboard: the live Commission Pool (Pool tab) and the rules
 * that produce it (Formula tab) on one screen. `?tab=formula` opens the rules;
 * a SOR link arrives with `state.openOpportunityId` and opens that SOR's
 * receipt on the Pool tab.
 */
export default function CommissionDashboardView() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const access = useCommissionDashboard();
  const departments = useMemo(() => colourDepartments(access.dashboard?.departmentTotals), [access.dashboard]);

  const linkedDealId = location.state?.openOpportunityId ?? null;
  const tab = linkedDealId ? "pool" : params.get("tab") === "formula" ? "formula" : "pool";
  const setTab = (value) => {
    const next = new URLSearchParams(params);
    if (value === "pool") next.delete("tab");
    else next.set("tab", value);
    setParams(next, { replace: true, state: null });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Commission Pool" description="How a signed contract becomes commission, and who it reaches. Always an estimate.">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Scope"
            options={[
              { value: "REALIZED", label: "Realized" },
              { value: "FORECAST", label: "Projected" },
            ]}
            value={access.scope}
            onChange={access.setScope}
          />
          <PeriodField value={access.datePreset} onChange={access.setDatePreset} />
        </div>
      </PageHeader>

      <UnderlineTabs tabs={TABS} value={tab} onChange={setTab} className="border-b border-border" />

      {access.isLoading ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3">
          <Spinner size="lg" />
          <p className="text-sm text-muted-foreground">Adding up the Commission Pool…</p>
        </div>
      ) : access.error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="font-semibold text-destructive">Couldn&apos;t load the Commission Pool</p>
          <p className="mt-1 text-sm text-muted-foreground">{access.error.message}</p>
        </div>
      ) : tab === "pool" ? (
        <PoolTab key={linkedDealId ?? "pool"} access={{ ...access, dashboard: access.dashboard ?? {} }} departments={departments} initialDealId={linkedDealId} />
      ) : (
        <FormulaTab access={{ ...access, dashboard: access.dashboard ?? {} }} departments={departments} />
      )}
    </div>
  );
}
