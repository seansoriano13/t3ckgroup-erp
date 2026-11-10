import { CheckCircle2, PenLine } from "lucide-react";

import StatusBadge from "../StatusBadge";
import { tierReadsSummary } from "../../constants/costing";
import { formatDate } from "../../utils/formatDate";

/**
 * What the matrix carries besides the Evaluation approval and the Bid Decision (#722, spec #718).
 * Prepared and Costed are no longer requested, and Final approved went with Final Acquire, so there
 * is no sign button here. "Costed" shows by itself when every row has a Final Acquire. A signature
 * already on an old deal stays visible as history: who signed and when.
 */
const HISTORY = [
  { role: "prepared", label: "Prepared by" },
  { role: "costed", label: "Costed by" },
  { role: "final_approved", label: "Final approval" },
];

/** Every Component and cost-only row has a Final Acquire, and there is at least one. Closed Book only: other tiers never receive the figure. */
function isCostedByRows(matrix) {
  if (!tierReadsSummary(matrix.tier)) return false;
  const rows = [...(matrix.tenderLines ?? []).flatMap((line) => line?.components ?? []), ...(matrix.costRows ?? [])];
  return rows.length > 0 && rows.every((row) => row?.final_acquire_unit !== null && row?.final_acquire_unit !== undefined);
}

export default function SignoffBar({ matrix, nameOf }) {
  const past = HISTORY.filter(({ role }) => matrix.signoffs?.[role]?.approved);
  const costed = isCostedByRows(matrix);
  if (!costed && past.length === 0) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4" data-testid="signoff-bar">
      <span className="flex items-center gap-1.5 text-label font-bold uppercase tracking-wider text-muted-foreground">
        <PenLine size={14} aria-hidden="true" />
        Sign-offs
      </span>
      {costed && (
        <div className="flex flex-wrap items-center gap-2" data-testid="costed-derived">
          <StatusBadge theme="green" title="Every row has a cost">
            <CheckCircle2 size={12} className="mr-1" aria-hidden="true" />
            Costed
          </StatusBadge>
        </div>
      )}
      {past.map(({ role, label }) => {
        const { signoff } = matrix.signoffs[role];
        return (
          <div key={role} className="flex flex-wrap items-center gap-2" data-testid={`signoff-${role}`}>
            <StatusBadge theme="green" title={`${label} signed`}>
              <CheckCircle2 size={12} className="mr-1" aria-hidden="true" />
              {label}
            </StatusBadge>
            <span className="text-xs text-muted-foreground">
              {nameOf?.(signoff.signed_by) ?? "someone"}, {formatDate(signoff.signed_at)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
