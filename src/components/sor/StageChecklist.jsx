import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { CheckCircle2, Circle, Paperclip, ListChecks, UserCheck, Square, CheckSquare } from "lucide-react";
import Avatar from "../Avatar";
import { opportunityService } from "../../services/opportunityService";
import { REQUIREMENT_KINDS, REQUIREMENT_STATUS } from "../../constants/stageGate";
import { formatDate } from "../../utils/formatDate";
import { confirmActionToast } from "../ui/CustomToast";

const KIND_LABELS = {
  [REQUIREMENT_KINDS.ATTACHMENT]: "Attachment",
  [REQUIREMENT_KINDS.FIELD]: "Field on record",
  [REQUIREMENT_KINDS.TICKBOX]: "Self-certified",
  [REQUIREMENT_KINDS.ASSIGNMENT]: "Assignment",
};

const KIND_ICONS = {
  [REQUIREMENT_KINDS.ATTACHMENT]: Paperclip,
  [REQUIREMENT_KINDS.FIELD]: ListChecks,
  [REQUIREMENT_KINDS.TICKBOX]: CheckSquare,
  [REQUIREMENT_KINDS.ASSIGNMENT]: UserCheck,
};

/**
 * Stage Gate Engine, ticket 6 (.scratch/stage-gate-engine/issues/06-deal-
 * owner-visibility.md) — what the deal's current Stage owes, before a Deal
 * Owner tries to move it: every live requirement, whether it's satisfied,
 * and who/when for the kinds that carry that. This is also the "specific,
 * named reason" a blocked move gets refused with (ticket 2's
 * `assertStageGateSatisfied` throws the same labels this list already
 * shows) — so there's one surface for both, not a checklist plus a
 * separate error format to keep in sync.
 *
 * A `tickbox` item has no other way to get satisfied (ticket 5) — it's the
 * one kind this list also acts on, not just reports.
 */
export default function StageChecklist({ opportunity, employees = [], actorId, onChanged }) {
  const queryClient = useQueryClient();
  const opportunityId = opportunity?.id;
  const stageCode = opportunity?.status;

  const { data: checklist = [] } = useQuery({
    queryKey: ["stageChecklist", opportunityId, stageCode],
    queryFn: () => opportunityService.getStageChecklist(opportunityId, opportunity),
    enabled: !!opportunityId,
  });

  const satisfyMutation = useMutation({
    mutationFn: (requirementId) =>
      opportunityService.satisfyRequirement(opportunityId, requirementId, actorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stageChecklist", opportunityId, stageCode] });
      queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunityId] });
      onChanged?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const nameFor = (employeeId) => employees.find((e) => e.id === employeeId)?.name || null;

  const handleTick = (requirement) => {
    confirmActionToast(
      `Certify "${requirement.label}"?`,
      "This records your name against it — the requirement has no other evidence, so ticking it is the certification.",
      "Certify",
      "warning",
      () => satisfyMutation.mutate(requirement.id),
    );
  };

  if (checklist.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-border/70 bg-card/50 p-4">
      <p className="mb-3 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
        What {opportunity?.status ? "this Stage" : "the Stage"} owes
      </p>
      <div className="space-y-2.5">
        {checklist.map(({ requirement, status, satisfiedBy, satisfiedAt }) => {
          const Icon = KIND_ICONS[requirement.kind] || Circle;
          const isSatisfied = status === REQUIREMENT_STATUS.SATISFIED;
          const isTickable =
            !isSatisfied && requirement.kind === REQUIREMENT_KINDS.TICKBOX;
          const who = nameFor(satisfiedBy);

          return (
            <div
              key={requirement.id}
              className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-background px-3 py-2.5"
            >
              <button
                type="button"
                disabled={!isTickable || satisfyMutation.isPending}
                onClick={() => isTickable && handleTick(requirement)}
                aria-label={isTickable ? `Certify ${requirement.label}` : undefined}
                className={
                  isSatisfied
                    ? "mt-0.5 shrink-0 text-green-9"
                    : isTickable
                      ? "mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                      : "mt-0.5 shrink-0 text-muted-foreground/40"
                }
              >
                {isSatisfied ? (
                  <CheckCircle2 size={17} />
                ) : isTickable ? (
                  <Square size={17} />
                ) : (
                  <Circle size={17} />
                )}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={
                      isSatisfied
                        ? "text-sm font-semibold text-foreground line-through decoration-muted-foreground/40"
                        : "text-sm font-semibold text-foreground"
                    }
                  >
                    {requirement.label}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                    <Icon size={10} />
                    {KIND_LABELS[requirement.kind] || requirement.kind}
                  </span>
                  {!requirement.is_required && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                      Optional
                    </span>
                  )}
                </div>

                {isSatisfied ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {who || satisfiedAt ? (
                      <>
                        Satisfied{who ? ` by ${who}` : ""}
                        {satisfiedAt ? ` on ${formatDate(satisfiedAt)}` : ""}
                      </>
                    ) : (
                      "Satisfied."
                    )}
                  </p>
                ) : (
                  <p
                    className={
                      requirement.is_required
                        ? "mt-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400"
                        : "mt-0.5 text-[11px] text-muted-foreground"
                    }
                  >
                    {isTickable ? "Not yet certified — tap to certify." : "Not yet satisfied."}
                  </p>
                )}
              </div>

              {isSatisfied && who && (
                <Avatar name={who} size="xs" className="mt-0.5 shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
