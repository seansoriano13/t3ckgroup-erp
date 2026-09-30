import { useMemo } from "react";
import { useLocation, useSearchParams } from "react-router";
import PageShell from "../ui/PageShell";
import TabGroup from "../ui/TabGroup";
import { AlertCircle } from "lucide-react";
import Spinner from "../ui/Spinner";
import EmptyState from "../ui/EmptyState";
import { colourDepartments } from "./commission/commissionView";
import { useCommissionDashboard } from "./commission/useCommissionDashboard";
import { PeriodField, Segmented } from "./commission/parts";
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

  const body = access.isLoading ? (
    <div className="flex h-64 flex-col items-center justify-center gap-3">
      <Spinner size="lg" />
      <p className="text-sm text-muted-foreground">Adding up the Commission Pool…</p>
    </div>
  ) : access.error ? (
    <EmptyState icon={AlertCircle} title="Couldn't load the Commission Pool" description={access.error.message} />
  ) : tab === "pool" ? (
    <PoolTab key={linkedDealId ?? "pool"} access={{ ...access, dashboard: access.dashboard ?? {} }} departments={departments} initialDealId={linkedDealId} />
  ) : (
    <FormulaTab access={{ ...access, dashboard: access.dashboard ?? {} }} departments={departments} />
  );

  return (
    <PageShell
      title="Commission Pool"
      description="How a signed contract becomes commission, and who it reaches. Always an estimate."
      action={
        <>
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
        </>
      }
      tabs={<TabGroup variant="underline" tabs={TABS} activeTab={tab} onChange={setTab} />}
    >
      {body}
    </PageShell>
  );
}
