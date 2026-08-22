import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { commissionService } from "../../services/commissionService";
import { RATE_TYPE_LABELS } from "../../utils/commission";
import { PROJECT_TYPES } from "../../constants/sor";
import { useAuth } from "../../context/AuthContext";
import { getCurrentLocalDate } from "../../utils/formatDate";

const SHARE_ROLE_LABELS = {
  deal_owner: "Deal Owner",
  supporting_salesperson: "Supporting Salesperson (combined)",
  sales_director: "Sales Director",
};

// Taken from the shared list rather than restated here: every Project Type
// now carries its split percentages in commission_splits, and a second copy
// of the labels is how this screen came to call an SSP a "Solo Sales
// Project" while the rest of the app — and CONTEXT.md — called it a Single
// Salesperson Project.
const PROJECT_TYPES_WITH_SPLITS = PROJECT_TYPES;

function SplitEditor({ projectType, label, canEdit, actorId }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(null);

  const { data: splits, isLoading } = useQuery({
    queryKey: ["commissionSplits", projectType],
    queryFn: () => commissionService.getSplitsForProjectType(projectType),
  });

  const draft = rows ?? splits ?? [];
  const total = draft.reduce((sum, row) => sum + (Number(row.percent) || 0), 0);

  const saveMutation = useMutation({
    mutationFn: (payload) => commissionService.saveSplitsForProjectType(projectType, payload, actorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commissionSplits", projectType] });
      queryClient.invalidateQueries({ queryKey: ["commissionBreakdown"] });
      toast.success(`${label} split updated.`);
      setRows(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateRow = (shareRole, percent) => {
    const base = rows ?? splits ?? [];
    const exists = base.some((row) => row.shareRole === shareRole);
    setRows(
      exists
        ? base.map((row) => (row.shareRole === shareRole ? { ...row, percent } : row))
        : [...base, { shareRole, percent }],
    );
  };

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="pb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="divide-y divide-border/50">
        {Object.entries(SHARE_ROLE_LABELS).map(([shareRole, roleLabel]) => {
          const row = draft.find((r) => r.shareRole === shareRole);
          return (
            <div key={shareRole} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-[12.5px] text-foreground">{roleLabel}</span>
              {canEdit ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.001"
                    value={row?.percent ?? 0}
                    onChange={(e) => updateRow(shareRole, Number(e.target.value))}
                    className="h-7 w-20 rounded-md border border-border bg-card px-2 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              ) : (
                <span className="text-[12.5px] font-semibold tabular-nums text-foreground">{row?.percent ?? 0}%</span>
              )}
            </div>
          );
        })}
      </div>

      {canEdit && (
        <div className="flex items-center justify-end gap-3 pt-3">
          <span className={total !== 100 ? "text-xs font-semibold text-destructive" : "text-xs text-muted-foreground"}>
            Total {total.toFixed(2)}%
          </span>
          <button
            type="button"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate(draft.filter((row) => SHARE_ROLE_LABELS[row.shareRole]))}
            className="h-7 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Read view of current Commission Rates and Department allocation, plus
 * Sales-Director-editable Commission Split percentages per Project Type (SSP, CP, STRATEGIC).
 */
export default function CommissionFormulaView() {
  const { user } = useAuth();
  const isSuperAdmin = !!(user?.is_super_admin || user?.isSuperAdmin);

  // "Sales Director" isn't a flag on the user record — it's whoever is
  // actually set as sales_director_id on at least one opportunity. See
  // commissionService.isSalesDirector.
  const { data: isDirector } = useQuery({
    queryKey: ["isSalesDirector", user?.id],
    queryFn: () => commissionService.isSalesDirector(user.id),
    enabled: !isSuperAdmin && !!user?.id,
  });
  const canEditSplits = isSuperAdmin || !!isDirector;

  const { data: rates } = useQuery({
    queryKey: ["commissionRateHistory"],
    queryFn: () => commissionService.listRateHistory(),
  });

  const { data: departments } = useQuery({
    queryKey: ["commissionDepartments"],
    queryFn: () => commissionService.getDepartments(),
  });

  // listRateHistory returns every rate ever recorded, newest first, and that
  // includes rates scheduled to take effect later. "Current" has to mean what
  // getEffectiveRates means — the newest row already in force — otherwise
  // scheduling next year's VAT announces it as today's while every figure on
  // the screen is still computed from the rate actually applying now.
  const today = getCurrentLocalDate();
  const inForce = (rates || []).filter(
    (rate) => !rate.effective_from || rate.effective_from <= today,
  );
  const currentRates = inForce.filter(
    (rate, i, all) => all.findIndex((r) => r.rate_type === rate.rate_type) === i,
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="pb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Current Commission Rates
        </p>
        <div className="divide-y divide-border/50">
          {currentRates.map((rate) => (
            <div key={rate.rate_type} className="flex items-center justify-between py-1.5 text-[12.5px]">
              <span className="text-foreground">{RATE_TYPE_LABELS[rate.rate_type] || rate.rate_type}</span>
              <span className="font-semibold tabular-nums text-foreground">{rate.percent}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="pb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Department Allocation
        </p>
        <div className="divide-y divide-border/50">
          {(departments || []).map((department) => (
            <div key={department.id} className="flex items-center justify-between py-1.5 text-[12.5px]">
              <span className="text-foreground">{department.name}</span>
              <span className="font-semibold tabular-nums text-foreground">{department.allocationPercent}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Sales Role Split (Single Salesperson, Collaborative &amp; Strategic Projects)
        </p>
        {PROJECT_TYPES_WITH_SPLITS.map(({ value, label }) => (
          <SplitEditor
            key={value}
            projectType={value}
            label={label}
            canEdit={canEditSplits}
            actorId={user?.id}
          />
        ))}
      </div>
    </div>
  );
}
