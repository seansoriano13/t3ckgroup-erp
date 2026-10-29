import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { opportunityService } from "@/services/opportunityService";

/**
 * Story 14: "the card show[s] the title and assignees the action would
 * create" — `target` arrives as structured data (who, not a count or a
 * placeholder), and this is the one place it becomes a sentence.
 */
function describeTarget(target) {
  if (target.kind === "purchase_request") return "A Purchase Request for this SOR";
  if (target.kind === "costing_matrix") return "An S0 Evaluation for this SOR";
  if (target.kind === "packing_list") return "A Packing List request to the Warehouse for this SOR";
  if (target.kind === "group") {
    if (target.members.length === 0) return "A group task with no assignees yet";
    return `A group task for ${target.members.map((m) => m.name).join(", ")}`;
  }
  return target.assignee ? `An individual task assigned to ${target.assignee.name}` : "An individual task assigned to you";
}

/**
 * Issue #204 Part 2, stories 13/14/15/16 — the card a Decider sees when an
 * Optional Action is waiting on them: the rendered title, what it would
 * create, and Create/Skip. `getPendingActionsForActor` only ever returns
 * runs `actorId` resolves into, so a non-Decider never sees this card at
 * all (story 20) rather than seeing it with the buttons disabled.
 */
export default function PendingActionDecisions({ opportunity, actorId, onChanged }) {
  const opportunityId = opportunity?.id;
  const queryClient = useQueryClient();

  const { data: pending = [] } = useQuery({
    queryKey: ["pendingActionDecisions", opportunityId, actorId],
    queryFn: () => opportunityService.getPendingActionsForActor(opportunityId, actorId),
    enabled: !!opportunityId && !!actorId,
  });

  const decideMutation = useMutation({
    mutationFn: ({ runId, decision }) => opportunityService.decideAction(runId, decision, actorId),
    onSuccess: (_, { decision }) => {
      toast.success(decision === "create" ? "Created." : "Skipped.");
      queryClient.invalidateQueries({ queryKey: ["pendingActionDecisions", opportunityId, actorId] });
      queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunityId] });
      onChanged?.();
    },
    onError: (err) => {
      toast.error(err.message);
      // #788: a failed open leaves the run as failed; refresh so the card offers the retry.
      queryClient.invalidateQueries({ queryKey: ["pendingActionDecisions", opportunityId, actorId] });
    },
  });

  if (!pending.length) return null;

  return (
    <div className="space-y-2">
      {pending.map((run) => (
        <div
          key={run.runId}
          className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/50 px-4 py-3"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Wand2 size={14} className="shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{run.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {describeTarget(run.target)} · waiting on you since entering {run.stageName}
              </p>
              {run.failed && (
                <p className="truncate text-xs font-semibold text-destructive" role="alert">
                  It failed the last time. Press Create to try again.
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {!run.failed && (
              <Button
                size="sm"
                variant="outline"
                disabled={decideMutation.isPending}
                onClick={() => decideMutation.mutate({ runId: run.runId, decision: "skip" })}
              >
                Skip
              </Button>
            )}
            <Button
              size="sm"
              disabled={decideMutation.isPending}
              onClick={() => decideMutation.mutate({ runId: run.runId, decision: "create" })}
            >
              Create
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
