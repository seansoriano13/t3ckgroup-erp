import { useQuery } from "@tanstack/react-query";
import { Briefcase, ChevronRight, ClipboardList, ListChecks, Users } from "lucide-react";
import { opportunityService } from "../../services/opportunityService";
import { taskService } from "../../services/taskService";
import { CONDITION_STATUS } from "../../constants/stageGate";
import { TASK_STATUS } from "../../constants/status";
import { cn } from "../../lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import StatusBadge from "../StatusBadge";
import Spinner from "../ui/Spinner";

/**
 * One thing this viewer owes on the deal. Headline is the task's title, with
 * the description (for a Group Task: this member's own assignment) beneath it;
 * a Group Task's obligation is its assignment, the group's brief is shared.
 * Status only speaks up when it isn't plain "still to do" — an approval the
 * viewer is waiting on, not one they owe.
 */
function TaskRow({ task, onOpen }) {
  const isGroup = task.kind === "group";
  const Icon = isGroup ? Users : ClipboardList;
  const headline = task.title || task.taskDescription || "Untitled task";
  const detail = task.title ? task.taskDescription : "";
  const awaitingApproval = task.status === TASK_STATUS.AWAITING_APPROVAL;
  const overdue = !awaitingApproval && task.dueAt && new Date(task.dueAt) < new Date();
  const dueLabel = task.dueAt
    ? new Date(task.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 text-left transition-colors hover:border-border hover:bg-muted/50"
    >
      <Icon size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-bold break-words text-foreground">{headline}</p>
        {detail && <p className="line-clamp-2 text-xs break-words text-muted-foreground">{detail}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-muted-foreground">
          <span>{isGroup ? "Group task" : "Task"}</span>
          {dueLabel && (
            <span className={cn(overdue && "text-red-600 dark:text-red-400")}>
              {overdue ? `Overdue · ${dueLabel}` : `Due ${dueLabel}`}
            </span>
          )}
          {task.checklistProgress && (
            <span>
              {task.checklistProgress.checked}/{task.checklistProgress.total} done
            </span>
          )}
          {task.priority === "HIGH" && <StatusBadge theme="red">High</StatusBadge>}
          {awaitingApproval && <StatusBadge status={task.status}>Awaiting approval</StatusBadge>}
        </div>
      </div>
      <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

/**
 * Quick View — the landing spot for every entry point into an SOR
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
  onOpenGroupTask,
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
      <DialogContent className="grid-cols-[minmax(0,1fr)] gap-6 p-6 sm:max-w-2xl">
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
                <TaskRow
                  key={`${task.kind}-${task.id}`}
                  task={task}
                  onOpen={() => (task.kind === "group" ? onOpenGroupTask(task.id) : onOpenTask(task.id))}
                />
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
