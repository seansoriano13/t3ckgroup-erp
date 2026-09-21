import { useQuery } from "@tanstack/react-query";
import { Briefcase, ClipboardList, ListChecks } from "lucide-react";
import { opportunityService } from "../../services/opportunityService";
import { taskService } from "../../services/taskService";
import { CONDITION_STATUS } from "../../constants/stageGate";
import { cn } from "../../lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import Spinner from "../ui/Spinner";

/**
 * Quick View (#316) — the landing spot for every entry point into an SOR
 * from a task (My SORs, a TaskCard's SOR chip, a task's SorLink field): what
 * this viewer is actually on the hook for, not the whole record. "View Full
 * Details" is the deliberate escalation to `SorModal` for whoever needs it.
 *
 * Conditions have no per-employee assignee in the data model (`stage_conditions`
 * carries no role/assignee column) — "Open on this stage" is deliberately not
 * labelled "yours".
 */
export default function OpportunityQuickView({
  isOpen,
  onClose,
  opportunity,
  opportunityId,
  userId,
  onViewFullDetails,
  onOpenTask,
}) {
  const { data: tasks = [], isLoading: isLoadingTasks } = useQuery({
    queryKey: ["quickViewTasks", opportunityId, userId],
    queryFn: () => taskService.getMyOpenTasksForOpportunity(userId, opportunityId),
    enabled: isOpen && !!opportunityId && !!userId,
  });

  const { data: checklist = [], isLoading: isLoadingChecklist } = useQuery({
    queryKey: ["quickViewChecklist", opportunityId, opportunity?.flow_stage_id || opportunity?.status],
    queryFn: () => opportunityService.getStageChecklist(opportunityId, opportunity),
    enabled: isOpen && !!opportunityId && !!opportunity,
  });

  const openConditions = checklist.filter(({ status }) => status === CONDITION_STATUS.UNSATISFIED);

  const label = opportunity?.sales_reference || opportunity?.client_name || "This deal";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl gap-6 p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Briefcase size={16} className="text-muted-foreground" />
            {label}
          </DialogTitle>
          {opportunity?.project_title && (
            <p className="text-sm text-muted-foreground">{opportunity.project_title}</p>
          )}
        </DialogHeader>

        <section className="space-y-3">
          <h3 className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
            <ClipboardList size={12} /> Your open tasks
          </h3>
          {isLoadingTasks ? (
            <div className="flex justify-center py-6">
              <Spinner size="sm" />
            </div>
          ) : tasks.length === 0 ? (
            <p className="rounded-xl border border-border/70 bg-card/50 px-4 py-3 text-sm text-muted-foreground">
              Nothing open for you here.
            </p>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-border/50 bg-muted px-4 py-3 text-left text-sm font-bold text-foreground shadow-sm transition-colors hover:bg-muted/70"
                >
                  <span className="truncate">{task.taskDescription || "Untitled task"}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
            <ListChecks size={12} /> Open on this stage
          </h3>
          {isLoadingChecklist ? (
            <div className="flex justify-center py-6">
              <Spinner size="sm" />
            </div>
          ) : openConditions.length === 0 ? (
            <p className="rounded-xl border border-border/70 bg-card/50 px-4 py-3 text-sm text-muted-foreground">
              Nothing blocks this stage.
            </p>
          ) : (
            <ul className="space-y-2">
              {openConditions.map(({ condition }) => (
                <li
                  key={condition.id}
                  className={cn(
                    "rounded-xl border border-amber-9/30 bg-amber-a2 px-4 py-3 text-sm font-semibold text-foreground",
                  )}
                >
                  {condition.label}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex justify-end border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={onViewFullDetails}>
            View Full Details
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
