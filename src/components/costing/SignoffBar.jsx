import { CheckCircle2, PenLine } from "lucide-react";

import { Button } from "../ui/button";
import StatusBadge from "../StatusBadge";
import { costingMatrixService } from "../../services/costingMatrixService";
import { formatDate } from "../../utils/formatDate";

/**
 * The three sign-offs the printed matrix carries besides the evaluation (#274): Prepared by (the
 * Sales incharge), Costed by (the Purchasing incharge) and Final Acquire and offer approved (the
 * Final Acquire list). Each shows who signed and when, or goes stale in words when a figure it
 * vouched for changed ("The Final Offer changed"). A button appears only for the person the
 * database would let sign; the database still decides.
 */
const SIGNOFFS = [
  { role: "prepared", label: "Prepared by", button: "Sign as prepared", who: (matrix, ctx) => Boolean(ctx.actorId) && matrix.matrix?.sales_incharge_id === ctx.actorId },
  { role: "costed", label: "Costed by", button: "Sign as costed", who: (matrix, ctx) => Boolean(ctx.actorId) && matrix.matrix?.purchasing_incharge_id === ctx.actorId },
  { role: "final_approved", label: "Final approval", button: "Approve Final Acquire & offer", who: (_matrix, ctx) => ctx.isFinalAcquire },
];

export default function SignoffBar({ matrix, actorId, isFinalAcquire = false, nameOf, writes }) {
  const { busy, run } = writes;
  const ctx = { actorId, isFinalAcquire };

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border/70 bg-card/50 px-4 py-3" data-testid="signoff-bar">
      <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <PenLine size={14} aria-hidden="true" />
        Sign-offs
      </span>
      {SIGNOFFS.map(({ role, label, button, who }) => {
        const state = matrix.signoffs?.[role] ?? { approved: false, signoff: null, cleared: null };
        const reason = state.cleared?.cleared_reason;
        return (
          <div key={role} className="flex flex-wrap items-center gap-2" data-testid={`signoff-${role}`}>
            {state.approved ? (
              <>
                <StatusBadge theme="green" title={`${label} signed`}>
                  <CheckCircle2 size={12} className="mr-1" aria-hidden="true" />
                  {label}
                </StatusBadge>
                <span className="text-xs text-muted-foreground">
                  {nameOf?.(state.signoff.signed_by) ?? "someone"}, {formatDate(state.signoff.signed_at)}
                </span>
              </>
            ) : (
              <>
                <StatusBadge label={label} theme="mauve" title={`${label} not signed`} />
                {reason && (
                  <span className="text-xs text-muted-foreground" data-testid={`signoff-${role}-cleared`}>
                    Cleared: {reason.charAt(0).toLowerCase() + reason.slice(1)}.
                  </span>
                )}
                {who(matrix, ctx) && (
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => costingMatrixService.sign(matrix.matrixId, role))}>
                    {button}
                  </Button>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
