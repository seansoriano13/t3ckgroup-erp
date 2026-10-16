import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck } from "lucide-react";

import { Button } from "../ui/button";
import StatusBadge from "../StatusBadge";
import { costingEvaluationSettingsService } from "../../services/costingEvaluationSettingsService";
import { costingMatrixService } from "../../services/costingMatrixService";
import { describeComplianceRollup } from "../../utils/costingMath";
import { formatDate } from "../../utils/formatDate";
import { costingKeys } from "./costingKeys";

/**
 * The matrix header's Evaluation of Specification line (#271): how the whole offer stands against
 * what was asked ("2 of 5 deviate · 1 not evaluated"), whether the evaluation is approved, and, for
 * someone on the evaluation list, the button that approves it. Approval is for the whole matrix,
 * once, and is refused while any Component has no verdict. It locks nothing: a change to a
 * specification or a verdict clears it, and this line says why it went.
 *
 * Whether the viewer is on the list is read from `costing_signer_lists`, which the database shows a
 * member only their own row of (a Super Admin sees them all, so the viewer's id is matched).
 */
export default function EvaluationBar({ matrix, opportunityId, actorId, nameOf, writes }) {
  const { busy, run } = writes;
  const { evaluation, compliance } = matrix;

  const { data: signers = [] } = useQuery({
    queryKey: costingKeys.evaluationList(opportunityId),
    queryFn: () => costingEvaluationSettingsService.getSigners(),
    retry: false,
    staleTime: 60_000,
  });
  const canApprove = Boolean(actorId) && signers.includes(actorId);

  const summary = describeComplianceRollup(compliance);
  const waiting = compliance.notEvaluated;
  const signer = evaluation.signoff?.signed_by;
  const reason = evaluation.cleared?.cleared_reason;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/70 bg-card/50 px-4 py-3" data-testid="evaluation-bar">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <ClipboardCheck size={14} aria-hidden="true" />
          Evaluation of Specification
        </span>
        {summary && (
          <span className="text-sm text-muted-foreground" data-testid="matrix-compliance">
            {summary}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="evaluation-approval">
        {evaluation.approved ? (
          <>
            <StatusBadge theme="green" title="Evaluation approved">
              <CheckCircle2 size={12} className="mr-1" aria-hidden="true" />
              Evaluation approved
            </StatusBadge>
            <span className="text-xs text-muted-foreground">
              by {nameOf?.(signer) ?? "someone on the list"}, {formatDate(evaluation.signoff.signed_at)}
            </span>
          </>
        ) : (
          <>
            <StatusBadge label="Not approved" theme="mauve" title="Evaluation not approved" />
            {reason && (
              <span className="text-xs text-muted-foreground" data-testid="evaluation-cleared">
                The last approval was cleared: {reason.charAt(0).toLowerCase() + reason.slice(1)}.
              </span>
            )}
          </>
        )}
        {canApprove && !evaluation.approved && (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || waiting > 0}
              onClick={() => run(() => costingMatrixService.sign(matrix.matrixId, "evaluation_approved"))}
            >
              Approve the evaluation
            </Button>
            {waiting > 0 && (
              <span className="text-xs text-muted-foreground" data-testid="evaluation-waiting">
                {waiting} {waiting === 1 ? "Component has" : "Components have"} no verdict yet.
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
