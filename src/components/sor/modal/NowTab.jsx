import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { ListTodo } from "lucide-react";
import StageChecklist from "../StageChecklist";
import StageFieldsForm from "../StageFieldsForm";
import FollowUpPanel from "../FollowUpPanel";
import PendingActionDecisions from "../PendingActionDecisions";
import TaskRow from "./TaskRow";
import { currentVisitTaskRows } from "../../../constants/sorTasks";
import { opportunityService } from "../../../services/opportunityService";
import { stageFieldService } from "../../../services/stageFieldService";
import { normalizeSalesReference, SALES_REFERENCE_HINT } from "../../../constants/sor";

function Section({ title, count, children }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">{title}</p>
        {count != null && <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{count}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * Now (#299) — what this SOR's current Stage Visit needs today, in the order
 * a Deal Owner can act on it: what blocks the Stage, what the Stage asks to
 * be filled in, the decisions waiting on a Decider, the work that is out,
 * and when the next follow-up is due.
 *
 * The order is the point. These four blocks used to hang off the bottom of
 * `StageChecklist` in the order they were built (actions, follow-up,
 * conditions, fields), with the tasks in a separate left-column roster
 * entirely — so the first thing on screen was rarely the first thing to do.
 * Clearing the way comes first, which is why conditions render above
 * everything else here.
 *
 * Not here on purpose: Project Evaluation (removed by #203), and the
 * Inclusions and Purchasing panels, which moved to Details (#302) until
 * #209 replaces them. The Purchase Request card (#209) belongs after the
 * follow-up section.
 */
export default function NowTab({ ctx }) {
  const {
    opportunity,
    id,
    user,
    employees,
    automationTasks,
    invalidate,
    handleSaveField,
    isLostPending,
    lostReason,
    setLostReason,
    needsSalesRef,
    salesRef,
    setSalesRef,
    salesRefValid,
    pendingStage,
    stageLabel,
    cancelPendingStage,
    stageMutation,
    isRestricted,
  } = ctx;

  // A flow SOR's `status` never changes (it stays LEAD), so anything keyed
  // by "which Stage is this" follows the flow Stage — the same key
  // `StageChecklist` uses, so react-query dedupes rather than double-fetches.
  const stageCode = opportunity?.flow_stage_id || opportunity?.status;

  const { data: stageFields = [] } = useQuery({
    queryKey: ["stageFields", stageCode],
    queryFn: () => stageFieldService.getForStage(opportunity.flow_stage_id),
    enabled: !!opportunity?.flow_stage_id,
  });

  const { data: currentVisit = null, isPending: visitPending } = useQuery({
    queryKey: ["currentStageVisit", id, stageCode],
    queryFn: () => opportunityService.getCurrentStageVisit(id),
    enabled: !!id,
  });

  const { data: followUpStatus = null } = useQuery({
    queryKey: ["followUpStatus", id, stageCode],
    queryFn: () => opportunityService.getFollowUpStatus(id),
    enabled: !!id,
  });

  // Held back until the visit is known: rendering every task first and
  // then narrowing to this visit's would flash the older visits' rows.
  const rows = visitPending ? [] : currentVisitTaskRows(automationTasks, currentVisit);

  return (
    <div className="space-y-7 p-6">
      {isRestricted && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/5 px-3 py-2.5 text-sm font-semibold text-amber-11">
          This stage is restricted — Move is disabled.
        </div>
      )}

      {isLostPending && (
        <div className="flex items-end gap-2">
          <div className="flex-1 rounded-xl border border-border bg-muted/30 p-3 focus-within:border-mauve-7">
            <label className="mb-1 block text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Reason for loss</label>
            <input
              autoFocus
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              placeholder="e.g. Lost to lower bid"
              className="w-full bg-transparent text-sm font-medium text-foreground outline-none"
            />
          </div>
          <button
            disabled={!lostReason.trim() || stageMutation.isPending}
            onClick={() => stageMutation.mutate({ next: pendingStage, reason: lostReason.trim(), salesReference: null })}
            className="h-10 rounded-xl bg-primary px-4 text-[13px] font-bold text-primary-foreground transition-all hover:bg-primary-hover disabled:opacity-50"
          >
            Confirm
          </button>
          <button onClick={cancelPendingStage} className="h-10 rounded-xl px-3 text-[13px] font-bold text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      )}

      {needsSalesRef && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-3">
          <div className="flex-1 rounded-xl border border-border bg-muted/30 p-3 focus-within:border-mauve-7">
            <label className="mb-1 block text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
              Sales Reference<span className="ml-0.5 text-red-11">*</span>
            </label>
            <input
              autoFocus
              value={salesRef}
              onChange={(e) => setSalesRef(e.target.value.toUpperCase())}
              placeholder="e.g. S01237"
              className="w-full bg-transparent font-mono text-sm font-medium text-foreground uppercase outline-none"
            />
            <p className={cn("mt-1.5 text-[11px] leading-relaxed", salesRef && !salesRefValid ? "font-semibold text-red-11" : "text-muted-foreground")}>
              {salesRef && !salesRefValid ? SALES_REFERENCE_HINT : "Enter the Odoo sales quotation number to confirm a quotation exists."}
            </p>
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
            <button onClick={cancelPendingStage} className="h-10 rounded-xl px-3 text-[13px] font-bold text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button
              disabled={(needsSalesRef && !salesRefValid) || stageMutation.isPending}
              onClick={() =>
                stageMutation.mutate({
                  next: pendingStage,
                  reason: null,
                  salesReference: needsSalesRef ? normalizeSalesReference(salesRef) : null,
                })
              }
              className="h-10 rounded-xl bg-primary px-4 text-[13px] font-bold text-primary-foreground transition-all hover:bg-primary-hover disabled:opacity-50"
            >
              Confirm {stageLabel(pendingStage) || pendingStage}
            </button>
          </div>
        </div>
      )}

      {opportunity.lost_reason && (
        <div className="rounded-xl border border-red-7 bg-red-9/5 px-3 py-2.5">
          <p className="mb-1 text-[10px] font-bold tracking-widest text-red-11 uppercase">Lost Reason</p>
          <p className="text-sm text-foreground">{opportunity.lost_reason}</p>
        </div>
      )}

      <Section title="What blocks this stage">
        <StageChecklist
          opportunity={opportunity}
          employees={employees}
          actorId={user?.id}
          onChanged={invalidate}
          onSaveField={handleSaveField}
        />
      </Section>

      {stageFields.length > 0 && (
        <Section title="Stage fields">
          <StageFieldsForm
            opportunity={opportunity}
            fields={stageFields}
            currentVisitId={currentVisit?.id ?? null}
            actorId={user?.id}
            onSaveField={handleSaveField}
            onChanged={invalidate}
          />
        </Section>
      )}

      {/*
        Renders nothing unless `getPendingActionsForActor` resolves the
        viewer into a run's Decider (#204 story 20), so the Decider-only
        rule is enforced by the query, not by a role check here.
      */}
      <PendingActionDecisions opportunity={opportunity} actorId={user?.id} onChanged={invalidate} />

      <Section title="Tasks" count={rows.length > 0 ? rows.length : null}>
        {visitPending ? null : rows.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/50 px-4 py-3 text-sm text-muted-foreground">
            <ListTodo size={14} className="shrink-0" />
            No tasks on this stage yet.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <TaskRow key={`${row.kind}-${row.id}`} row={row} />
            ))}
          </div>
        )}
      </Section>

      {followUpStatus?.cadence && (
        <Section title="Follow-up">
          <FollowUpPanel opportunity={opportunity} actorId={user?.id} onChanged={invalidate} status={followUpStatus} />
        </Section>
      )}

      {/* #209's Purchase Request card goes here, after follow-up. */}
    </div>
  );
}
