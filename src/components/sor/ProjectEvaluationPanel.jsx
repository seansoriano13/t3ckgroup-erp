import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Calculator, ChevronDown, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "../../context/AuthContext";
import { projectEvaluationService } from "../../services/projectEvaluationService";

/**
 * Project Evaluation (issue #48) — the go/no-go.
 *
 * Base cost is never entered here — it rolls up live from the SOR's
 * Inclusions and their stamped cost basis (rendered below this panel by
 * InclusionsPanel). This panel is only the numbers a salesperson actually
 * types: a candidate sales price, an estimated operating expense figure, and
 * whether the client is a government body.
 *
 * Markup and final pricing stay in Odoo. Nothing here ever writes a price
 * back — the candidate price is for deciding with, not for quoting.
 */

const money = (value) =>
  value === null || value === undefined ? "—" : `₱${Number(value).toLocaleString()}`;

function NumberField({ label, value, onCommit, disabled, placeholder }) {
  const [draft, setDraft] = useState(value ?? "");

  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        min="0"
        step="any"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === "" && (value ?? "") === "") return;
          if (Number(draft) === Number(value)) return;
          onCommit(draft === "" ? null : Number(draft));
        }}
        className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground outline-none focus:border-mauve-8 disabled:opacity-60"
      />
    </label>
  );
}

export default function ProjectEvaluationPanel({ opportunity }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isFolded, setIsFolded] = useState(false);

  const opportunityId = opportunity?.id;

  const { data: summary, isLoading } = useQuery({
    queryKey: ["projectEvaluation", opportunityId],
    queryFn: () => projectEvaluationService.getEvaluationSummary(opportunityId),
    enabled: Boolean(opportunityId),
  });

  // Mirrors sor_can_edit_opportunity (0003) / sor_project_evaluations_write
  // (0061) — this is a sales decision about a sales deal, so unlike Canvass
  // there is no purchasing clause.
  const canEdit =
    !!user &&
    (user.isSuperAdmin ||
      user.is_super_admin ||
      user.isHead ||
      user.is_head ||
      [
        opportunity?.registered_by,
        opportunity?.deal_owner_id,
        opportunity?.support_sales_1_id,
        opportunity?.support_sales_2_id,
        opportunity?.sales_director_id,
      ].includes(user.id));

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["projectEvaluation", opportunityId] });

  const ensureEvaluation = async () => {
    if (summary?.evaluation) return summary.evaluation;
    return projectEvaluationService.getOrCreateEvaluation(opportunityId, user?.id);
  };

  const startMutation = useMutation({
    mutationFn: () => projectEvaluationService.getOrCreateEvaluation(opportunityId, user?.id),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (patch) => {
      const evaluation = await ensureEvaluation();
      return projectEvaluationService.updateEvaluation(evaluation.id, patch);
    },
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  });

  const signOffMutation = useMutation({
    mutationFn: async () => {
      const evaluation = await ensureEvaluation();
      return projectEvaluationService.signOffEvaluation(evaluation.id, user?.id);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Project Evaluation signed off.");
    },
    onError: (err) => toast.error(err.message),
  });

  if (!opportunity || isLoading) return null;

  const evaluation = summary?.evaluation;
  const margin = summary?.margin;
  const baseCost = summary?.baseCost;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setIsFolded(!isFolded)}
          className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            size={12}
            className={cn("transition-transform duration-150", isFolded && "-rotate-90")}
          />
          <Calculator size={12} />
          Project Evaluation
        </button>

        <div className="flex items-center gap-2">
          {!summary?.isBound && (
            <span className="rounded-full bg-amber-a3 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-11">
              Estimate — no Sales Reference yet
            </span>
          )}
          {evaluation?.signed_off_at && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-green-11">
              <ShieldCheck size={12} /> Signed off by {evaluation.signer?.name || "—"}
            </span>
          )}
        </div>
      </div>

      {!isFolded && (
        <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
          {!evaluation && !canEdit && (
            <p className="text-xs text-muted-foreground">No Project Evaluation yet.</p>
          )}

          {!evaluation && canEdit && (
            <button
              type="button"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="rounded-lg bg-primary px-3.5 py-2 text-[12px] font-bold text-primary-foreground transition-opacity disabled:opacity-40"
            >
              Start a Project Evaluation
            </button>
          )}

          {evaluation && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Candidate sales price"
                  value={evaluation.candidate_sales_price}
                  disabled={!canEdit}
                  placeholder="Not entered"
                  onCommit={(v) => updateMutation.mutate({ candidateSalesPrice: v })}
                />
                <NumberField
                  label="Estimated operating expense"
                  value={evaluation.estimated_opex}
                  disabled={!canEdit}
                  placeholder="Not entered"
                  onCommit={(v) => updateMutation.mutate({ estimatedOpex: v })}
                />
              </div>

              <label className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                <input
                  type="checkbox"
                  checked={Boolean(evaluation.is_government_client)}
                  disabled={!canEdit}
                  onChange={(e) => updateMutation.mutate({ isGovernmentClient: e.target.checked })}
                  className="size-3.5 rounded border-border"
                />
                Government client — applies VAT, Withholding and Retention
              </label>

              <div className="grid grid-cols-2 gap-3 border-t border-border/60 pt-3 sm:grid-cols-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Base cost
                  </p>
                  <p className="text-sm font-bold text-foreground">
                    {baseCost?.amount === null ? "No cost yet" : money(baseCost?.amount)}
                  </p>
                  {baseCost?.totalCount > 0 && !baseCost?.isComplete && (
                    <p className="text-[10px] text-amber-11">
                      {baseCost.costedCount}/{baseCost.totalCount} Inclusions costed
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Net revenue
                  </p>
                  <p className="text-sm font-bold text-foreground">{money(margin?.netRevenue)}</p>
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Margin
                  </p>
                  <p
                    className={cn(
                      "text-sm font-bold",
                      (margin?.marginAmount ?? 0) < 0 ? "text-red-11" : "text-green-11",
                    )}
                  >
                    {money(margin?.marginAmount)}
                    {margin?.marginPercent !== null && margin?.marginPercent !== undefined && (
                      <span className="ml-1 text-[11px] font-semibold text-muted-foreground">
                        ({margin.marginPercent.toFixed(1)}%)
                      </span>
                    )}
                  </p>
                </div>

                {summary?.isBound && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Odoo order price
                    </p>
                    <p className="text-sm font-bold text-foreground">
                      {money(summary.odooOrderPrice)}
                      {summary.delta !== null && summary.delta !== undefined && summary.delta !== 0 && (
                        <span
                          className={cn(
                            "ml-1 text-[11px] font-semibold",
                            summary.delta > 0 ? "text-green-11" : "text-red-11",
                          )}
                        >
                          ({summary.delta > 0 ? "+" : ""}
                          {money(summary.delta)})
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>

              {canEdit && (
                <div className="flex justify-end border-t border-border/60 pt-3">
                  <button
                    type="button"
                    onClick={() => signOffMutation.mutate()}
                    disabled={signOffMutation.isPending || Boolean(evaluation.signed_off_at)}
                    className="rounded-lg bg-primary px-3.5 py-1.5 text-[12px] font-bold text-primary-foreground disabled:opacity-40"
                  >
                    {evaluation.signed_off_at ? "Signed off" : "Sign off"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
